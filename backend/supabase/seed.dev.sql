-- Seed SOMENTE de desenvolvimento local: usuarios de teste (superadmin, admin,
-- tutor, 2 alunos). NAO esta em config.toml [db.seed] sql_paths, portanto
-- `supabase db reset` (local ou --linked) e branches de preview NUNCA o criam.
-- Carregar localmente, depois de `supabase db reset`:
--   deno task seed:dev        (em backend/)
-- Rodar os testes de fixtures:  deno task test:seed-dev
--
-- O ban no Auth NAO e aplicado ao aluno inativo (apenas o flag is_active em
-- app_private.user_access); o login local dele funciona, o gate e de dados.
--
-- ---------------------------------------------------------------------------
-- Fixtures de usuarios LOCAIS (superadmin, admin, tutor, 2 alunos).
--
-- ATENCAO: somente desenvolvimento local. As credenciais abaixo sao
-- descartaveis, existem apenas neste seed e no GoTrue local. NUNCA reutilize
-- esta senha (nem estes e-mails) em staging/producao; este arquivo nao deve
-- ser aplicado em ambiente real.
--
--   e-mail                          papel        ativo   senha
--   superadmin@example.test         superadmin   sim     local-dev-only-123
--   admin@example.test              admin        sim     local-dev-only-123
--   tutor@example.test              tutor        sim     local-dev-only-123
--   student@example.test            student      sim     local-dev-only-123
--   student-inactive@example.test   student      NAO     local-dev-only-123
--
-- Fluxo: insere em auth.users (o trigger handle_new_user cria public.users e
-- a linha student em app_private.user_access) e depois promove papel/status
-- em app_private.user_access. Idempotente: reexecutar nao duplica nem falha.
-- Colunas de token ficam como '' (nao NULL) porque o GoTrue as le como string.
-- ---------------------------------------------------------------------------
-- Trava de seguranca: aborta se auth.users ja contem qualquer conta cujo e-mail
-- NAO termine em @example.test (protege contra rodar este seed num banco real).
-- Banco vazio ou so com contas @example.test passa (idempotente).
-- BEGIN SEED GUARD
do $guard$
begin
  if exists (
    select 1 from auth.users u
    where u.email is null or lower(u.email) not like '%@example.test'
  ) then
    raise exception using errcode = 'P0001',
      message = 'seed.dev abortado: auth.users contem contas fora de @example.test (banco real?)';
  end if;
end
$guard$;
-- END SEED GUARD

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'superadmin@example.test', crypt('local-dev-only-123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Superadmin Local"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'admin@example.test', crypt('local-dev-only-123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Admin Local"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'tutor@example.test', crypt('local-dev-only-123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Tutor Local"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'student@example.test', crypt('local-dev-only-123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Aluno Local"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'student-inactive@example.test', crypt('local-dev-only-123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Aluno Inativo Local"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

-- O GoTrue local exige a identidade de e-mail para permitir o login.
insert into auth.identities (
  id, user_id, provider_id, provider, identity_data,
  last_sign_in_at, created_at, updated_at
)
select
  u.id, u.id, u.id::text, 'email',
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  now(), now(), now()
from auth.users u
where u.id in (
  'a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004',
  'a0000000-0000-0000-0000-000000000005'
)
on conflict (provider_id, provider) do nothing;

-- Papel e status: o trigger ja criou todos como student ativo.
update app_private.user_access ua
set role = f.role, is_active = f.is_active
from (values
  ('a0000000-0000-0000-0000-000000000001'::uuid, 'superadmin', true),
  ('a0000000-0000-0000-0000-000000000002'::uuid, 'admin', true),
  ('a0000000-0000-0000-0000-000000000003'::uuid, 'tutor', true),
  ('a0000000-0000-0000-0000-000000000004'::uuid, 'student', true),
  ('a0000000-0000-0000-0000-000000000005'::uuid, 'student', false)
) as f(user_id, role, is_active)
where ua.user_id = f.user_id;
