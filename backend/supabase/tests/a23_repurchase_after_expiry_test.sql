-- A23 -- recompra apos expiracao (ADR 0003): confirm_payment fecha a
-- matricula expirada e cria a nova na mesma transacao.
BEGIN;
SELECT plan(14);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'expired@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'valid@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'refunded@example.test');

INSERT INTO public.courses (id, title, price_cents, status, access_duration_days) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Timed Course', 10000, 'published', 30);

-- User 1: enrollment expired yesterday, still status 'active' (the bug).
INSERT INTO public.enrollments (id, user_id, course_id, status, granted_at, expires_at) VALUES
  ('e0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-00000000000a', 'active',
   now() - interval '31 days', now() - interval '1 day'),
  ('e0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-00000000000a', 'active',
   now() - interval '1 day', now() + interval '29 days');

INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status) VALUES
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending'),
  ('00000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending'),
  ('00000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333',
   'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending');

-- Refunded history for user 3 (re-enroll must keep working).
INSERT INTO public.enrollments (id, user_id, course_id, status, granted_at, expires_at) VALUES
  ('e0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333',
   'c0000000-0000-0000-0000-00000000000a', 'refunded', now() - interval '5 days', now() + interval '25 days');

SET LOCAL ROLE service_role;

-- Expired enrollment + new paid order => transition and a NEW enrollment.
SELECT results_eq(
  $$ SELECT did_transition, order_status, enrollment_id IS NOT NULL
       FROM app.confirm_payment('00000000-0000-0000-0000-000000000001'::uuid, 'mp-1', now()) $$,
  $$ VALUES (true, 'paid', true) $$,
  'repurchase: transition fires and returns the new enrollment id'
);
SELECT is(
  (SELECT status FROM public.enrollments WHERE id = 'e0000000-0000-0000-0000-000000000001'),
  'expired',
  'repurchase: the expired enrollment is closed as expired'
);
SELECT is(
  (SELECT expires_at FROM public.enrollments WHERE id = 'e0000000-0000-0000-0000-000000000001') < now(),
  true,
  'repurchase: the closed enrollment keeps its original expires_at'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments
    WHERE user_id = '11111111-1111-1111-1111-111111111111' AND status = 'active'),
  1,
  'repurchase: exactly one active enrollment'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments
    WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  2,
  'repurchase: history preserved (expired + new)'
);
SELECT ok(
  (SELECT expires_at > now() + interval '29 days' FROM public.enrollments
    WHERE user_id = '11111111-1111-1111-1111-111111111111' AND status = 'active'),
  'repurchase: the new enrollment gets a fresh expiry from the course duration'
);
SELECT is(
  app.has_active_enrollment('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a'),
  true,
  'repurchase: student has access again'
);

-- Duplicate webhook delivery: no second transition, no extra enrollment.
SELECT results_eq(
  $$ SELECT did_transition FROM app.confirm_payment('00000000-0000-0000-0000-000000000001'::uuid, 'mp-1', now()) $$,
  $$ VALUES (false) $$,
  'repurchase: duplicate confirmation does not transition again'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments
    WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  2,
  'repurchase: duplicate confirmation creates no extra enrollment'
);

-- Valid (unexpired) enrollment is never closed by a stray confirmation.
SELECT app.confirm_payment('00000000-0000-0000-0000-000000000002'::uuid, 'mp-2', now());
SELECT is(
  (SELECT status FROM public.enrollments WHERE id = 'e0000000-0000-0000-0000-000000000002'),
  'active',
  'valid access: unexpired enrollment is left active'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments
    WHERE user_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'valid access: no second enrollment is created'
);

-- Refunded then re-enrolled keeps working.
SELECT results_eq(
  $$ SELECT did_transition, enrollment_id IS NOT NULL
       FROM app.confirm_payment('00000000-0000-0000-0000-000000000003'::uuid, 'mp-3', now()) $$,
  $$ VALUES (true, true) $$,
  'refunded user: re-enroll creates a new active enrollment'
);
SELECT is(
  (SELECT status FROM public.enrollments WHERE id = 'e0000000-0000-0000-0000-000000000003'),
  'refunded',
  'refunded user: the refunded row stays refunded'
);

-- 'expired' is an accepted status value.
SELECT lives_ok(
  $$ UPDATE public.enrollments SET status = 'expired' WHERE id = 'e0000000-0000-0000-0000-000000000003' $$,
  'status check accepts expired'
);

SELECT * FROM finish();
ROLLBACK;
