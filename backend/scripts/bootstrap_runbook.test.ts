import { assert, assertEquals } from '@std/assert';

const RUNBOOK = 'supabase/runbooks/bootstrap_superadmin.sql';
const PGTAP = 'supabase/tests/a20_bootstrap_superadmin_test.sql';
const BEGIN = '-- BEGIN BOOTSTRAP BLOCK';
const END = '-- END BOOTSTRAP BLOCK';

function block(content: string): string {
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  assert(start !== -1 && end > start, 'bootstrap block markers missing');
  return content.slice(start, end + END.length).trim();
}

Deno.test('runbook block is identical to the block exercised by the pgTAP test', async () => {
  const runbook = block(await Deno.readTextFile(RUNBOOK));
  const test = block(await Deno.readTextFile(PGTAP));
  assertEquals(runbook, test);
});

Deno.test('runbook runs in ONE transaction and uses the valid audit action', async () => {
  const sql = await Deno.readTextFile(RUNBOOK);
  const statements = sql.split('\n').filter((line) => !line.trimStart().startsWith('--'));
  const code = statements.join('\n');
  assert(/^\s*begin;/im.test(code), 'runbook must start a transaction');
  assert(/^\s*commit;/im.test(code), 'runbook must commit explicitly');
  assert(code.includes("'role_changed'"));
  assertEquals(code.includes("'role_change'"), false);
});

Deno.test('runbook requires a second marked input (bootstrap.user_id) matched with the email', async () => {
  const sql = await Deno.readTextFile(RUNBOOK);
  const code = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
  assert(code.includes("set_config('bootstrap.user_id', 'COLOQUE_O_USER_ID_AQUI', true)"));
  assert(code.includes('and u.id = v_user_id'));
  assertEquals(sql.match(/<- EDITAR AQUI/g)?.length, 2);
  assert(sql.includes('PRIMEIRO rode o select'));
});

Deno.test('seed.dev.sql guard block is identical to the one exercised by the dev pgTAP test', async () => {
  const seed = await Deno.readTextFile('supabase/seed.dev.sql');
  const test = await Deno.readTextFile('supabase/tests-dev/a22_seed_guard_test.sql');
  const extract = (content: string) => {
    const start = content.indexOf('-- BEGIN SEED GUARD');
    const end = content.indexOf('-- END SEED GUARD');
    assert(start !== -1 && end > start, 'seed guard markers missing');
    return content.slice(start, end + '-- END SEED GUARD'.length).trim();
  };
  assertEquals(extract(seed), extract(test));
});

Deno.test('seed.dev.sql runs the guard before any insert', async () => {
  const seed = await Deno.readTextFile('supabase/seed.dev.sql');
  assert(seed.indexOf('-- BEGIN SEED GUARD') < seed.indexOf('insert into auth.users'));
});

Deno.test('seed:dev task never honors a remote Docker daemon', async () => {
  const config = JSON.parse(await Deno.readTextFile('deno.json'));
  const task: string = config.tasks['seed:dev'];
  assert(task.includes('-u DOCKER_HOST'), 'seed:dev must unset DOCKER_HOST');
  assert(
    task.includes('--context default'),
    'seed:dev must pin the default (local) docker context',
  );
});
