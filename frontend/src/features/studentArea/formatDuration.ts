const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

// "1h 05min", "1h", "5min"; vazio quando não há duração. Abaixo de 1 min vira 1min.
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return ''
  const totalMinutes = Math.max(1, Math.round(seconds / SECONDS_PER_MINUTE))
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  if (hours === 0) return `${minutes}min`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${String(minutes).padStart(2, '0')}min`
}
