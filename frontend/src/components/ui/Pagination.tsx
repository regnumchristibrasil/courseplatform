import styles from './Pagination.module.css'

export interface PaginationProps {
  readonly page: number
  readonly totalPages: number
  readonly onPageChange: (page: number) => void
}

const WINDOW_RADIUS = 2

// Página fora do intervalo (ex.: ?page=100) é tratada como a última, para
// que a janela nunca tenha tamanho negativo.
function visiblePages(page: number, totalPages: number): readonly number[] {
  const center = Math.min(Math.max(page, 1), totalPages)
  const start = Math.max(1, center - WINDOW_RADIUS)
  const end = Math.min(totalPages, center + WINDOW_RADIUS)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}

// Presentational only — 1-based pages; the caller owns the current page state.
export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <nav aria-label="Paginação" className={styles.nav}>
      <button type="button" className={styles.button} disabled={page <= 1} onClick={() => onPageChange(Math.min(page, totalPages + 1) - 1)}>
        Anterior
      </button>
      {visiblePages(page, totalPages).map((number) => (
        <button
          key={number}
          type="button"
          className={[styles.button, number === page ? styles.current : ''].filter(Boolean).join(' ')}
          aria-label={`Página ${number}`}
          aria-current={number === page ? 'page' : undefined}
          onClick={() => onPageChange(number)}
        >
          {number}
        </button>
      ))}
      <button
        type="button"
        className={styles.button}
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Próxima
      </button>
    </nav>
  )
}
