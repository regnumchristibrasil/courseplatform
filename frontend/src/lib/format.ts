const CENTS_PER_UNIT = 100

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

// Money is represented as integer cents everywhere in the backend; this is
// the only place on the frontend that converts to a decimal display string.
export function formatCentsToBRL(amountCents: number): string {
  return brlFormatter.format(amountCents / CENTS_PER_UNIT)
}

// `access_duration_days`: NULL means lifetime access; a positive integer is
// the number of days of access from grant to expiry.
export function formatAccessDuration(accessDurationDays: number | null): string {
  if (accessDurationDays === null) {
    return 'Acesso vitalício'
  }

  const unit = accessDurationDays === 1 ? 'dia' : 'dias'
  return `Acesso por ${accessDurationDays} ${unit}`
}
