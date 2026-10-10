# Progress

Status tracker for the multi-agent build described in `prompt_course_platform.md`
(see its "Multi-agent execution workflow" and "Frozen contracts and measurable
NFRs" sections for the actual technical spec — this file is a checklist, not a
spec, and should not duplicate that content). Update the checkboxes and
"Next step" as work continues; this is the resume point for a future session.

## Status summary

- Phase 1 (architect review) — done, findings folded into the plan doc.
- Phase 2 (planner task breakdown + contract freeze) — done, contracts folded
  into the plan doc's "Frozen contracts and measurable NFRs" section.
- Phase 3 (clarifications) — done, decisions folded into the plan doc.
- Phase 4 (parallel TDD implementation) — Track F, Track A (A1-A17), and
  Track B (B1-B14, all 14 items) are now fully complete as of 2026-09-03.
  Track C is C1-C6/C9 done, C7/C8/C10/C11 now unblocked (Track B is no
  longer a blocker) but not started. Track D (docs) mostly not started.
- Phase 5 (review) — only a partial `security-reviewer` pass on Tracks A/B/C
  done 2026-08-27 (see "Security review" section below), predating all of
  B8-B14 — that pass never saw the checkout/webhook/reconcile/video-resolve/
  outbox-drain code, so it should not be read as covering it. One open item
  from that pass (auth confirmation bypass) still unresolved — see below,
  now directly relevant since checkout (B9, money-handling) is built.
  A full `security-reviewer` + `code-reviewer` pass on B8-B14 has NOT
  happened yet — recommended before Track C wires the frontend to these
  functions, per the plan doc's "run after each track, not just at the end"
  guidance. Phase 6 (docs) — not started.

## Security review (2026-08-27, Tracks A/B/C)

Live review against the running local stack (real `SET LOCAL ROLE`
queries, `curl` against the Auth/REST APIs, `pg_default_acl` inspection),
not just a code read — methodology and every claim below independently
spot-checked by the coordinator, not taken on the reviewer's word alone.

**Open item — needs a decision, not yet fixed:**

- `backend/supabase/config.toml`'s `[auth.email] enable_confirmations =
  false` means signup returns a fully active session immediately, with
  `email_confirmed_at` already set — verified live: `POST /auth/v1/signup`
  returns `access_token` + `email_confirmed_at` populated, no confirmation
  step. Two consequences, both confirmed by reading the actual code: (1)
  `frontend/src/features/auth/ProtectedRoute.tsx` only checks `if
  (!session)`, never confirmation status, so this isn't a defense-in-depth
  gap — it's the only gate, and it's currently a no-op gate for this
  purpose; (2) `..._a12_enqueue_email.sql`'s welcome-email trigger is
  `AFTER UPDATE ON auth.users` gated on the `email_confirmed_at` `NULL ->
  NOT NULL` transition — with confirmation happening at INSERT time
  instead, that transition never fires via UPDATE, so the trigger is
  currently dead code. Both contradict `prompt_course_platform.md`'s
  frozen design ("trigger the welcome email on email confirmation...
  not on signup") and `SignupPage.tsx`'s own UI copy, which tells the user
  their account isn't unlocked yet — untrue at the moment it's shown.
  Recommended fix: flip `enable_confirmations = true`, re-verify via the
  same curl check (should return no `access_token`, `email_confirmed_at:
  null`) and confirm Mailpit (`127.0.0.1:54324`) receives the email. Not
  applied yet — this changes signup's runtime behavior (manual/E2E testing
  now needs to follow a Mailpit link instead of getting an instant
  session), so left for an explicit decision rather than auto-fixed.
  Should resolve before B9/C8 (checkout) — that's the first place a
  user's verified identity starts mattering for a money-handling flow.

**Informational, not urgent:** `minimum_password_length = 6` (CLI scaffold
default) is weak for a paid/PII-handling platform under LGPD — recommend
≥8 with mixed character classes before go-live; UX-friction judgment call,
not blocking.

**Verified solid, no findings:**
- Track A: re-checked the "sibling leak" hypothesis directly against the
  live DB (`pg_default_acl`, `information_schema.role_*_grants` across
  `public`/`app`/`app_private`) — the TRUNCATE-class leak A14 fixed was
  `public`-only (Supabase's `roles.sql` bootstrap never seeded an
  equivalent default for `app`/`app_private`, and `app` has zero tables
  regardless). Live cross-tenant RLS test with two synthetic users
  confirmed `orders`/`enrollments` isolation and `get_playable_ref`'s
  zero-rows-not-error behavior for both "doesn't exist" and "not
  entitled." All 13 SECURITY DEFINER functions confirmed
  `search_path=""`, owned by `postgres`, no escalation path found.
- Track B: `supabase.ts`'s two client factories confirmed genuinely
  separate at the code level; `config.ts` error messages confirmed to
  never include var values, only names; `crypto.ts`'s HMAC compare
  confirmed constant-time (XOR-accumulate, no early return except a
  length check); `provider.ts`'s `getChargeStatus` confirmed to always
  live-fetch, never trust a passed-in status. Forward-looking note for
  B8: `MercadoPagoApiError.body` (raw provider response, may carry payer
  PII) is separate from `.message` and not currently captured anywhere,
  but would become an LGPD concern if a future B8-B10 implementation
  passes `.body` into `captureExceptionAndFlush`'s properties — worth
  remembering during that review, not an issue today.
- Track C: `.env.example` vs `lib/env.ts` exact match, zero non-`VITE_`
  vars; LGPD consent gate confirmed structural (only caller of
  `posthog.init` is consent-gated, `capture()` a no-op until then, whole
  frontend grepped for other `posthog-js` imports — none); zero
  `service_role`/`SERVICE_ROLE` references anywhere in frontend; video
  contract exhaustiveness guard confirmed present. `npm audit
  --audit-level=high`: 0 vulnerabilities.
- General repo-wide secrets sweep: clean (only hits were the
  well-known public Supabase CLI local-dev demo keys and clearly-named
  test fixtures).

Environmental note (not a defect): the running `supabase_rest_backend`
container had a stale `PGRST_DB_SCHEMAS` env var from before A1's
`config.toml` schema change — a `supabase stop && supabase start` (or
`db reset`) picks up the correct value. If `app.*` RPCs 404 during B8-B14
development, restart the stack before suspecting the code.

## Environment notes

- Node v22.22.3 / npm 11.15.0 available.
- `deno` (2.9.5) and the Supabase CLI (2.114.0) installed 2026-08-25 —
  unblocks Track A (SQL migrations/RLS) and Track B (Edge Functions), and
  the backend half of F1/F2 (done, see below).
- Docker available and working; `supabase start` / `supabase test db`
  verified locally on 2026-08-25 (pgTAP smoke test passes end-to-end).
- Repo is **not git-initialized** — deliberate choice (2026-08-24), not an
  oversight. Revisit if that becomes inconvenient.

## Task checklist

### Track F — Foundation

- [x] F1 (frontend half) — Vite+React+TS scaffold, Vitest+Testing Library,
      `netlify.toml`, `.env.example`. Verified: `npm run build` and `npm test`
      pass clean.
- [x] F1 (backend half) — `backend/supabase/` via `supabase init`;
      `backend/deno.json` (Deno-native fmt/lint/test tasks, not oxlint —
      Deno's URL/JSR import model doesn't fit Node-oriented tooling);
      pgTAP scaffolded at `backend/supabase/tests/pgtap_smoke_test.sql` and
      verified passing via `supabase start` + `supabase test db`.
- [x] F2 (frontend half) — `frontend/src/contracts/video.ts` (`ResolvedVideo`
      discriminated union), matches the plan doc's frozen contract.
- [x] F2 (backend half) — `backend/contracts/video.ts` (byte-identical copy)
      + `backend/contracts/payments.ts` (`PaymentProvider`, backend-only, no
      frontend counterpart) + `backend/contracts/video.parity.test.ts`
      (Deno test asserting the two `video.ts` copies stay identical).
      Verified: `deno task test`, `deno fmt --check`, `deno lint`, and
      `deno check contracts/*.ts` all pass clean from `backend/`.

### Track A — SQL migrations + RLS — DONE (A1-A17, all 17 items)

- [x] A15 — RLS policy test suite, interleaved per table/RPC as each
      migration landed, plus a dedicated completeness pass at the end that
      went cell-by-cell through the frozen RLS access matrix against the
      actual test files (not just "a test file exists") and filled real
      gaps it found in `a3_user_roles_test.sql`, `a4_courses_lessons_test.sql`,
      `a5_lesson_assets_test.sql`, `a6_enrollments_test.sql`,
      `a7_orders_test.sql`, `a8_payment_events_test.sql`,
      `a9_email_outbox_test.sql`.
- [x] A1 — `..._a1_schemas_hardening.sql` — `app`/`app_private` schemas,
      revoke-first default-privilege hardening.
- [x] A2 — `..._a2_users.sql` — `public.users`, signup + email-sync
      triggers, RLS.
- [x] A3 — `..._a3_user_roles.sql` — `app_private.user_roles`,
      `app.is_admin()`.
- [x] A4 — `..._a4_courses_lessons.sql` — `courses`, `lessons`,
      `courses_public` view.
- [x] A5 — `..._a5_lesson_assets.sql` — `app_private.lesson_assets`,
      zero-policy, partial unique index on `(lesson_id) WHERE is_active`.
- [x] A6 — `..._a6_enrollments.sql` — `enrollments`, both
      `has_active_enrollment` overloads.
- [x] A7 — `..._a7_orders.sql` — `orders`.
- [x] A16 — `backend/supabase/seed.sql` — deterministic dev fixtures.
- [x] A8 — `..._a8_payment_events.sql`.
- [x] A9 — `..._a9_email_outbox.sql`.
- [x] A10 — `..._a10_confirm_payment.sql` — `app.confirm_payment` CAS
      (single `UPDATE ... WHERE status <> 'paid' RETURNING`, verified by
      inline read — no SELECT-then-UPDATE race) + `app.expire_stale_orders`
      (bundled here, see deviation below; uses `FOR UPDATE SKIP LOCKED` for
      safe concurrent runs alongside `confirm_payment`).
- [x] A11 — `..._a11_get_playable_ref.sql`.
- [x] A12 — `..._a12_enqueue_email.sql` — `app.enqueue_email` +
      welcome-email trigger.
- [x] A13 — `..._a13_refund_order.sql` — `app.refund_order`.
- [x] A14 — `..._a14_grants_audit.sql` — diagnostic view + fail-fast DO
      block. **Caught and fixed a real privilege leak, see below.**
- [x] A17 — `..._a17_cron_schedule.sql` — `pg_cron`/`pg_net`, three
      scheduled jobs; reads its target URL/secret from Supabase Vault at
      call time and no-ops with a `RAISE WARNING` (not an error) until an
      operator configures Vault, since Track B's `payments-reconcile`/
      `outbox-drain` functions don't exist yet.

  Verified 2026-08-27, from a genuinely clean slate, not from the agent's
  self-report: `supabase db reset` (applies all 15 migrations + seed) then
  `supabase test db` — 331 pgTAP assertions across 16 files, 0 failures,
  re-run myself.

  **Security finding, independently re-verified, not just trusted**: A14's
  audit uncovered that every `public` table (users, courses, lessons,
  enrollments, orders, courses_public) was silently granting
  `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` to `anon` and `authenticated`
  — RLS does not filter `TRUNCATE` at all, so this was a real hole, not a
  theoretical one. Root cause: Supabase's local bootstrap (`roles.sql`,
  applied before any of this repo's migrations) pre-seeds a schema-scoped
  default-privilege grant that A1's unqualified `REVOKE ... FROM PUBLIC`
  never reached. A14 fixes the default going forward and strips the leaked
  grants from every existing table. I confirmed this myself directly
  against the running DB: `SET ROLE anon; TRUNCATE public.orders;` →
  `ERROR: permission denied for table orders`, and a query against
  `information_schema.role_table_grants` for
  `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` on `public` granted to
  `anon`/`authenticated` returns zero rows.

  Deviations from the literal spec, with reasoning:
  1. `config.toml`'s `api.schemas` extended to
     `["public", "app", "app_private", "graphql_public"]` (confirmed by
     grep) so PostgREST can route to `app.*` RPCs and `service_role` can
     reach `app_private.*` via `supabase-js` — without this, Track B would
     need a direct Postgres connection, which the NFRs forbid. GRANTs/RLS
     still fully gate access; only routability changed.
  2. `app.expire_stale_orders` bundled into A10's migration rather than
     given its own A-number — the checklist never allocated one, and it's
     the same order-lifecycle domain as `confirm_payment`.
  3. `orders.refunded_at` column added in A13 — the frozen
     `refund_order(p_order_id, p_refunded_at, ...)` signature takes a
     timestamp with nowhere in the spec's `orders` column list to store
     it; added rather than silently discarding the parameter.
  4. `enrollments.status` restricted to `('active','refunded')` only — no
     invented third value, since the frozen "active" boolean logic never
     references anything beyond those two.
  5. Two Postgres quirks worked around, documented inline in A1/A10:
     schema-scoped `ALTER DEFAULT PRIVILEGES ... ON FUNCTIONS` doesn't
     override the built-in PUBLIC-execute default (fixed with the global
     form in A1); `RETURNS TABLE` OUT-parameter names shadow same-named
     real table columns in plpgsql bodies (`#variable_conflict use_column`
     pragma in A10/A13, confirmed present on read).

### Track B — Edge Functions

- [x] B1 — `_shared/http.ts` — frozen error envelope, `jsonResponse`,
      CORS headers, `parseJsonBody` (raises `BodyParseError`, never a raw
      `SyntaxError`).
- [x] B2 — `_shared/supabase.ts` — `createServiceRoleClient` (bypasses RLS)
      and `createCallerClient` (runs under the caller's JWT; throws
      `MissingAuthorizationError` rather than silently downgrading to anon)
      as genuinely separate factories, verified by inline read.
- [x] B3 — `_shared/observability.ts` — `captureAndFlush` /
      `captureExceptionAndFlush`. No queue, single awaited HTTP call per
      event, so there's nothing to forget to flush; never throws on
      delivery failure (`CaptureResult.ok` signals it instead).
- [x] B4 — `_shared/config.ts` — `loadBackendConfig()` aggregates every
      missing/invalid env var into one `ConfigValidationError` instead of
      failing one at a time; `SUPABASE_URL`/`ANON_KEY`/`SERVICE_ROLE_KEY`
      deliberately excluded (auto-injected in deployed functions).
- [x] B5 — `payments/mercadopago/{provider,mapping,types}.ts` —
      `MercadoPagoProvider.createPixCharge` + `.getChargeStatus`
      (uncached GET every call — this is the confirm-by-refetch security
      boundary, not a convenience method).
- [x] B6 — `payments/mercadopago/{webhook,crypto}.ts` — `parseWebhook` +
      signature verification (Web Crypto HMAC-SHA256, constant-time
      compare). `hintedStatus` is hardcoded `'unknown'` since Mercado
      Pago's webhook payload carries no status field at all.
- [x] B7 — `video/{registry,youtube-provider,panda-provider,types}.ts` —
      registry keyed by `PlayerKind`; `YouTubeProvider` handles bare ids
      and watch/embed/`youtu.be` URL forms; `PandaProvider.resolve()`
      always throws `PandaProviderNotImplementedError` (deliberate stub,
      not a silent no-op).

  B1-B7 verified 2026-08-26: `deno task test` (114 tests, 0 failures,
  95.0%/96.8%/97.9% branch/function/line coverage), `deno fmt --check`,
  `deno lint`, `deno check` all clean — re-run independently, not just
  taken from the agent's self-report. `backend/deno.json` gained
  `@supabase/supabase-js` in `imports` and `--allow-env` on the `test`
  task; no changes needed to `fmt`/`lint` globs.

  Open items from this pass, not blockers: (1) Mercado Pago's `/v1/payments`
  response shape and the `x-signature`/`x-request-id` HMAC manifest format
  are modeled from public docs, unverified against a live/sandbox call —
  flagged in-code in `types.ts`/`webhook.ts`, re-verify before this gates
  real traffic. (2) `VideoProvider` itself (not `ResolvedVideo`) isn't
  frozen anywhere in the plan doc — designed to mirror `PaymentProvider`'s
  shape (`{ playerKind, resolve(externalRef) }`) for consistency; revisit
  if B12 (`video-resolve`) wants something different.
- [x] B8 — `_shared/payments/confirm-order.ts` — confirm-by-refetch ->
      amount/currency check -> `app.confirm_payment` CAS -> `app.enqueue_email`
      iff `did_transition`. **Corrected consumer pairing**: this checklist
      previously said "shared by B9 and B10" — wrong, checkout (B9) never
      confirms a payment. The actual shared consumers are payments-webhook
      (B10) and payments-reconcile (B11), per the plan doc's "Webhook
      idempotency" section. Confirmed with the user before implementing.
      Verified 2026-09-03: `deno task test` (134/134, new file 100%/100%/100%
      branch/function/line coverage), `deno fmt --check`, `deno lint`,
      `deno check` all clean, plus an inline read of the full implementation
      — matches spec. Judgment calls (all reasonable, kept as implemented):
      throws (never swallows) on any Postgrest error incl. `enqueue_email`
      failure — meaning a failed email enqueue after a successful
      `did_transition` still throws even though the payment itself
      confirmed; a caller retry correctly lands on `already_confirmed` via
      the CAS, but callers must not read "confirmOrder threw" as "payment
      not confirmed". Zero rows back from `confirm_payment` (shouldn't
      happen given step 1 already found the order) throws as an invariant
      violation rather than being mapped to an existing outcome.
- [x] B9 — `checkout` function — first real Edge Function entrypoint in this
      repo. `handler.ts` (testable, DI'd) + thin `index.ts` `Deno.serve`
      wrapper + `validate-request.ts`/`courses.ts`/`orders.ts`/`response.ts`
      helpers. Existing-pending-order reuse relies on Mercado Pago's
      `X-Idempotency-Key` replaying the original charge (flagged inline as
      unverified against a live/sandbox call, same caveat convention as
      `webhook.ts`'s signature-manifest note).
      Verified 2026-09-03: full suite 192/192, `deno fmt --check`/`deno lint`
      clean scoped to `checkout/` (a whole-repo fmt run at the same moment
      caught an in-progress, not-yet-formatted file belonging to the
      concurrently-running B11 agent — unrelated to B9, ignored), `deno
      check` clean, 94.6%/96.0%/97.0% branch/function/line aggregate for the
      new files, plus an inline read of `handler.ts` and `orders.ts` — logic
      matches spec exactly (course-published check, reuse-vs-new-order
      branch, PII excluded from exception-capture properties, provider
      errors mapped to a generic 502 without leaking `MercadoPagoApiError.body`).
      **Known gap, documented not fixed** (same status as A7's other
      documented gaps): `findReusableOrder` + `insertPendingOrder` aren't
      atomic — two concurrent checkout calls for the same (user, course)
      with no existing pending order can each insert a separate order and
      create two distinct PIX charges. `orders` has no partial-unique
      constraint analogous to `enrollments`' `(user_id, course_id) WHERE
      status = 'active'`. Needs a migration to close; out of scope for B9,
      worth a decision before this goes anywhere near real payment volume.
- [x] B10 — `payments-webhook` function — "always ack 200, capture
      everything" design (webhook retries can't fix anything a non-200 would
      be complaining about; reconcile is the real recovery path) — verified
      against inline read of `index.ts`, matches spec exactly.
      **Real gap found and fixed during review, not deferred**: the agent
      itself flagged, and I independently confirmed by reading
      `_shared/payments/mercadopago/webhook.ts`, that `parseMercadoPagoWebhook`
      hardcodes `externalReference: null` on every event (Mercado Pago's real
      `payment`-topic webhook payload only ever carries `data.id`, never our
      order id) — as originally built, `processEvent` always fell into the
      `missing_external_reference` branch for real MP deliveries and
      `confirmOrder` was never reached from the webhook path (not a security
      bug — orders still confirm via B11's reconcile poll, worst case 5 min
      later — but a silent no-op for the webhook's actual purpose). Fixed by
      sending the finding back to the same agent for a scoped, additive fix:
      `processEvent` now falls back to `orders.provider_charge_id =
      event.providerChargeId` (A7's unique index; checkout/B9 already writes
      that column at charge creation) when `externalReference` is null, and
      only reports `missing_external_reference` if that lookup ALSO finds
      nothing. Doesn't touch `webhook.ts`/`confirm-order.ts`.
      Verified 2026-09-03 (post-fix): full suite 252/252, `deno fmt --check`/
      `deno lint`/`deno check` clean across the whole repo, 96.4%/100%/96.0%
      on `index.ts`, plus an inline read of the fallback lookup logic.
      **Separately flagged, not fixed, needs a decision**: Mercado Pago's
      webhook payload has no status field at all, so this function has no
      signal to detect a refund event and never calls `app.refund_order` —
      refunds currently have no automated trigger anywhere in the built
      system. Not this task's scope; needs a decision on where that logic
      belongs (a new webhook topic branch? a separate reconcile check
      against `getChargeStatus` for `paid` orders?).
- [x] B11 — `payments-reconcile` function (cron) — reconciliation pass
      (re-runs `confirmOrder` over `pending` orders older than 3 minutes
      with a `provider_charge_id`) then expiry sweep (`app.expire_stale_orders`),
      in that order deliberately (so an order confirmed this tick can't also
      get swept by the same tick's expiry check). Sequential, not
      `Promise.all`, over candidates — bounded/predictable gateway call
      volume.
      Verified 2026-09-03: full suite 249/249, `deno fmt --check`/`deno
      lint`/`deno check` clean scoped to the function, 91.9%/100%/89.2% on
      `index.ts` (100% on all its small helper files), plus an inline read
      of `index.ts` — outcome-to-counter mapping is correct (`confirmed`/
      `already_confirmed` -> confirmed; `amount_mismatch`/`order_not_found`
      -> failed; `not_paid` -> no-op), `X-Cron-Secret` check gates all DB
      work, `limit` clamped to [1,100] default 100 matching the NFR table.
- [x] B12 — `video-resolve` function — `createCallerClient` only (never
      service_role, verified by inline read — this is what keeps `auth.uid()`
      correct inside `app.get_playable_ref`'s entitlement check). Same 403
      `not_entitled` response for both "lesson missing" and "not entitled",
      preserving the RPC's zero-rows-never-an-error property. Panda rows hit
      the real (still-stubbed) `PandaProvider.resolve()` and are treated as
      an ordinary resolution failure, not special-cased.
      Verified 2026-09-03: full suite 166/166 (includes in-progress B9 files
      already on disk), new file 91.7%/100%/93.5% branch/function/line
      (uncovered lines are the `import.meta.main`-gated real `Deno.serve`
      wiring and two generic rethrow branches — reasonable, not required
      behavior), `deno fmt --check`/`deno lint`/`deno check` all clean, plus
      an inline read of the full implementation — matches spec.
      Judgment calls, all reasonable: `loadBackendConfig()` (which validates
      the *entire* `BackendConfig`, not just this function's slice) is gated
      behind `if (import.meta.main)` rather than unconditional module scope,
      so `deno test` can import this file without every secret (Mercado
      Pago, Resend, etc.) being set — real deployment still runs it at cold
      start since Supabase's Edge Runtime executes the file as the entry
      point. `video_resolve_failed` isn't actually in `ServerEventName`'s
      *server*-side union (it's a client-only event name per the frozen
      list; correctly caught by the agent) — routed through
      `captureExceptionAndFlush`'s `$exception` event with
      `reason: 'video_resolve_failed'` in properties instead of inventing a
      new server event name. Spends an extra `auth.getUser()` round trip for
      `distinctId` attribution on the denial/success paths, falls back to a
      fixed `'anonymous'` id on exception paths and on `auth.getUser()`
      failure.
- [x] B13a — `_shared/email/` — `resend-client.ts` (`sendEmail`, throws
      `ResendApiError` on failure rather than the "never throws"
      observability convention — deliberate, so `outbox-drain`/B13b can
      catch per-row failures to drive its attempts/backoff/dead-letter
      bookkeeping), `templates/{welcome,purchase-confirmation,stubs}.ts` +
      shared `html-helpers.ts` (`escapeHtml`/`renderEmailLayout`, the
      agent's own addition beyond the suggested file split — reasonable,
      avoids duplicating the inline-styled HTML shell). Template renderers
      take fully-resolved data, not raw outbox rows — `outbox-drain` will
      own the DB joins. `password_reset`/`course_completion` are stubs that
      throw `EmailTemplateNotImplementedError`, matching `PandaProvider`'s
      established stub convention. Portuguese subject/body copy, per the
      existing Track C precedent for end-user-facing content.
      Verified 2026-09-03: full suite 283/283, `deno fmt --check`/`deno
      lint`/`deno check` all clean, 100% branch/function/line on every new
      file, plus inline reads of `resend-client.ts` (mirrors
      `MercadoPagoProvider`'s defensive-parsing convention correctly) and
      `purchase-confirmation.ts` (BRL formatting and HTML-escaping of
      untrusted course-title/full-name data both correct).
- [x] B13b — `outbox-drain` function (cron) — resolves each
      `app_private.email_outbox` row into template-specific data (`welcome`
      -> `users.full_name` by `payload.user_id`; `purchase_confirmation` ->
      `courses.title` + **`orders.amount_cents`/`currency`** by
      `payload.course_id`/`order_id`, deliberately the order's own charged
      amount, never `courses.price_cents`, in case price changed since) via
      `resolve-template.ts`, then render/send/update per row, isolated so
      one bad row never aborts the batch. `failed` (retryable, attempts < 5)
      and `deadLettered` (terminal, 5th failure) are mutually exclusive
      counters; `picked = sent + failed + deadLettered` always holds.
      Caught and correctly fixed an error in my own task brief: I'd said to
      emit the frozen `'email_dead_lettered'` event via
      `captureExceptionAndFlush`, but that function hardcodes its event name
      to PostHog's reserved `$exception` and has no way to emit a custom
      event name — the agent used `captureAndFlush` with the literal frozen
      event name instead (correct) and preserved the underlying error
      message in `properties.lastErrorMessage` rather than dropping it.
      Verified 2026-09-03: full suite 331/331, `deno fmt --check`/`deno
      lint`/`deno check` all clean, 91-100% coverage across new files, plus
      an inline read of `process-candidate.ts` confirming the counter logic
      and the dead-letter event-name fix. **Live-verified end-to-end**
      beyond unit tests, added `[functions.outbox-drain]` (`verify_jwt =
      false`) to `config.toml` myself and hit the real running function: a
      real `X-Cron-Secret`-gated 401, then a real 200 run that picked up two
      genuine leftover `welcome` rows in the seeded DB (from Track A's
      2026-08-27 security-review synthetic users), correctly joined
      `app_private.email_outbox` -> `public.users` for each, attempted a
      real Resend API call (which failed, as expected — the local `.env`
      only has a placeholder `RESEND_API_KEY`), and correctly persisted
      `status: 'failed', attempts: 1` on both rows (confirmed via a direct
      PostgREST query against `app_private.email_outbox` with the
      service-role key) — the full resolve/render/send/update pipeline
      works against the real schema, not just mocks.

**Track B (Edge Functions) is now fully done: B1-B14, all 14 items.**

## Security + code review, B8-B14 (2026-09-03)

Dedicated `security-reviewer` and `code-reviewer` passes on everything built
this session (confirm-order.ts, checkout, payments-webhook,
payments-reconcile, video-resolve, `_shared/email/`, outbox-drain) —
neither had been reviewed before (the earlier 2026-08-27 review predates all
of it). Both reports independently spot-checked by re-reading the flagged
code, not taken on the reviewers' word alone.

**Fixed immediately (clear-cut, no design tradeoff):**
- Security MEDIUM — `outbox-drain/process-candidate.ts` used the
  recipient's real email address (PII) as the PostHog `distinctId` on every
  capture (`email_sent`, `email_dead_lettered`, retryable-failure, and
  bookkeeping-update-failure events), inconsistent with every other
  function in this backend (all use non-PII ids — user/order uuids or a
  fixed system id). Fixed: now uses `candidate.id` (the outbox row's own
  uuid). Verified: `distinctId` values in `process-candidate.ts` re-read,
  all four call sites confirmed changed; two test assertions updated to
  match; full suite re-run, 331/331 still green.
- Code-review HIGH (test-hygiene, not a production bug) —
  `payments-reconcile/index.test.ts`'s `baseDeps()` never defaulted
  `captureFn`/`captureExceptionFn`, so any test not explicitly overriding
  them fell through to the REAL `captureAndFlush`, which performs a genuine
  `fetch` to PostHog's real API — silently inert only because `deno task
  test` runs without `--allow-net` (the permission error gets swallowed by
  `captureAndFlush`'s own try/catch into an unchecked `{ ok: false }`).
  Verified directly: grepped the test file, confirmed only one of the
  affected tests explicitly passed `captureFn`. Fixed: `baseDeps()` now
  defaults both to no-op fakes, matching how `fetchCandidateOrdersFn`/
  `expireStaleOrdersFn` were already defaulted.

**Not fixed, needs a decision on priority/scope (see "Next step"):**
- Security LOW — `payment_events.status` records `amount_mismatch`/
  `order_not_found` outcomes identically to a normal `'processed'`
  confirmation, weakening the durable audit trail's ability to distinguish
  "confirmed" from "tampering/mismatch detected" if the PostHog capture is
  ever lost (not exploitable for money theft — the CAS still correctly
  refuses to transition — but an audit/incident-response gap).
- Security LOW — cron-secret checks in `payments-reconcile`/`outbox-drain`
  use plain `!==` rather than the repo's own `timingSafeEqualHex` helper;
  reviewer's own assessment is this isn't practically exploitable over the
  public internet, flagged for consistency/defense-in-depth only.
- Code-review MEDIUM — two genuine extraction candidates identified with
  evidence (not just "some duplication exists"): (1) `payments-reconcile`
  and `outbox-drain` each independently re-derive an ~50-line-identical
  cron-secret-check + body-parse-with-fallback preamble; (2) `checkout`/
  `payments-reconcile`/`outbox-drain`'s three `fakes.ts` files
  (~394 lines total) each hand-roll the same chainable-Postgrest-fake
  pattern from scratch, each one's own header comment cross-referencing the
  others as prior art. Reviewer explicitly found the DI-scaffolding and
  `import.meta.main`-wiring patterns NOT worth extracting (genuinely
  function-specific, small) — only these two.
- Code-review MEDIUM — `checkout` splits handler/wiring into two files
  (`index.ts`+`handler.ts`); the other four functions built after it put
  both in one `index.ts`. Two conventions carried forward across five
  related functions; reviewer recommends standardizing (mechanical,
  low-risk) next time any of these files is touched, not urgent on its own.
- Code-review LOW — `payments-webhook`/`outbox-drain`'s per-item batch
  loops carry an extra "defensive second safety net" try/catch around their
  per-item helper that `payments-reconcile`'s loop lacks; traced and
  confirmed genuinely inert everywhere it exists (`captureAndFlush`/
  `captureExceptionAndFlush` are hard-guaranteed to never throw), so it's
  an inconsistency between three structurally-identical loops, not a bug.

No CRITICAL or HIGH security issues; no correctness bugs in the production
code paths. Both reviewers explicitly confirmed the money-integrity,
webhook-trust-boundary, and video-entitlement logic hold up against the
frozen design's stated security boundaries.
- [x] B14 — `config.toml` per-function `verify_jwt` settings — `checkout`/
      `video-resolve` -> `true`, `payments-webhook`/`payments-reconcile` ->
      `false` (cron functions gated by their own `X-Cron-Secret` check in
      code instead). `outbox-drain`'s block intentionally left as a
      to-add-later comment since that function doesn't exist yet.
      Verified live, not just written blind: full `supabase stop`/`start`
      cycle with the new config parses clean, and a real `curl` against each
      of the four already-built functions confirms the platform-level JWT
      gate actually fires for `checkout`/`video-resolve` (401
      `UNAUTHORIZED_NO_AUTH_HEADER` with no `Authorization` header, before
      even reaching our own code) and does NOT fire for
      `payments-webhook`/`payments-reconcile` (reaches our own logic
      instead — `payments-reconcile` then correctly 401s on its own
      `X-Cron-Secret` check).

  **Real deploy-blocking bug found and fixed while verifying B14, affecting
  every Edge Function built so far** (not caught by `deno task test`,
  `deno check`, or any of the agents' own verification — none of that runs
  against the actual Supabase Edge Runtime): every function boot-crashed
  with `Relative import path "@supabase/supabase-js" not prefixed with / or
  ./ or ../`. Root cause: `backend/deno.json`'s `imports` map (which is what
  makes `@supabase/supabase-js` resolve for `deno test`/`deno check`, run
  from `backend/`) lives OUTSIDE `backend/supabase/`, and Supabase's
  edge-runtime container only mounts/resolves within `backend/supabase/` —
  it never sees the parent `deno.json`. This is the exact risk flagged in
  this file's 2026-08-25 decisions-log entry ("unconfirmed whether ...
  survives that bundling step the same way local `deno test`/`deno check`
  do"), just never actually checked against a live edge runtime until now —
  every function from B9 through B12 (checkout, video-resolve,
  payments-webhook, payments-reconcile) had only ever been proven correct
  under `deno test`, never proven to actually boot.
  Fix: added `backend/supabase/functions/deno.json` with just the one bare
  specifier actually used by runtime code (confirmed via grep —
  `@supabase/supabase-js` is the only one; `@std/assert` is test-only and
  not part of the deployed bundle):
  ```json
  { "imports": { "@supabase/supabase-js": "jsr:@supabase/supabase-js@2" } }
  ```
  Also added `backend/supabase/functions/.env` (gitignored via the root
  `.gitignore`'s bare `.env` pattern, confirmed) with fake-but-well-formed
  local values for every required `BackendConfig` var, purely so
  `loadBackendConfig()` doesn't fail-fast during local smoke testing — NOT
  real secrets, never to be used beyond `supabase start`.
  Post-fix, live-verified via `curl` against a freshly restarted stack: all
  four functions now boot and respond with their own application logic
  (`payments-webhook` -> `200 {"received":true}` on an empty body;
  `payments-reconcile` -> its own 401 on missing `X-Cron-Secret`;
  `checkout`/`video-resolve` -> their own 400 `invalid_body` once given a
  valid anon JWT). This is the first time any of B9-B12 have been proven to
  actually run outside `deno test`.

### Track C — Frontend (C1-C6/C9 done; C7/C8/C10/C11 still blocked on Edge Functions)

- [x] C1 — App shell: `App.tsx` (composition root: QueryClientProvider →
      PostHogProvider → AuthProvider → Router), `components/Layout.tsx`,
      `components/ErrorBoundary.tsx`, `lib/queryClient.ts`,
      `lib/supabaseClient.ts`, `lib/env.ts` (eager fail-fast validation at
      module load — throws listing every missing/blank/malformed `VITE_`
      var, verified by inline read).
- [x] C2 — Design primitives: `components/ui/{Button,Input,Card,Alert,
      Spinner,EmptyState}.tsx`, presentational, each with a `.module.css`
      and full test coverage.
- [x] C3 — PostHog provider + LGPD consent gate: `features/analytics/
      {eventNames,posthogClient,AnalyticsContext,useAnalytics,
      ConsentBanner,PostHogProvider}.ts(x)`. `posthog.init` only ever
      called after consent granted; `capture()` is a ref-gated no-op until
      then — structural, not conventional.
- [x] C4 — `features/auth/{AuthContext,useAuth,AuthProvider,authErrors,
      ProtectedRoute}.ts(x)` — injectable Supabase client for testing.
- [x] C5 — `pages/{LoginPage,SignupPage}.tsx` — signup shows a "check your
      email" success state per the email-confirmation requirement, doesn't
      imply immediate access.
- [x] C6 — `features/courses/{types,coursesApi,useCourses}.ts` +
      `pages/CatalogPage.tsx` — queries `courses_public` directly via
      PostgREST, never through an Edge Function, per the NFR budget.
- [ ] C7 — Course detail page
- [ ] C8 — Checkout page — needs `checkout` (B9) for full end-to-end test,
      can be built/tested against a stub in the meantime
- [x] C9 — `features/video/{playerRegistry,LessonPlayer,YouTubePlayer,
      PandaPlayerStub}.tsx` — youtube branch renders a real
      `youtube-nocookie.com` iframe; panda branch is a clearly-marked,
      testable stub; unrecognized `playerKind` throws via an `assertNever`
      exhaustiveness guard (verified by inline read) rather than
      rendering blank.
- [ ] C10 — Video player page — depends on C9 and `video-resolve` (B12)
- [ ] C11 — My courses page

  C1-C6/C9 verified 2026-08-26: re-ran `npm run build`/`npm test`/
  `npm run lint` myself (build clean, 143/143 tests across 29 files,
  lint clean), plus inline-read `lib/env.ts` and
  `features/video/playerRegistry.tsx` — both solid. Not just taken from
  the agent's self-report.

  Deviations/judgment calls from this pass, not blockers: (1)
  `src/config/brand.ts` added early (placeholder `COMPANY_NAME`) since the
  plan doc names that exact path as a deliverable, even though it isn't
  one of C1-C9. (2) UI copy (labels/buttons/errors/consent text) is in
  Portuguese, code/comments/test descriptions in English — treated as
  "business-facing" content given the target audience (PIX, LGPD, CDC art.
  49). (3) `CoursePublic` keeps the view's snake_case field names
  (`price_cents`, `access_duration_days`) rather than a camelCase DTO
  layer, being a direct read-only passthrough. (4) `LessonPlayer` exposes
  an `onPlay` callback rather than firing `video_played` itself, staying
  analytics-agnostic — C10 is expected to wire that callback to
  `useAnalytics().capture`. (5) No `App.tsx`-level integration test — it's
  a thin composition root with no branching logic, every child it wires
  already has full coverage. (6) Fixed a real test-harness gap:
  `src/test/setup.ts` was missing Testing Library's per-test `cleanup()`
  (`vite.config.ts` has `test.globals` off, so RTL's auto-cleanup
  `afterEach` never ran) — DOM nodes were leaking across tests within a
  file. Added explicit `afterEach(() => cleanup())`.

### Track D — Docs

- [x] D1 (frontend half) — `frontend/.env.example` done as part of F1
- [x] D1 (backend half) — `backend/.env.example`, per the frozen env var
      list. Cross-checked field-by-field against `_shared/config.ts`'s
      actual `readRequired`/`optionalEnv` calls (not just the plan doc's
      list) to get required-vs-optional-with-default exactly right.
- [x] D2 — root `README.md` (scoped to local dev setup only, per user
      request 2026-09-04 — not the full phase-6 deploy/ADR scope, see "What
      this doesn't cover" section in the file itself). Portuguese, per
      explicit user choice for this file (overriding this project's own
      English-throughout precedent in code/PROGRESS.md/the plan doc — user
      was asked directly given the two conventions disagreed).
      Every command and the full curl walkthrough (signup -> JWT -> real
      `checkout` call) actually run against the live local stack before
      writing them down, not just described from memory: signup confirmed
      returning a usable `access_token`, `checkout` confirmed reaching real
      application logic (course lookup, order creation, provider call) and
      failing with the expected `502 payment_provider_error` given the
      fake local Mercado Pago credentials — documented that expected
      failure explicitly so it doesn't read as a bug to a new developer.
      `deno task test`/`fmt`/`lint` re-run clean after adding both new
      files (331/331).
- [ ] D3 — ADRs (Mercado Pago vs Efí, YouTube-unlisted accepted risk,
      deferred admin UI, LGPD retention)
- [ ] D4 — `docs/runbook-youtube-to-panda.md`

## Gestão de cursos em /admin (tickets #17-#21)

Especificação em #2 (mapa) e ADR 0002; vocabulário em `GLOSSARY.md`.

- [x] #17 módulos: adicionar, renomear, reordenar, arquivar, excluir (A31)
- [x] #18 aulas: adicionar, editar, reordenar, mover, arquivar, excluir (A32)
- [x] #19 vídeo da aula: definir e substituir, com parser compartilhado (A33)
- [x] #20 transições de status, portão de publicação e exclusão de curso (A34)
- [x] #21 E2E dos caminhos críticos (`frontend/e2e/admin-courses.spec.ts`) e remoção do protótipo

O protótipo da UI nunca entrou em `main`: vive só no branch `prototype/admin-courses`
(local e `origin`), então não há diretório, rota, provider nem script `proto:courses` a
remover. O branch foi mantido; apagá-lo é decisão separada.

E2E: pré-requisitos no README ("Testando E2E com Playwright"). Dois pontos que
pegaram na primeira execução: `supabase functions serve` precisa de `POSTHOG_API_KEY` e
`POSTHOG_HOST` no arquivo de env (status de curso passa pela Edge Function), e o banner de
consentimento (LGPD) cobre o rodapé, então `loginViaUi` recusa o consentimento de antemão.

Desvio do critério do ticket: visitante anônimo em `/admin/courses` é redirecionado para
`/login` (`ProtectedRoute`, comportamento já coberto por testes unitários), não recebe 404; o
E2E afirma o redirecionamento e a ausência de conteúdo administrativo. O 404 vale para
usuário autenticado sem papel de equipe.

## Decisions log

- 2026-08-23 — PIX gateway: Mercado Pago (Efí ruled out — mTLS requirement
  incompatible with Supabase Edge Functions).
- 2026-08-23 — Data model frozen per architect review: `lesson_assets` split
  into `app_private`, `orders` gained provider/txid/expiry columns,
  `enrollments` gained `expires_at`, added `payment_events`/`email_outbox`.
- 2026-08-24 — Enrollment: per-course `access_duration_days` (`NULL` =
  lifetime); refunds auto-revoke via webhook; money = integer cents
  everywhere; MVP explicitly excludes coupons, CPF/nota fiscal collection,
  and manual/comp enrollment grants.
- 2026-08-24 — Frontend scaffolded (F1 + F2 frontend halves). Backend
  scaffolding blocked on missing `deno`/Supabase CLI; repo left ungitted and
  frontend-only for now, per user choice.
- 2026-08-25 — `deno` + Supabase CLI installed; backend halves of F1/F2 done.
  Shared TS contracts placed at top-level `backend/contracts/` (user's
  explicit choice over co-locating under
  `backend/supabase/functions/_shared/contracts/`). Flagged risk, not yet
  resolved: Supabase Edge Functions deploy/bundle each function starting
  from its entrypoint, and it's unconfirmed whether a relative import
  reaching outside `supabase/functions/` (e.g. `../../../contracts/video.ts`
  from `supabase/functions/checkout/index.ts`) survives that bundling step
  the same way local `deno test`/`deno check` do. **Revisit at the start of
  Track B** (first Edge Function that needs to import a contract) — if plain
  relative imports don't survive `supabase functions deploy`, add a
  `supabase/functions/import_map.json` alias instead of moving the files.
- 2026-08-25 — `backend/contracts/payments.ts` defines `RefundResult`, which
  is referenced by `PaymentProvider.refund()` in the plan doc's frozen
  contract block (prompt_course_platform.md lines ~377-384) but never
  actually defined there — a gap in the source doc. Filled in locally,
  shaped like `ChargeSnapshot` to match the doc's existing convention.
  Low-risk: `refund()` is optional and not called by any Track A/B task in
  this checklist (refunds are webhook/reconciliation-driven, not
  provider-API-initiated, in the MVP flow) — but worth a sanity check
  against the plan doc if/when `refund()` actually gets implemented.
- 2026-08-26 — Both Track A and Track C agents stopped mid-run (Track A: API
  connection error right after "A13 green, starting A14"; Track C: 600s
  stall during its own final verification pass). Verified actual on-disk
  state independently before resuming either (not just trusting the crash/
  stall summaries): Track A's A1-A13 are genuinely done (`supabase test db`
  re-run myself: 14 files, 229 tests, all green); A14's migration is
  written and solid but its pgTAP test file was still the unfilled
  scaffold; A16 (`seed.sql`) was already done and substantive; A17 not
  started. Track C's build/test/lint all came back clean and its file tree
  matches the full C1-C6/C9 scope with a `.test` file per module — likely
  done, pending its own confirmation. Both resumed with precise, verified
  briefs rather than re-running their original instructions blind.
- 2026-08-27 — Track A went quiet for 15+ hours with no file changes and no
  completion/stall notification (its own harness watchdog never tripped,
  even though it had visibly stalled twice before at similar mid-track
  points). Confirmed via file mtimes and `docker stats`/Postgres session
  state that the local stack was healthy and idle (not the bottleneck),
  then sent it a direct status-check message rather than assuming it was
  dead. It came back with a complete, verified final report shortly after
  (either the message unstuck it, or it was still genuinely working on the
  A15 completeness pass — can't tell which from outside). Track A is now
  fully done (A1-A17) and independently re-verified: clean `supabase db
  reset` + `supabase test db` (331/331), plus a hands-on check of the
  privilege-leak fix it reported (see Track A checklist above for detail)
  and an inline read of the `confirm_payment` CAS migration.
- 2026-08-26 — Found and fixed a pre-existing bug (not introduced by any
  agent — `.oxlintrc.json` untouched since F1, never caught because F1's
  verification only covered `npm run build`/`npm test`): oxlint 1.79.0
  returns "No files found to lint" for any directory argument or its own
  `**` glob syntax in this environment (reproduced with `--no-ignore` and
  by invoking the binary directly, bypassing `npx` — a real tool quirk,
  not a config mistake). Individual explicit file paths lint fine.
  `frontend/package.json`'s `lint` script changed from bare `oxlint` to
  `oxlint $(find src -type f \( -name '*.ts' -o -name '*.tsx' \))`;
  verified `npm run lint` now runs and passes clean. **Root cause
  confirmed** (Track C agent tested by copying `frontend/src` to `/tmp`
  and re-running there, where it worked correctly): oxlint's `ignore` crate
  walks all ancestor directories for `.gitignore` files, and since
  `courseplatform` has no `.git` to stop that walk, it reaches
  `~/.gitignore`, which has a `workspace/` line (confirmed present) that
  matches everything under `~/workspace/` — the same directory this whole
  project lives in. This is a machine-wide footgun, not courseplatform-
  specific: any `ignore`-crate tool (ripgrep, fd, oxlint, ...) run with a
  directory argument from inside any git-less project under `~/workspace/`
  will silently match nothing, usually with no error at all (ripgrep would
  just return empty results, not "No files found"). Told the user directly
  outside this file since it's outside this project's scope.
- 2026-08-26 — Kicked off phase 4 parallel implementation per the plan doc:
  three `tdd-guide` agents launched in parallel (Track A: SQL/RLS, Track B:
  Edge Function shared modules B1-B7, Track C: unblocked frontend). None
  were told to edit this file, to avoid concurrent-write races; the main
  session updates it from each agent's report instead. Track B finished
  first (see checklist above) and was independently re-verified (tests,
  fmt, lint, check re-run, two files read inline), not just trusted from
  the self-report. Track C's first run died mid-turn to a transient
  connection error before writing any files (confirmed via `npm test`
  finding zero test files, `find src` showing no new files) — resumed
  cleanly from the same brief, no reconciliation needed. Track A and the
  resumed Track C are still running as of this entry.

## Next step

Track F, A, and B (B1-B14, all of it) are done. B8-B14 were built and
independently re-verified this session (2026-09-03) — tests/fmt/lint/check
for each, plus inline reads of the actual logic, not just self-reports.
Two real bugs were found and fixed along the way, not deferred:
1. `payments-webhook`'s `parseMercadoPagoWebhook` hardcodes
   `externalReference: null` (Mercado Pago's real webhook payload never
   carries our order id) — fixed with a `provider_charge_id` fallback
   lookup in `payments-webhook/index.ts`.
2. Every Edge Function failed to boot on the real Supabase Edge Runtime
   (`@supabase/supabase-js` bare-specifier resolution failure — confirmed
   live via `curl` against a restarted local stack, not just `deno test`)
   — fixed with `backend/supabase/functions/deno.json`. This was the exact
   risk flagged in the 2026-08-25 decisions-log entry below, never actually
   checked until now. **Worth remembering for any future Edge Function**:
   `deno test`/`deno check` passing from `backend/` does NOT prove a
   function boots — only a live `supabase start` + `curl` does, since the
   edge-runtime container only sees `backend/supabase/`, never
   `backend/deno.json` above it.

Two things flagged during B8-B14, not fixed, genuinely need a decision
(not a re-run — a judgment call):
- **Refund handling has no automated trigger anywhere in the built
  system.** Mercado Pago's webhook payload carries no status field, so
  `payments-webhook` can never detect a refund event and never calls the
  already-migrated `app.refund_order`. Needs a decision on where this
  logic should live (a reconcile-side check against `getChargeStatus` for
  already-paid orders? something else?) before this matters for real money.
- **`checkout`'s existing-order lookup + insert isn't atomic** — two
  concurrent double-clicks with no existing pending order can each create
  a separate order/PIX charge. No migration exists for this; `orders` has
  no partial-unique constraint analogous to `enrollments`'
  `(user_id, course_id) WHERE status = 'active'`.
- (Carried over, still unresolved) The original Track A/B/C security
  review's one open item — `enable_confirmations = false` means signup
  returns a live session with no email-verification step — is now directly
  relevant since checkout (money-handling) is built. See "Security review"
  above for the full writeup and recommended fix.

Track C's remaining items are now unblocked (Track B is no longer a
blocker) but not started:
- C7 (course detail), C8 (checkout — build against the now-real `checkout`
  function, not a stub), C10 (video player — needs C9 + the now-real
  `video-resolve`), C11 (my courses).

Before or alongside Track C, worth a `security-reviewer` + `code-reviewer`
pass specifically on B8-B14 — the only review those functions have had so
far is this session's own tests/fmt/lint/inline-reads and live `curl`
smoke tests, not a dedicated adversarial security pass (the existing
"Security review" section below predates all of B8-B14 entirely). Given
this track is the money/PII-handling surface (PIX charges, webhook
signature verification, email PII), and given Track A's own privilege-leak
precedent (a real hole caught by a second pass, not the first), this is
worth doing before Track C wires the frontend to it, not after.

Local Supabase stack is currently up and healthy (restarted twice this
session to validate `config.toml`/import-map changes against the live edge
runtime) — `supabase stop` before a long idle period, `supabase start` to
resume. `backend/supabase/functions/.env` now exists with fake-but-
well-formed local values (gitignored, not real secrets) so the deployed
functions boot locally without needing real Mercado Pago/Resend/PostHog
credentials — real `backend/.env.example` (D1, still not done) should
document the same var list without fake values.
