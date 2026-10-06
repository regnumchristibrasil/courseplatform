import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { AuditList, CourseMetaForm, GateChecklist, LessonBadges, LessonForm, LessonMoveSelect, MoveButtons, StatusActions, StatusBadge, type VariantProps } from './shared'
import styles from './proto.module.css'
import type { CourseModule } from './types'

// VARIANT B: one long outline page. Modules are sections, lessons are rows that
// expand in place to edit. The status/publish bar is pinned to the bottom.

export function VariantB({ course, api, onDeleted }: VariantProps & { readonly onDeleted: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [openLesson, setOpenLesson] = useState<string | null>(null)
  const [newIn, setNewIn] = useState<string | null>(null)
  const [newModule, setNewModule] = useState('')

  return (
    <div className={styles.outline}>
      <header className={styles.row}>
        <h2>{course.title}</h2>
        <StatusBadge status={course.status} />
        <Button variant="secondary" onClick={() => setDetailsOpen((v) => !v)}>{detailsOpen ? 'Fechar detalhes' : 'Editar detalhes, preço e acesso'}</Button>
      </header>
      {detailsOpen ? <CourseMetaForm course={course} api={api} /> : null}

      {course.modules.map((module, moduleIndex) => (
        <ModuleSection
          key={module.id}
          module={module}
          moduleIndex={moduleIndex}
          moduleCount={course.modules.length}
          course={course}
          api={api}
          openLesson={openLesson}
          setOpenLesson={setOpenLesson}
          newIn={newIn}
          setNewIn={setNewIn}
        />
      ))}

      <form className={styles.row} onSubmit={(e) => { e.preventDefault(); if (api.addModule(course.id, newModule).ok) setNewModule('') }}>
        <Input label="Novo módulo" value={newModule} onChange={(e) => setNewModule(e.target.value)} />
        <Button type="submit" variant="secondary">Adicionar módulo</Button>
      </form>

      <h3>Auditoria</h3>
      <AuditList />

      <footer className={styles.statusBar}>
        <StatusBadge status={course.status} />
        <GateChecklist course={course} />
        <StatusActions course={course} api={api} onDeleted={onDeleted} />
      </footer>
    </div>
  )
}

interface SectionProps extends VariantProps {
  readonly module: CourseModule
  readonly moduleIndex: number
  readonly moduleCount: number
  readonly openLesson: string | null
  readonly setOpenLesson: (id: string | null) => void
  readonly newIn: string | null
  readonly setNewIn: (id: string | null) => void
}

function ModuleSection({ module, moduleIndex, moduleCount, course, api, openLesson, setOpenLesson, newIn, setNewIn }: SectionProps) {
  const [title, setTitle] = useState(module.title)
  const active = module.lessons.filter((l) => !l.archived)
  const archived = module.lessons.filter((l) => l.archived)

  const row = (lessonId: string) => {
    const lesson = module.lessons.find((l) => l.id === lessonId)
    if (!lesson) return null
    const index = module.lessons.findIndex((l) => l.id === lessonId)
    const open = openLesson === lessonId
    return (
      <li key={lesson.id} className={styles.lessonRow}>
        <div className={styles.row}>
          <span className={lesson.archived ? styles.dim : ''}>{lesson.title}</span>
          <LessonBadges lesson={lesson} />
          <span className={styles.spacer} />
          <MoveButtons label={`aula ${lesson.title}`} canUp={index > 0} canDown={index < module.lessons.length - 1} onMove={(d) => api.moveLesson(course.id, lesson.id, d)} />
          <Button variant="secondary" onClick={() => setOpenLesson(open ? null : lesson.id)}>{open ? 'Fechar' : 'Editar'}</Button>
        </div>
        {open ? (
          <div className={styles.inlineEditor}>
            <LessonForm key={lesson.id + JSON.stringify(lesson.video)} initial={lesson} submitLabel="Salvar aula" onSubmit={(input) => api.saveLesson(course.id, lesson.id, input)} />
            <LessonMoveSelect course={course} lessonId={lesson.id} onMove={(moduleId) => api.moveLessonToModule(course.id, lesson.id, moduleId)} />
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => api.setLessonArchived(course.id, lesson.id, !lesson.archived)}>{lesson.archived ? 'Desarquivar' : 'Arquivar'}</Button>
              <Button variant="danger" onClick={() => api.deleteLesson(course.id, lesson.id)}>Excluir aula</Button>
            </div>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <section className={`${styles.moduleSection} ${module.archived ? styles.dim : ''}`}>
      <div className={styles.row}>
        <Input label="Módulo" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Button variant="secondary" onClick={() => api.renameModule(course.id, module.id, title)}>Renomear</Button>
        <MoveButtons label="módulo" canUp={moduleIndex > 0} canDown={moduleIndex < moduleCount - 1} onMove={(d) => api.moveModule(course.id, module.id, d)} />
        <Button variant="secondary" onClick={() => api.setModuleArchived(course.id, module.id, !module.archived)}>{module.archived ? 'Desarquivar' : 'Arquivar'}</Button>
        <Button variant="danger" onClick={() => api.deleteModule(course.id, module.id)} title={module.lessons.length > 0 ? 'Módulo com aulas: exclua ou mova as aulas antes.' : undefined}>Excluir</Button>
      </div>
      {active.length === 0 ? <p className={styles.muted}>Módulo sem aulas ativas (invisível para alunos).</p> : null}
      <ul className={styles.lessonList}>{active.map((l) => row(l.id))}</ul>
      {archived.length > 0 ? (
        <details>
          <summary>Arquivadas ({archived.length})</summary>
          <ul className={styles.lessonList}>{archived.map((l) => row(l.id))}</ul>
        </details>
      ) : null}
      {newIn === module.id ? (
        <div className={styles.inlineEditor}>
          <LessonForm submitLabel="Criar aula" resetOnSuccess onSubmit={(input) => api.addLesson(course.id, module.id, input)} />
          <Button variant="secondary" onClick={() => setNewIn(null)}>Fechar</Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setNewIn(module.id)}>+ Aula neste módulo</Button>
      )}
    </section>
  )
}
