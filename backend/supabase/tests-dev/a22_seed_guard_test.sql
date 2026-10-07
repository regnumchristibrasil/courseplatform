-- A22b: trava de seed.dev.sql (o bloco abaixo e IDENTICO ao de seed.dev.sql;
-- um teste Deno compara os dois). Funciona com banco limpo ou ja semeado.
BEGIN;
SELECT plan(4);

CREATE TEMP TABLE guard_sql AS SELECT $sqlblock$
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
$sqlblock$::text AS stmt;

-- Estado "vazio": remove tudo (rollback ao final; o trigger deferido de I2 so dispara no commit).
DELETE FROM auth.users;
SELECT lives_ok((SELECT stmt FROM guard_sql), 'empty auth.users: guard passes');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'only@example.test', '{}');
SELECT lives_ok((SELECT stmt FROM guard_sql), 'only @example.test users: guard passes');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1000000-0000-0000-0000-000000000002', 'real.person@gmail.com', '{}');
SELECT throws_ok((SELECT stmt FROM guard_sql), 'P0001', NULL, 'a non-@example.test user present: guard raises');

DELETE FROM auth.users WHERE email = 'real.person@gmail.com';
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('a1000000-0000-0000-0000-000000000003', 'evil@example.test.attacker.com', '{}');
SELECT throws_ok((SELECT stmt FROM guard_sql), 'P0001', NULL, 'suffix lookalike is not accepted');

SELECT * FROM finish();
ROLLBACK;
