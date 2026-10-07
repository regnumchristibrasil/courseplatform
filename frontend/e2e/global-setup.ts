import { resetFixtures } from './helpers.ts'
import { resolveLocalSupabase } from './localSupabase.ts'

export default async function globalSetup(): Promise<void> {
  resolveLocalSupabase()
  await resetFixtures()
}
