# Implementation Prompt — Online Course Platform

## Context

Build a web-based online course platform. The system must support
[EXPECTED_CONCURRENT_USERS, default: ~100] concurrent users today, with
expected growth of [EXPECTED_YEARLY_GROWTH, default: 100-150%] per year, so
the implementation should favor free/low-cost tiers of managed services and
avoid infrastructure that requires manual scaling.

Follow the architecture and technology decisions below exactly. Do not introduce
additional backend infrastructure (e.g. AWS Lambda, API Gateway, or a custom
Node/Express server) — all backend logic must live in Supabase Edge Functions.

## Tech stack

- **Frontend**: React, deployed on Netlify.
- **Backend**: Supabase Edge Functions (Deno/TypeScript) for all server-side
  business logic (no separate API server).
- **Database & Auth**: Supabase (Postgres + Supabase Auth + Row Level Security).
- **File/asset storage**: Supabase Storage for anything that isn't video
  (course thumbnails, PDFs, certificates, etc).
- **Video hosting**: abstracted behind a `VideoProvider` interface (see below).
  - **Prototype phase**: YouTube, videos unlisted, links stored privately and
    only ever exposed to authenticated, enrolled users through the backend —
    never hard-coded in the frontend or exposed in public API responses.
    **Accepted risk, document it rather than treat it as a gap**: YouTube
    unlisted has no signed URLs, expiry, or revocation. Server-side
    resolution stops non-enrolled access and catalog scraping, but does not
    stop an enrolled user from sharing a resolved link — real content
    protection arrives with the Panda migration.
  - **Production phase**: Panda Video, using signed/token-based playback URLs
    that expire — the resolution client must support re-resolving on expiry,
    it cannot assume a permanent URL the way the YouTube phase allows.
  - The interface must let the app switch from YouTube to Panda Video by
    swapping the `VideoProvider` implementation and enrollment/access-control
    logic without changes to either. This does **not** mean the frontend
    player is unaffected — the two providers need different players/SDKs, so
    build a small player-registry component (`LessonPlayer` switching on
    `playerKind`) from day one, with only the YouTube branch implemented at
    first. Freeze the resolver's return type as a discriminated union so the
    branch is unavoidable:
    ```ts
    type ResolvedVideo =
      | { playerKind: 'youtube'; videoId: string; expiresAt: null }
      | { playerKind: 'panda'; embedUrl: string; expiresAt: string }
    ```
- **Payments**: PIX only, via **Mercado Pago** (chosen over Efí: Efí's PIX API
  requires mTLS client certificates on outbound calls, and historically on
  inbound webhook validation too, which is not reliably achievable inside
  Supabase Edge Functions given the "all backend logic in Edge Functions"
  constraint). Isolate it behind a `PaymentProvider` interface so Efí (or
  another gateway) can be swapped in later if that constraint is resolved.
  No monthly fee providers only; pay-per-transaction. Record `provider` per
  order (see data model), not as a global config flag, so a future swap
  doesn't orphan historical orders for refunds/reconciliation.
- **Transactional email**: Resend, triggered from Supabase Edge Functions.
- **Observability**: PostHog for product analytics, event tracking, and error
  tracking (both client-side, via the PostHog React SDK, and server-side, from
  Edge Functions).

## Architecture summary

```
Browser (user)
   -> React frontend (Netlify)
        -> Supabase Auth (login/signup)
        -> Supabase Postgres (courses, enrollments, orders — via RLS-protected queries)
        -> PostHog SDK (client-side events: pageviews, clicks, funnel steps)
   -> Supabase Edge Functions (all business logic)
        -> Video provider (YouTube unlisted today / Panda Video later)
        -> PIX gateway (create charge, receive webhook, confirm enrollment)
        -> Resend (transactional emails)
        -> PostHog (server-side events and error capture)
```

Key rule: the frontend never talks directly to the video provider, the payment
gateway, or Resend. All of those calls go through Edge Functions, so access
control, secrets, and business rules stay server-side.

## Data model (minimum viable)

RLS is row-level, not column-level — do not model anything where the
security rule requires hiding a single column on an otherwise-readable row
(e.g. a `video_ref` column on the public `lessons` table). Split
provider-specific video references into a table outside the schema exposed
to PostgREST instead.

Default posture: RLS enabled on every table in `public`, default deny, no
client writes to any access- or money-bearing table. All state transitions
(enrollment creation, order status changes) happen through Edge Functions
(service_role) or narrow `SECURITY DEFINER` RPCs — never direct client
INSERT/UPDATE on `enrollments` or `orders`.

Design Postgres tables (with RLS policies) for at least:

- `users` — mirrors `auth.users` plus profile fields. SELECT/UPDATE
  restricted to `id = auth.uid()`; no client INSERT (populate via an
  `AFTER INSERT ON auth.users` trigger). Do not put a role/admin flag on
  this table — a self-UPDATE policy plus a role column is a self-promotion
  vulnerability; roles belong in a separate, client-write-free table.
- `courses` (title, description, `price_cents integer`, status,
  `access_duration_days integer` nullable) — public SELECT where
  `status = 'published'`, no client writes. Money is represented as integer
  cents everywhere (never `numeric`/float) — the Mercado Pago adapter is the
  only place that converts to decimal, at the API boundary. If internal-only
  fields get added later (cost basis, gateway account id), expose a
  `courses_public` view with an explicit column list rather than relying on
  RLS to hide them. `access_duration_days` is per-course: `NULL` means
  lifetime access; a positive integer is the number of days from grant to
  expiry. This is the single source of truth `app.confirm_payment` reads
  when computing `enrollments.expires_at` on enrollment creation.
- `lessons` (belongs to a course, ordered: title, position,
  duration_seconds, is_free_preview) — public SELECT where the parent
  course is published, so the curriculum renders on the sales page.
  Contains no video reference.
- `app_private.lesson_assets` (lesson_id, provider, external_ref, is_active,
  created_at) — **not exposed to PostgREST**, RLS enabled with zero policies
  (default deny). Reachable only via service_role or a `SECURITY DEFINER`
  RPC (`get_playable_ref(lesson_id)`) that checks enrollment internally.
  Partial unique index on `(lesson_id) WHERE is_active` lets the
  YouTube→Panda migration happen per-lesson (backfill inactive rows, verify,
  flip `is_active`), with rollback being a plain UPDATE instead of a
  destructive backfill.
- `enrollments` (user_id, course_id, status, granted_at,
  `expires_at` nullable) — SELECT restricted to `user_id = auth.uid()`, no
  client writes. Partial unique index on `(user_id, course_id) WHERE
  status = 'active'` (not a plain unique — a refunded user must be able to
  re-enroll). `expires_at` is set on grant by `app.confirm_payment`, read
  from the purchased course's `access_duration_days`: `NULL` (lifetime) or
  `granted_at + access_duration_days days`. Define one shared SQL function
  `app.has_active_enrollment(uid, course_id)` — `status = 'active' AND
  (expires_at IS NULL OR expires_at > now())` — and use it both in RLS
  policies and in video resolution; two definitions of "active" is how
  these systems drift apart.
- `orders` (user_id, course_id, `amount_cents integer`,
  `currency char(3) default 'BRL'`, provider, provider_charge_id,
  provider_txid, external_reference, status, expires_at, created_at,
  paid_at) — SELECT restricted to `user_id = auth.uid()`, no client writes
  ever (`amount_cents` must be read server-side from `courses.price_cents`
  at charge creation, never accepted from the request body — otherwise it's
  price tampering). `status` must include `refunded` — PIX refunds exist,
  and CDC art. 49 gives Brazilian consumers a 7-day withdrawal right on
  digital purchases, so a `refunded` webhook event automatically calls
  `app.refund_order` to revoke the associated enrollment — no manual step.
  `provider` is set per-order (not read from a global config) so historical
  orders stay attributable after a future gateway swap.
- **Out of scope for MVP** (explicit decision, not an oversight): coupons/
  promo pricing, CPF/nota fiscal collection at checkout, and manual/comp
  enrollment grants without an order. None of these are modeled in the
  schema above; add them as extension points later rather than designing
  for them now.
- `app_private.payment_events` (provider, event_id, payload jsonb,
  received_at, processed_at, status) — unique on `(provider, event_id)`,
  used for webhook dedup (best-effort — Mercado Pago's request id isn't
  guaranteed stable across retries, so this is not the sole guarantee) and
  as the durable audit trail for webhook failures (PostHog capture alone
  isn't enough; Supabase's free tier keeps logs for 1 day).
- `app_private.email_outbox` — durable queue for welcome/purchase-
  confirmation emails, drained by the same scheduled job as payment
  reconciliation, so a transient Resend failure doesn't silently drop a
  confirmation email.

Access to the resolved playback URL must only be returned by a
`SECURITY DEFINER` RPC or Edge Function running under the caller's JWT (not
a broad service_role function) that checks `app.has_active_enrollment`, so
the enrollment check is structurally impossible to skip.

## Feature requirements

1. **Auth & onboarding**
   - Sign up / login via Supabase Auth (email+password to start; email
     confirmation required). Configure **Resend as Supabase Auth's custom
     SMTP provider** — Supabase's default SMTP is rate-limited to a handful
     of emails/hour and not viable once signups exceed a trickle. Verify a
     sending domain with SPF/DKIM early; this is separate from Resend usage
     inside Edge Functions below.
   - Trigger the welcome email on **email confirmation** (the
     `auth.users.email_confirmed_at` NULL → NOT NULL transition), not on
     signup itself — an explicit client-callable "send welcome email"
     endpoint is a spam vector against the Resend daily quota before the
     user is even verified. Route it through `app_private.email_outbox` so
     a transient send failure is retried, not lost.

2. **Course catalog & enrollment**
   - Public course listing (no auth required) with price and description.
   - Checkout flow: user selects a course -> Edge Function creates a PIX
     charge via the payment gateway (amount read server-side from
     `courses.price_cents`, never from the client) -> frontend displays the PIX QR
     code/copy-paste code -> gateway sends a webhook to a dedicated Edge
     Function on payment confirmation -> Edge Function marks the order paid,
     creates the enrollment, and queues a purchase-confirmation email via
     the outbox.
   - **Webhook idempotency**, two layers:
     1. Insert into `app_private.payment_events` on `(provider, event_id)`
        with `ON CONFLICT DO NOTHING` — best-effort noise reduction, not the
        sole guarantee.
     2. A single atomic `confirm_payment(order_id)` RPC doing a
        compare-and-swap (`UPDATE orders SET status = 'paid' WHERE
        status <> 'paid'`), then `INSERT ... ON CONFLICT DO NOTHING` on
        `enrollments`, returning a `did_transition` boolean. Only queue the
        confirmation email when `did_transition` is true — this is what
        prevents duplicate emails on webhook retry.
   - Treat the webhook payload as an untrusted hint, not ground truth: after
     extracting an identifier, confirm the charge status **and amount** by
     calling the gateway's own "get charge" API with server credentials
     before running the CAS above. The webhook endpoint necessarily runs
     with JWT verification off (a payment gateway can't present a Supabase
     JWT), so it's a public, unauthenticated, internet-reachable endpoint —
     confirm-by-refetch is the actual security boundary; gateway signature
     verification is defense in depth on top of it.
   - Return 200 to the webhook fast; do the DB work synchronously but send
     the email asynchronously via the outbox, since gateways retry
     aggressively on slow responses.
   - Add a scheduled reconciliation job (Edge Function on a cron) that polls
     `orders` with `status = 'pending'` past a short window and re-runs the
     same confirm/refetch path — PIX payments can settle even when webhook
     delivery permanently fails, and without this a paying user has no
     automated recovery path.

3. **Video playback**
   - Enrolled users can list lessons for a course they own (metadata only,
     read directly from the RLS-protected `lessons` table — no video
     reference is included in the list response).
   - Resolution is **resolve-on-play, single lesson**
     (`POST /video-resolve { lessonId }`), not batch-resolved for a whole
     course list: a 20-lesson course should not trigger 20 resolutions, and
     Panda's signed URLs would otherwise generate tokens that expire unused.
   - The resolving function runs under the caller's JWT (not a broad
     service_role) and calls the `get_playable_ref(lesson_id)`
     `SECURITY DEFINER` RPC, which checks `app.has_active_enrollment`
     internally before returning anything from `app_private.lesson_assets`
     — this makes the enrollment check structurally impossible to bypass
     from within the function's own logic.
   - For the YouTube phase, do not expose the raw YouTube link in any public
     API response or client-side bundle; resolve it server-side per request.

4. **Observability**
   - Initialize PostHog on the frontend (page views, key funnel events:
     course viewed, checkout started, checkout completed, video played).
   - Capture exceptions/errors from Edge Functions into PostHog (server-side
     error tracking), including payment webhook failures and video-resolution
     failures.

5. **Transactional emails via Resend**
   - Welcome email on signup.
   - Purchase confirmation email on enrollment.
   - (Stub, don't implement yet) password reset and course-completion emails —
     leave clearly marked extension points.

## Non-functional requirements

- Favor Supabase and Netlify free tiers; keep paid add-ons (Panda Video
  Bronze plan, Supabase Pro, Resend Pro) as documented but not auto-enabled —
  the code should work against free-tier limits without hard-coding them.
  Exception: budget for **Supabase Pro before handling real payments** — the
  free tier has no backups/PITR and only 1-day log retention, which is a
  data-loss and incident-response risk independent of traffic load, not a
  scale decision.
- Plan for **3 environments** (dev/staging/prod) against Supabase's
  2-active-project free-tier limit; the staging project will also auto-pause
  after ~7 days of inactivity on the free tier.
- All Edge Function database access goes through PostgREST/`supabase-js` or
  RPCs — no direct Postgres driver connections from Edge Functions, to avoid
  exhausting the free tier's limited direct-connection pool under concurrent
  isolate bursts. If a direct connection is ever unavoidable, it must use
  the transaction-mode pooler (port 6543), never session mode.
- All secrets (payment gateway keys, Resend API key, PostHog API key, video
  provider credentials) must be stored as Supabase Edge Function secrets /
  Netlify environment variables — never committed to the repo or shipped to
  the client, except the PostHog public project key, which is client-safe.
  Note in the frontend `.env.example` that any `VITE_`-prefixed variable
  ships inside the client bundle — the service role key must never be set
  there.
- Write the `VideoProvider` and `PaymentProvider` as small, testable
  interfaces/modules so swapping YouTube→Panda Video or Mercado Pago→Efí is
  a contained change. Known leak points to document rather than paper over:
  provider auth models differ (token vs. mTLS), webhook event cardinality
  differs (Mercado Pago sends one event per notification, Efí can batch
  multiple payments per POST — model `parseWebhook` as returning an array),
  and identifier shapes differ (`payment.id` vs. `txid`/`e2eid`), hence the
  separate `provider_charge_id`/`provider_txid` order columns.
- PostHog server-side capture from Edge Functions must explicitly flush
  before the function returns (a serverless isolate can be torn down with
  buffered events unsent) — treat `app_private.payment_events` as the
  durable audit trail for failures and PostHog as the alerting/analytics
  layer, not the source of truth.
- LGPD: PostHog client-side autocapture collects behavioral data and IP
  addresses — a consent mechanism and a stated retention policy are
  required, not just the integration itself.
- Keep the initial implementation simple and readable over "enterprise-scale"
  — this is a small platform (~100 concurrent users) and premature complexity
  should be avoided.

## Frozen contracts and measurable NFRs (phase 2)

These are the only things the backend and frontend implementation tracks
share — treat them as fixed once implementation starts; changing one after
both tracks have begun invalidates finished work on both sides.

### Measurable NFR targets

Today's ~100 concurrent users is roughly 5 req/s aggregate against Supabase,
of which only `checkout` and `video-resolve` hit Edge Functions — the
catalog and lesson list must query PostgREST directly (`courses_public`,
`lessons`), never through an Edge Function, or Edge Function invocation
volume breaks the free-tier budget well before load does.

| Metric | Target |
|---|---|
| Edge Function throughput | 5 req/s sustained, 25 req/s peak burst |
| `video-resolve` p95 / p99 | 400 ms / 800 ms |
| `checkout` p95 | 1.5 s |
| `payments-webhook` p95 / hard cap | 2 s / must respond under 5 s (gateway retry threshold) |
| Reconciliation cron | every 5 min, orders `pending` > 3 min, batch <= 100 |
| Email outbox drain | every 5 min, batch <= 50, 5 attempts with backoff, then dead-letter |
| Test coverage | 80% (Deno unit tests); RLS is covered separately by its own policy test suite, not folded into this number |

### `PaymentProvider` (frozen)

```ts
export type PaymentProviderId = 'mercadopago' | 'efi';
export type Money = { readonly amountCents: number; readonly currency: 'BRL' };
export type ChargeStatus =
  | 'pending' | 'paid' | 'expired' | 'cancelled' | 'refunded' | 'unknown';

export interface CreatePixChargeInput {
  readonly orderId: string;             // our uuid; sent as external_reference
  readonly amount: Money;               // read server-side from courses.price_cents
  readonly description: string;
  readonly expiresInSeconds: number;
  readonly payer: { readonly email: string; readonly firstName?: string; readonly lastName?: string };
  readonly notificationUrl: string;
  readonly idempotencyKey: string;      // = orderId
}

export interface PixCharge {
  readonly providerChargeId: string;
  readonly providerTxid: string | null;
  readonly externalReference: string;
  readonly status: ChargeStatus;
  readonly qrCodePayload: string;       // EMV copia-e-cola
  readonly qrCodeBase64: string | null;
  readonly amount: Money;
  readonly expiresAt: string;           // ISO-8601 UTC
}

export interface ChargeSnapshot {
  readonly providerChargeId: string;
  readonly externalReference: string | null;
  readonly status: ChargeStatus;
  readonly amount: Money;               // authoritative; compared against orders.amount_cents
  readonly paidAt: string | null;
  readonly raw: unknown;
}

export interface WebhookRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;             // unparsed — signature depends on the raw bytes
  readonly url: string;
}

export interface WebhookEvent {
  readonly provider: PaymentProviderId;
  readonly eventId: string;             // dedup key; deterministic fallback if the provider gives none
  readonly providerChargeId: string;
  readonly externalReference: string | null;
  readonly hintedStatus: ChargeStatus;  // UNTRUSTED — never acted on without getChargeStatus()
  readonly receivedAt: string;
  readonly raw: unknown;
}

export type WebhookParseResult =
  | { ok: true; events: readonly WebhookEvent[] }   // array: some gateways batch multiple payments per POST
  | { ok: false; reason: 'invalid_signature' | 'malformed' | 'unsupported_event'; detail?: string };

export interface PaymentProvider {
  readonly id: PaymentProviderId;
  createPixCharge(input: CreatePixChargeInput): Promise<PixCharge>;
  getChargeStatus(providerChargeId: string): Promise<ChargeSnapshot>;
  parseWebhook(req: WebhookRequest): Promise<WebhookParseResult>;
  refund?(providerChargeId: string, amount?: Money): Promise<RefundResult>;
}
```

### SQL RPC signatures (frozen)

```sql
-- policy-facing wrapper; SECURITY DEFINER; GRANT EXECUTE TO authenticated
app.has_active_enrollment(p_course_id uuid) RETURNS boolean

-- shared implementation; STABLE, SECURITY DEFINER, search_path = ''
-- REVOKE FROM anon, authenticated; GRANT TO service_role only
app.has_active_enrollment(p_user_id uuid, p_course_id uuid) RETURNS boolean
  -- body: status = 'active' AND (expires_at IS NULL OR expires_at > now())

-- SECURITY DEFINER, runs under caller's JWT context; GRANT TO authenticated
-- returns ZERO ROWS when not entitled OR lesson missing (never leak existence)
app.get_playable_ref(p_lesson_id uuid)
  RETURNS TABLE (lesson_id uuid, provider text, external_ref text)

-- atomic CAS; SECURITY DEFINER; GRANT TO service_role ONLY
-- expires_at on the created enrollment is computed from courses.access_duration_days
app.confirm_payment(p_order_id uuid, p_provider_charge_id text, p_paid_at timestamptz)
  RETURNS TABLE (did_transition boolean, order_status text, enrollment_id uuid,
                 user_id uuid, course_id uuid)
  -- did_transition=true is the ONLY signal that should trigger the confirmation email

app.refund_order(p_order_id uuid, p_refunded_at timestamptz)
  RETURNS TABLE (did_transition boolean, revoked_enrollment_id uuid)

app.expire_stale_orders(p_limit int DEFAULT 100) RETURNS integer

app.enqueue_email(p_template text, p_to_email text, p_payload jsonb, p_dedup_key text)
  RETURNS uuid  -- p_dedup_key UNIQUE, e.g. 'purchase_confirmation:<order_id>'
```

### Edge Function HTTP contracts (frozen)

All `POST ${SUPABASE_URL}/functions/v1/<name>`. Shared error envelope:
`{ error: { code: string; message: string; requestId: string } }`.

| Function | `verify_jwt` | Request | 200 response |
|---|---|---|---|
| `checkout` | true | `{ courseId }` | `{ orderId, status: 'pending', amountCents, currency: 'BRL', pix: { qrCodePayload, qrCodeBase64, expiresAt } }` |
| `payments-webhook` | false | raw gateway body | `{ received: true }` (duplicate event or refetch-says-not-paid still return 200) |
| `payments-reconcile` | false + `X-Cron-Secret` | `{ limit? }` | `{ scanned, confirmed, expired, failed }` |
| `video-resolve` | true, caller-JWT client only | `{ lessonId }` | `{ lessonId, video: ResolvedVideo }` |
| `outbox-drain` | false + `X-Cron-Secret` | `{ limit? }` | `{ picked, sent, failed, deadLettered }` |

`checkout` rule: if a non-expired `pending` order already exists for
`(user, course)`, return its existing charge instead of creating a second
one — prevents duplicate charges on double-click.

### RLS access matrix (frozen — this is the RLS policy test suite's spec)

| Table | anon | owner (authenticated) | other user | service_role |
|---|---|---|---|---|
| `public.users` | – | S, U (own row) | – | all |
| `public.courses` / `courses_public` | S (published) | S | S | all |
| `public.lessons` | S (parent published) | S | S | all |
| `public.enrollments` | – | S (own) | – | all |
| `public.orders` | – | S (own) | – | all |
| `app_private.lesson_assets` | – | – | – | all |
| `app_private.payment_events` | – | – | – | all |
| `app_private.email_outbox` | – | – | – | all |

`–` = denied, including writes — no client INSERT/UPDATE/DELETE exists
anywhere in this table; the test suite must assert that explicitly per
table, not treat it as an omission.

### PostHog event names (frozen)

Client: `catalog_viewed`, `course_viewed`, `checkout_started`,
`checkout_pix_displayed`, `checkout_completed`, `video_played`,
`video_resolve_failed`, `signup_started`, `signup_completed`,
`login_completed`.
Server: `payment_charge_created`, `payment_webhook_received`,
`payment_confirmed`, `payment_amount_mismatch`, `payment_webhook_failed`,
`video_resolved`, `video_resolve_denied`, `email_sent`,
`email_dead_lettered`, `reconcile_tick`.

### Environment variable names (frozen — drives the `.env.example` deliverable)

**Backend**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
(auto-injected in deployed functions — document, don't set),
`PAYMENT_PROVIDER=mercadopago`, `MERCADOPAGO_ACCESS_TOKEN`,
`MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_NOTIFICATION_URL`,
`PIX_CHARGE_TTL_SECONDS=1800`, `VIDEO_PROVIDER=youtube`, `PANDA_API_KEY`,
`PANDA_SIGNED_URL_TTL_SECONDS`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`RESEND_REPLY_TO`, `POSTHOG_API_KEY`, `POSTHOG_HOST`, `CRON_SECRET`,
`APP_PUBLIC_URL`, `COMPANY_NAME`, `SUPPORT_EMAIL`.

**Frontend**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `VITE_APP_ENV`. Every
`VITE_`-prefixed variable ships inside the client bundle — the service role
key must never be set here; state this as a comment at the top of the file.

## Visual identity

Ask whether a visual identity manual exists (brand colors, typography, logo,
UI style references). If one is provided, apply it to the frontend design.
If none exists, that is fine — proceed with a clean, neutral default UI and
standard component styling; this is optional, not a blocker.

## Deliverables

1. React frontend project (Netlify-ready) with the pages: catalog, course
   detail, checkout, video player, login/signup, "my courses". On 'frontend' folder.
2. Supabase project setup: SQL migrations for the schema and RLS policies,
   an RLS policy test suite (pgTAP or Deno integration tests against
   `supabase start`) asserting per-table/per-role access — RLS is
   declarative SQL and isn't covered by the Deno unit-test coverage target,
   so it needs its own explicit tests — plus the Edge Functions for:
   checkout/PIX creation, PIX webhook handler, payment reconciliation cron,
   video URL resolution, and email triggers. On 'backend' folder.
   Course/lesson authoring, manual enrollment grants, and refund processing
   have no dedicated admin UI in this scope — MVP admin is the Supabase SQL
   console, as a deliberate deferred-scope decision, not an oversight.
3. `.env.example` files (frontend and Edge Functions) listing every required
   environment variable/secret, without real values.
4. A short `README.md` explaining how to run the project locally, how to
   configure Supabase, Netlify, the PIX gateway, Resend, and PostHog, and how
   to switch the video provider from YouTube to Panda Video later.

Enrollment rules, pricing representation, and PIX gateway are decided (see Data model and
Tech stack: per-course `access_duration_days`/lifetime, integer cents, Mercado Pago,
automatic refund revocation, no coupons/CPF/comp grants in MVP). Still open, but non-
blocking for implementation — placeholder values in code until provided: the company/brand
name (`COMPANY_NAME` env var, `frontend/src/config/brand.ts`) and each course's actual
price. The company name is on the critical path for one ops task specifically: Resend
sending-domain verification (SPF/DKIM) and Supabase Auth custom-SMTP setup take DNS
propagation time, so settle it as soon as it's known, independent of implementation
progress.

## Multi-agent execution workflow

Do not implement this end-to-end in a single pass. Distribute the work across
the specialized agents available in this environment, in the phases below.
Agents whose toolset is read-only (`architect`, `planner`) produce design/plan
artifacts for review, not code — the actual writing happens in the main
session or via `tdd-guide`, then gets checked by the review agents. Skip
`go-reviewer`/`go-build-resolver`/`java-reviewer`/`java-build-resolver` — this
stack is TypeScript/Deno + SQL, none of it applies.

1. **Architecture validation** — `architect` reviews the "Architecture
   summary" and data model against the stated constraints (~100 concurrent
   users, free-tier bias, `VideoProvider`/`PaymentProvider` swappability)
   *before* any code is written. Output: confirmation or flagged risks
   (e.g. RLS design gaps, webhook idempotency approach).

2. **Task breakdown** — `planner` turns the four deliverables into a concrete
   task list per area (SQL migrations + RLS, Edge Functions, frontend pages,
   docs), sized so each task can be handed to a single TDD cycle. Freeze the
   `VideoProvider`/`PaymentProvider` interface signatures here — everything
   in phase 4 depends on these being stable first.

3. **Clarifications** — resolve the open questions (enrollment rules, company
   name, pricing, Mercado Pago vs Efí) before phase 4 starts; both provider
   interfaces and the `orders`/`enrollments` schema depend on the payment
   gateway choice.

4. **Parallel implementation** — once interfaces and schema are frozen, run
   independent `tdd-guide` passes in parallel (backend and frontend don't
   share code, only the frozen contracts from phase 2):
   - **Backend track**: SQL migrations/RLS, then Edge Functions (checkout/PIX
     creation, PIX webhook handler with idempotency, video URL resolution,
     Resend triggers), each with unit tests first per the repo's 80%
     coverage convention.
   - **Frontend track**: catalog, course detail, checkout, video player,
     login/signup, "my courses" pages, with PostHog instrumentation and
     Supabase Auth/client wiring, tests first.
   Within each track, sub-tasks with no shared files (e.g. checkout Edge
   Function vs. video-resolution Edge Function) can also run as parallel
   agent invocations.

5. **Review** — run after each track, not just at the end:
   - `security-reviewer` on anything touching secrets, the PIX webhook,
     RLS policies, and video URL exposure (the "never expose raw YouTube
     link" and "never ship secrets to the client" rules are the main
     failure modes to catch).
   - `code-reviewer` on general quality for both frontend and backend.
   - `refactor-cleaner` once both tracks land, to catch dead code left by
     interface swapping (e.g. an abandoned provider stub).

6. **Docs** — `doc-updater` writes the final `README.md` (local run, Supabase/
   Netlify/PIX gateway/Resend/PostHog setup, YouTube→Panda Video switch
   steps) once the implementation is stable, so it documents what was
   actually built rather than what was planned.

Use parallel agent invocations wherever a phase says "parallel" above; keep
phases 1-3 sequential since each later phase depends on their output.
