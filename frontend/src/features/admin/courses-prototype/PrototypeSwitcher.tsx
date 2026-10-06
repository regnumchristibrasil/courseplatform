import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import styles from './proto.module.css'

export interface VariantMeta {
  readonly key: string
  readonly name: string
}

// Floating bottom bar. Dev only: never rendered in production builds.
export function PrototypeSwitcher({ variants, current }: { readonly variants: readonly VariantMeta[]; readonly current: string }) {
  const [, setSearchParams] = useSearchParams()
  const index = Math.max(0, variants.findIndex((v) => v.key === current))

  useEffect(() => {
    const go = (delta: number) => {
      const next = variants[(index + delta + variants.length) % variants.length]
      if (next) setSearchParams((previous) => { const copy = new URLSearchParams(previous); copy.set('variant', next.key); return copy }, { replace: true })
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (event.key === 'ArrowLeft') go(-1)
      if (event.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, variants, setSearchParams])

  if (import.meta.env.PROD) return null

  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length]
    if (next) setSearchParams((previous) => { const copy = new URLSearchParams(previous); copy.set('variant', next.key); return copy }, { replace: true })
  }

  return (
    <div className={styles.switcher} role="group" aria-label="Alternar variante do protótipo">
      <button type="button" onClick={() => go(-1)} aria-label="Variante anterior">&larr;</button>
      <span>{variants[index]?.key} ({variants[index]?.name})</span>
      <button type="button" onClick={() => go(1)} aria-label="Próxima variante">&rarr;</button>
    </div>
  )
}
