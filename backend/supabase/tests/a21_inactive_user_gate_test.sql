-- A21 -- inactive user gate (ADR 0001, decisao 5): desativacao bloqueia
-- entitlement (has_active_enrollment, get_playable_ref incl. free preview);
-- matriculas ficam intactas; reativar restaura; confirm_payment ainda
-- confirma pedido pendente de usuario inativo.
BEGIN;
SELECT plan(16);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'student@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'pending-payer@example.com');

INSERT INTO public.courses (id, title, price_cents, status) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Gate Course', 10000, 'published');

INSERT INTO public.lessons (id, course_id, title, position, is_free_preview) VALUES
  ('11111111-2222-3333-4444-555555555501', 'c0000000-0000-0000-0000-00000000000a', 'Regular', 1, false),
  ('11111111-2222-3333-4444-555555555502', 'c0000000-0000-0000-0000-00000000000a', 'Preview', 2, true);

INSERT INTO app_private.lesson_assets (lesson_id, provider, external_ref, is_active) VALUES
  ('11111111-2222-3333-4444-555555555501', 'youtube', 'yt-regular', true),
  ('11111111-2222-3333-4444-555555555502', 'youtube', 'yt-preview', true);

INSERT INTO public.enrollments (user_id, course_id, status, granted_at, expires_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a', 'active', now(), NULL);

-- Active user: entitled.
SELECT is(
  app.has_active_enrollment('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a'),
  true,
  'active user with an active enrollment is entitled'
);

-- Deactivate.
UPDATE app_private.user_access SET is_active = false
  WHERE user_id = '11111111-1111-1111-1111-111111111111';

SELECT is(
  app.has_active_enrollment('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a'),
  false,
  'deactivated user is NOT entitled (two-arg overload)'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  app.has_active_enrollment('c0000000-0000-0000-0000-00000000000a'),
  false,
  'deactivated user is NOT entitled (policy-facing wrapper)'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-555555555501'::uuid)),
  0,
  'deactivated enrolled user gets zero rows for a regular lesson'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-555555555502'::uuid)),
  0,
  'deactivated user gets zero rows even for a free-preview lesson'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments),
  1,
  'deactivated user still sees own enrollment row (enrollments are kept)'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.enrollments
     WHERE user_id = '11111111-1111-1111-1111-111111111111' AND status = 'active' AND expires_at IS NULL),
  1,
  'deactivation left the enrollment row untouched (active, no expiry)'
);

-- Reactivate.
UPDATE app_private.user_access SET is_active = true
  WHERE user_id = '11111111-1111-1111-1111-111111111111';

SELECT is(
  app.has_active_enrollment('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a'),
  true,
  'reactivated user is entitled again'
);

SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-555555555501'::uuid)),
  1,
  'reactivated user resolves the regular lesson again'
);
SELECT is(
  (SELECT count(*)::int FROM app.get_playable_ref('11111111-2222-3333-4444-555555555502'::uuid)),
  1,
  'reactivated user resolves the free preview again'
);
RESET ROLE;

-- Missing user_access row keeps pre-A21 behaviour (entitled by enrollment).
DELETE FROM app_private.user_access WHERE user_id = '11111111-1111-1111-1111-111111111111';
SELECT is(
  app.has_active_enrollment('11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000a'),
  true,
  'a user without a user_access row is treated as active (pre-A21 behaviour)'
);

-- Webhook path: confirm_payment still confirms a pending order of an
-- inactive user; access stays blocked by has_active_enrollment.
UPDATE app_private.user_access SET is_active = false
  WHERE user_id = '22222222-2222-2222-2222-222222222222';

INSERT INTO public.orders (id, user_id, course_id, amount_cents, currency, provider, status)
VALUES ('0d000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
        'c0000000-0000-0000-0000-00000000000a', 10000, 'BRL', 'mercadopago', 'pending');

SELECT is(
  (SELECT did_transition FROM app.confirm_payment('0d000000-0000-0000-0000-000000000001', 'charge-inactive', now())),
  true,
  'confirm_payment transitions a pending order of a deactivated user'
);
SELECT is(
  (SELECT status FROM public.orders WHERE id = '0d000000-0000-0000-0000-000000000001'),
  'paid',
  'order of a deactivated user is marked paid'
);
SELECT is(
  (SELECT count(*)::int FROM public.enrollments
     WHERE user_id = '22222222-2222-2222-2222-222222222222' AND status = 'active'),
  1,
  'enrollment is created for the deactivated payer'
);
SELECT is(
  app.has_active_enrollment('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000a'),
  false,
  'deactivated payer stays blocked despite the new enrollment'
);

UPDATE app_private.user_access SET is_active = true
  WHERE user_id = '22222222-2222-2222-2222-222222222222';
SELECT is(
  app.has_active_enrollment('22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-00000000000a'),
  true,
  'reactivated payer gets the access paid for while deactivated'
);

SELECT * FROM finish();
ROLLBACK;
