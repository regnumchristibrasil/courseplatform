import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { AuditList, CourseMetaForm, GateChecklist, LessonBadges, LessonForm, LessonMoveSelect, MoveButtons, StatusActions, StatusBadge, type VariantProps } from './shared'
import styles from './proto.module.css'

// VARIANT A: tree on the left (course > modules > lessons), editor pane on the
// right for whatever is selected. Like an IDE: the structure is always visible.

type Selection =
  | { readonly kind: 'course' }
  | { readonly kind: 'module'; readonly id: string }
  | { readonly kind: 'lesson'; readonly id: string }
  | { readonly kind: 'new-lesson'; readonly moduleId: string }

export function VariantA({ course, api, onDeleted }: VariantProps & { readonly onDeleted: () => void }) {
  const [selection, setSelection] = useState<Selection>({ kind: 'course' })
  const [newModule, setNewModule] = useState('')

  const selectedModule = selection.kind === 'module' ? course.modules.find((m) => m.id === selection.id) : undefined
  const selectedLesson = selection.kind === 'lesson' ? course.modules.flatMap((m) => m.lessons).find((l) => l.id === selection.id) : undefined
  const lessonModule = selectedLesson ? course.modules.find((m) => m.lessons.some((l) => l.id === selectedLesson.id)) : undefined
  const newLessonModule = selection.kind === 'new-lesson' ? course.modules.find((m) => m.id === selection.moduleId) : undefined

  const isSelected = (s: Selection) => JSON.stringify(s) === JSON.stringify(selection)

  return (
    <div className={styles.splitA}>
      <nav className={styles.tree} aria-label="Estrutura do curso">
        <button type="button" className={`${styles.treeItem} ${isSelected({ kind: 'course' }) ? styles.selected : ''}`} onClick={() => setSelection({ kind: 'course' })}>
          <strong>{course.title}</strong> <StatusBadge status={course.status} />
        </button>
        {course.modules.map((module) => {
          const active = module.lessons.filter((l) => !l.archived)
          const archived = module.lessons.filter((l) => l.archived)
          return (
            <div key={module.id} className={styles.treeModule}>
              <button type="button" className={`${styles.treeItem} ${isSelected({ kind: 'module', id: module.id }) ? styles.selected : ''} ${module.archived ? styles.dim : ''}`} onClick={() => setSelection({ kind: 'module', id: module.id })}>
                {module.title}{module.archived ? ' (arquivado)' : ''}
              </button>
              {active.map((lesson) => (
                <button key={lesson.id} type="button" className={`${styles.treeItem} ${styles.treeLesson} ${isSelected({ kind: 'lesson', id: lesson.id }) ? styles.selected : ''} ${module.archived ? styles.dim : ''}`} onClick={() => setSelection({ kind: 'lesson', id: lesson.id })}>
                  {lesson.title} {lesson.video ? '' : '(sem vídeo)'}
                </button>
              ))}
              {archived.length > 0 ? (
                <details className={styles.treeLesson}>
                  <summary>Arquivadas ({archived.length})</summary>
                  {archived.map((lesson) => (
                    <button key={lesson.id} type="button" className={`${styles.treeItem} ${styles.dim} ${isSelected({ kind: 'lesson', id: lesson.id }) ? styles.selected : ''}`} onClick={() => setSelection({ kind: 'lesson', id: lesson.id })}>
                      {lesson.title}
                    </button>
                  ))}
                </details>
              ) : null}
              <button type="button" className={`${styles.treeAdd} ${styles.treeLesson}`} onClick={() => setSelection({ kind: 'new-lesson', moduleId: module.id })}>+ Aula</button>
            </div>
          )
        })}
        <form className={styles.treeAddModule} onSubmit={(e) => { e.preventDefault(); if (api.addModule(course.id, newModule).ok) setNewModule('') }}>
          <Input label="Novo módulo" value={newModule} onChange={(e) => setNewModule(e.target.value)} />
          <Button type="submit" variant="secondary">+ Módulo</Button>
        </form>
      </nav>

      <section className={styles.pane}>
        {selection.kind === 'course' || (!selectedModule && !selectedLesson && !newLessonModule) ? (
          <div className={styles.stack}>
            <h2>Curso</h2>
            <GateChecklist course={course} />
            <CourseMetaForm key={course.id} course={course} api={api} />
            <StatusActions course={course} api={api} onDeleted={onDeleted} />
            <h3>Auditoria</h3>
            <AuditList />
          </div>
        ) : null}

        {selectedModule ? (
          <ModulePane key={selectedModule.id} courseId={course.id} moduleId={selectedModule.id} title={selectedModule.title} archived={selectedModule.archived} lessonCount={selectedModule.lessons.length} index={course.modules.findIndex((m) => m.id === selectedModule.id)} total={course.modules.length} api={api} onGone={() => setSelection({ kind: 'course' })} />
        ) : null}

        {selectedLesson && lessonModule ? (
          <div className={styles.stack}>
            <h2>Aula <LessonBadges lesson={selectedLesson} /></h2>
            <LessonForm key={selectedLesson.id + JSON.stringify(selectedLesson.video)} initial={selectedLesson} submitLabel="Salvar aula" onSubmit={(input) => api.saveLesson(course.id, selectedLesson.id, input)} />
            <div className={styles.row}>
              <MoveButtons label="aula" canUp={lessonModule.lessons[0]?.id !== selectedLesson.id} canDown={lessonModule.lessons[lessonModule.lessons.length - 1]?.id !== selectedLesson.id} onMove={(d) => api.moveLesson(course.id, selectedLesson.id, d)} />
              <LessonMoveSelect course={course} lessonId={selectedLesson.id} onMove={(moduleId) => api.moveLessonToModule(course.id, selectedLesson.id, moduleId)} />
            </div>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => api.setLessonArchived(course.id, selectedLesson.id, !selectedLesson.archived)}>{selectedLesson.archived ? 'Desarquivar' : 'Arquivar'}</Button>
              <Button variant="danger" onClick={() => { if (api.deleteLesson(course.id, selectedLesson.id).ok) setSelection({ kind: 'course' }) }}>Excluir aula</Button>
            </div>
          </div>
        ) : null}

        {newLessonModule ? (
          <div className={styles.stack}>
            <h2>Nova aula em "{newLessonModule.title}"</h2>
            {course.status === 'published' ? <p className={styles.muted}>Curso publicado: a aula precisa de vídeo (a RPC cria aula e vídeo juntos).</p> : null}
            <LessonForm submitLabel="Criar aula" resetOnSuccess onSubmit={(input) => api.addLesson(course.id, newLessonModule.id, input)} />
          </div>
        ) : null}
      </section>
    </div>
  )
}

function ModulePane({ courseId, moduleId, title, archived, lessonCount, index, total, api, onGone }: { readonly courseId: string; readonly moduleId: string; readonly title: string; readonly archived: boolean; readonly lessonCount: number; readonly index: number; readonly total: number; readonly api: VariantProps['api']; readonly onGone: () => void }) {
  const [value, setValue] = useState(title)
  return (
    <div className={styles.stack}>
      <h2>Módulo</h2>
      <Input label="Título do módulo" value={value} onChange={(e) => setValue(e.target.value)} />
      <div className={styles.row}>
        <Button onClick={() => api.renameModule(courseId, moduleId, value)}>Salvar título</Button>
        <MoveButtons label="módulo" canUp={index > 0} canDown={index < total - 1} onMove={(d) => api.moveModule(courseId, moduleId, d)} />
      </div>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => api.setModuleArchived(courseId, moduleId, !archived)}>{archived ? 'Desarquivar' : 'Arquivar'}</Button>
        <Button variant="danger" onClick={() => { if (api.deleteModule(courseId, moduleId).ok) onGone() }}>Excluir módulo</Button>
        {lessonCount > 0 ? <span className={styles.muted}>{lessonCount} aula(s): exclusão do módulo bloqueada (RESTRICT).</span> : null}
      </div>
    </div>
  )
}
