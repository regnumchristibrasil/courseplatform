-- A24 -- termos da compra congelados no pedido e vinculo matricula->pedido
-- (ADR 0003): reembolso revoga a matricula do proprio pedido, e a duracao
-- vale a do momento da criacao do pedido.
BEGIN;
SELECT plan(13);

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'repurchaser@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'legacy@example.test');

INSERT INTO public.courses (id, title, price_cents, status, access_duration_days) VALUES
  ('c0000000-0000-0000-0000-00000000000a', 'Timed', 10000, 'published', 30),
  ('c0000000-0000-0000-0000-00000000000b', 'Lifetime', 10000, 'published', NULL);

-- Termos congelados na criacao do pedido (trigger no servidor).
INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status) VALUES
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending'),
  ('00000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-00000000000b', 10000, 'mercadopago', 'pending');

SELECT is(
  (SELECT access_duration_days FROM public.orders WHERE id = '00000000-0000-0000-0000-0000000000a1'),
  30,
  'order snapshots the course duration at creation'
);
SELECT is(
  (SELECT access_duration_days FROM public.orders WHERE id = '00000000-0000-0000-0000-0000000000b1'),
  NULL::int,
  'order snapshots lifetime (NULL) at creation'
);

-- O curso muda depois do checkout.
UPDATE public.courses SET access_duration_days = 90 WHERE id = 'c0000000-0000-0000-0000-00000000000a';
UPDATE public.courses SET access_duration_days = 7 WHERE id = 'c0000000-0000-0000-0000-00000000000b';

SET LOCAL ROLE service_role;
SELECT app.confirm_payment('00000000-0000-0000-0000-0000000000a1'::uuid, 'mp-a1', '2026-01-01T00:00:00Z'::timestamptz);
SELECT app.confirm_payment('00000000-0000-0000-0000-0000000000b1'::uuid, 'mp-b1', '2026-01-01T00:00:00Z'::timestamptz);
RESET ROLE;

SELECT is(
  (SELECT expires_at FROM public.enrollments WHERE order_id = '00000000-0000-0000-0000-0000000000a1'),
  '2026-01-31T00:00:00Z'::timestamptz,
  'enrollment uses the duration the order was bought under, not the current course value'
);
SELECT is(
  (SELECT expires_at FROM public.enrollments WHERE order_id = '00000000-0000-0000-0000-0000000000b1'),
  NULL::timestamptz,
  'a lifetime purchase stays lifetime after the course gains a duration'
);

-- O valor enviado pelo cliente/insert e ignorado.
INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status, access_duration_days) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending', 9999);
SELECT is(
  (SELECT access_duration_days FROM public.orders WHERE id = '00000000-0000-0000-0000-0000000000c1'),
  90,
  'a supplied access_duration_days is overridden by the course value'
);

-- Vinculo matricula -> pedido + reembolso apos recompra.
INSERT INTO public.enrollments (id, user_id, course_id, status, granted_at, expires_at, order_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-00000000000b', 'expired', now() - interval '60 days', now() - interval '30 days',
   '00000000-0000-0000-0000-0000000000b1');
-- (matricula ativa de b ja existe do confirm acima; trocamos para cenario controlado)
UPDATE public.enrollments SET status = 'expired', expires_at = now() - interval '1 day'
  WHERE order_id = '00000000-0000-0000-0000-0000000000a1';
UPDATE public.orders SET status = 'paid', paid_at = now() WHERE id = '00000000-0000-0000-0000-0000000000a1';

INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status, access_duration_days) VALUES
  ('00000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-00000000000a', 10000, 'mercadopago', 'pending', NULL);
SET LOCAL ROLE service_role;
SELECT app.confirm_payment('00000000-0000-0000-0000-0000000000a2'::uuid, 'mp-a2', now());
RESET ROLE;

SELECT isnt(
  (SELECT id FROM public.enrollments WHERE order_id = '00000000-0000-0000-0000-0000000000a2'),
  NULL::uuid,
  'confirm_payment links the new enrollment to its order'
);

SET LOCAL ROLE service_role;
SELECT results_eq(
  $$ SELECT did_transition, revoked_enrollment_id FROM app.refund_order(
       '00000000-0000-0000-0000-0000000000a1'::uuid, now()) $$,
  $$ VALUES (true, NULL::uuid) $$,
  'refunding the OLD order revokes nothing (its enrollment is already expired)'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.enrollments WHERE order_id = '00000000-0000-0000-0000-0000000000a2'),
  'active',
  'the repurchase enrollment survives a refund of the old order'
);

SET LOCAL ROLE service_role;
SELECT results_eq(
  $$ SELECT did_transition, revoked_enrollment_id IS NOT NULL FROM app.refund_order(
       '00000000-0000-0000-0000-0000000000a2'::uuid, now()) $$,
  $$ VALUES (true, true) $$,
  'refunding the NEW order revokes the repurchase enrollment'
);
RESET ROLE;
SELECT is(
  (SELECT status FROM public.enrollments WHERE order_id = '00000000-0000-0000-0000-0000000000a2'),
  'refunded',
  'the repurchase enrollment is now refunded'
);

-- Legado: matricula sem order_id continua sendo revogada por usuario+curso.
INSERT INTO public.orders (id, user_id, course_id, amount_cents, provider, status, paid_at, access_duration_days) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-00000000000b', 10000, 'mercadopago', 'paid', now(), NULL);
INSERT INTO public.enrollments (id, user_id, course_id, status) VALUES
  ('e0000000-0000-0000-0000-0000000000d1', '22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-00000000000b', 'active');
SET LOCAL ROLE service_role;
SELECT results_eq(
  $$ SELECT did_transition, revoked_enrollment_id FROM app.refund_order(
       '00000000-0000-0000-0000-0000000000d1'::uuid, now()) $$,
  $$ VALUES (true, 'e0000000-0000-0000-0000-0000000000d1'::uuid) $$,
  'legacy enrollment without order_id is still revoked by user+course'
);
RESET ROLE;

-- Grants inalterados.
SELECT ok(
  NOT has_function_privilege('authenticated', 'app.refund_order(uuid, timestamptz)', 'EXECUTE'),
  'authenticated still has no EXECUTE on refund_order'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app.confirm_payment(uuid, text, timestamptz)', 'EXECUTE'),
  'authenticated still has no EXECUTE on confirm_payment'
);

SELECT * FROM finish();
ROLLBACK;
