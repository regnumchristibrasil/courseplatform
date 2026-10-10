import { useRef, useState, type KeyboardEvent } from 'react'
import { Badge } from '../../../components/ui/Badge'
import type { CourseTree } from '../../../contracts/adminCourses'
import { CourseStatusBadge } from './CourseStatusBadge'
import { entryKey, flattenTree, nextFocusKey, type TreeEntry, type TreeSelection } from './courseTreeModel'
import styles from './CourseTreeView.module.css'

export interface CourseTreeViewProps {
  readonly tree: CourseTree
  readonly selection: TreeSelection
  readonly onSelect: (selection: TreeSelection) => void
}

const ACTIVATION_KEYS: readonly string[] = ['Enter', ' ']
const LEVEL_CLASSES = { 1: styles.level1, 2: styles.level2, 3: styles.level3 } as const

// Always-expanded WAI-ARIA tree with a roving tabindex: one tab stop, arrows
// move focus, Enter/Space select. Presentational; selection lives in the caller.
export function CourseTreeView({ tree, selection, onSelect }: CourseTreeViewProps) {
  const entries = flattenTree(tree)
  const selectedKey = entryKey(selection)
  const [focusKey, setFocusKey] = useState(selectedKey)
  const itemRefs = useRef(new Map<string, HTMLLIElement>())

  // The roving stop must exist in the current tree (it can vanish on refetch).
  const tabStopKey = entries.some((e) => e.key === focusKey) ? focusKey : selectedKey

  function focusEntry(key: string) {
    setFocusKey(key)
    itemRefs.current.get(key)?.focus()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>, entry: TreeEntry) {
    if (ACTIVATION_KEYS.includes(event.key)) {
      event.preventDefault()
      onSelect(entry.selection)
      return
    }
    const target = nextFocusKey(entries, entry.key, event.key)
    if (target === null) return
    event.preventDefault()
    focusEntry(target)
  }

  return (
    <ul role="tree" aria-label="Estrutura do curso" className={styles.tree}>
      {entries.map((entry) => (
        <li
          key={entry.key}
          role="treeitem"
          aria-level={entry.level}
          aria-selected={entry.key === selectedKey}
          tabIndex={entry.key === tabStopKey ? 0 : -1}
          ref={(node) => {
            if (node) itemRefs.current.set(entry.key, node)
            else itemRefs.current.delete(entry.key)
          }}
          className={[styles.item, LEVEL_CLASSES[entry.level], entry.archived ? styles.archived : ''].filter(Boolean).join(' ')}
          onClick={() => {
            setFocusKey(entry.key)
            onSelect(entry.selection)
          }}
          onKeyDown={(event) => handleKeyDown(event, entry)}
        >
          <span className={styles.label}>{entry.label}</span>
          {entry.level === 1 ? <CourseStatusBadge status={tree.status} /> : null}
          {entry.level > 1 && entry.archived ? <Badge variant="warning">{entry.level === 2 ? 'Arquivado' : 'Arquivada'}</Badge> : null}
          {entry.missingVideo ? <Badge variant="danger">Sem vídeo</Badge> : null}
        </li>
      ))}
    </ul>
  )
}
