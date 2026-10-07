import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

// Credenciais do stack Supabase LOCAL lidas em runtime do CLI (`supabase status -o env`).
// Nunca são gravadas em arquivo nem impressas; ficam apenas em process.env do processo
// do Playwright (e dos workers filhos), que é descartado ao final da execução.

const BACKEND_DIR = resolve(import.meta.dirname, '../../backend')

export interface LocalSupabase {
  readonly apiUrl: string
  readonly anonKey: string
  readonly serviceKey: string
}

function parseEnvOutput(output: string): Readonly<Record<string, string>> {
  const entries = output
    .split('\n')
    .map((line) => /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [match[1], match[2]] as const)
  return Object.fromEntries(entries)
}

function readFromCli(): LocalSupabase {
  let output: string
  try {
    output = execFileSync('supabase', ['status', '-o', 'env'], {
      cwd: BACKEND_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    throw new Error('Local Supabase stack not running. Run `supabase start` in backend/ (see npm run test:e2e:setup).')
  }
  const values = parseEnvOutput(output)
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = values
  if (!API_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('`supabase status -o env` did not return API_URL, ANON_KEY and SERVICE_ROLE_KEY.')
  }
  return { apiUrl: API_URL, anonKey: ANON_KEY, serviceKey: SERVICE_ROLE_KEY }
}

// Resolve uma vez no processo principal e propaga aos workers via process.env.
export function resolveLocalSupabase(): LocalSupabase {
  const apiUrl = process.env.E2E_SUPABASE_URL
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_KEY
  if (apiUrl && anonKey && serviceKey) return { apiUrl, anonKey, serviceKey }
  const resolved = readFromCli()
  process.env.E2E_SUPABASE_URL = resolved.apiUrl
  process.env.E2E_SUPABASE_ANON_KEY = resolved.anonKey
  process.env.E2E_SUPABASE_SERVICE_KEY = resolved.serviceKey
  return resolved
}
