import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import styles from './Dialog.module.css'

export interface DialogProps {
  readonly open: boolean
  readonly title: string
  readonly onClose: () => void
  readonly children: ReactNode
  readonly footer?: ReactNode
  // Texto auxiliar ligado ao diálogo via aria-describedby.
  readonly description?: ReactNode
  // false: Escape, backdrop e botão X não fecham (ex.: mutação em andamento).
  readonly dismissible?: boolean
  readonly panelClassName?: string
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const AUTOFOCUS = '[data-autofocus]'

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
}

function trapTab(event: KeyboardEvent, panel: HTMLElement) {
  const items = focusableIn(panel)
  if (items.length === 0) {
    event.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  const inside = active instanceof Node && panel.contains(active)
  if (!inside) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

// Foco inicial (data-autofocus ou primeiro focável), restauração do foco,
// trava de scroll do body e teclado (Escape/Tab) no document enquanto aberto.
function useDialogBehavior(
  open: boolean,
  panelRef: RefObject<HTMLDivElement | null>,
  onClose: () => void,
  dismissible: boolean,
) {
  const latest = useRef({ onClose, dismissible })
  useEffect(() => {
    latest.current = { onClose, dismissible }
  })

  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const panel = panelRef.current
    if (panel) (panel.querySelector<HTMLElement>(AUTOFOCUS) ?? focusableIn(panel)[0] ?? panel).focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (latest.current.dismissible) latest.current.onClose()
      } else if (event.key === 'Tab' && panelRef.current) {
        trapTab(event, panelRef.current)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open, panelRef])
}

// Presentational only — open state belongs to the caller.
export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  description,
  dismissible = true,
  panelClassName,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogBehavior(open, panelRef, onClose, dismissible)

  if (!open) return null

  return createPortal(
    <div
      className={styles.backdrop}
      data-testid="dialog-backdrop"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={[styles.panel, panelClassName].filter(Boolean).join(' ')}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} aria-label="Fechar" disabled={!dismissible} onClick={onClose}>
            &times;
          </button>
        </div>
        <div className={styles.body}>
          {description ? <div id={descriptionId}>{description}</div> : null}
          {children}
        </div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
