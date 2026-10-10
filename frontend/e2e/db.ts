import { execFileSync } from 'node:child_process'

const DB_CONTAINER = process.env.E2E_DB_CONTAINER ?? 'supabase_db_backend'

// Executa SQL no Postgres local (container do stack Supabase) e devolve a saída tabular crua.
export function runSql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8' },
  )
}

export function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
