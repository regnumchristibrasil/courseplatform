import { useEffect, useState } from 'react'
import { Input } from '../../../../components/ui/Input'
import { Select } from '../../../../components/ui/Select'
import { ROLES, type Role } from '../../../../contracts/adminUsers'
import type { AdminUsersFilters } from '../filters'
import type { AdminUsersFilterPatch } from '../useAdminUsers'
import { ROLE_LABELS } from '../roleLabels'
import styles from './UsersFilters.module.css'

export interface UsersFiltersProps {
  readonly filters: AdminUsersFilters
  readonly onChange: (patch: AdminUsersFilterPatch) => void
}

const SEARCH_DEBOUNCE_MS = 300
const MIN_SEARCH_LENGTH = 2

const ROLE_OPTIONS = [{ value: '', label: 'Todos' }, ...ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))]
const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'true', label: 'Ativo' },
  { value: 'false', label: 'Inativo' },
]

// Termo abaixo do mínimo equivale a "sem busca" (emite '').
function effectiveTerm(term: string): string {
  const trimmed = term.trim()
  return trimmed.length < MIN_SEARCH_LENGTH ? '' : trimmed
}

function useDebouncedSearch(applied: string, onChange: (patch: AdminUsersFilterPatch) => void) {
  const [term, setTerm] = useState(applied)
  const [emitted, setEmitted] = useState(applied)
  const [seenApplied, setSeenApplied] = useState(applied)

  // Mudança externa do termo na URL (voltar/avançar): ajusta o estado durante
  // a renderização, sem efeito. O eco do próprio termo emitido é ignorado
  // para não sobrescrever o que a pessoa continua digitando.
  if (applied !== seenApplied) {
    setSeenApplied(applied)
    if (applied !== emitted) {
      setTerm(applied)
      setEmitted(applied)
    }
  }

  useEffect(() => {
    const next = effectiveTerm(term)
    if (next === emitted) return undefined
    const timer = setTimeout(() => {
      setEmitted(next)
      onChange({ search: next })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, emitted, onChange])

  return [term, setTerm] as const
}

export function UsersFilters({ filters, onChange }: UsersFiltersProps) {
  const [term, setTerm] = useDebouncedSearch(filters.search, onChange)

  return (
    <div className={styles.filters}>
      <Input
        label="Buscar"
        type="search"
        placeholder="Nome ou e-mail (mín. 2 caracteres)"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
      />
      <Select
        label="Papel"
        value={filters.role ?? ''}
        options={ROLE_OPTIONS}
        onChange={(event) => onChange({ role: (event.target.value || undefined) as Role | undefined })}
      />
      <Select
        label="Status"
        value={filters.active === undefined ? '' : String(filters.active)}
        options={STATUS_OPTIONS}
        onChange={(event) => onChange({ active: event.target.value === '' ? undefined : event.target.value === 'true' })}
      />
    </div>
  )
}
