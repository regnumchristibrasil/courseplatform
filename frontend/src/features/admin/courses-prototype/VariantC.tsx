import { useState } from 'react'
import { Button } from '../../../components/ui/Button'
import { Dialog } from '../../../components/ui/Dialog'
import { Input } from '../../../components/ui/Input'
import { Table } from '../../../components/ui/Table'
import { AuditList, CourseMetaForm, GateChecklist, LessonBadges, LessonForm, LessonMoveSelect, MoveButtons, StatusActions, StatusBadge, type VariantProps } from './shared'
import styles from './proto.module.css'
import type { CourseModule, Lesson } from './types'

// VARIANT C: three tabs (Detalhes, Currículo, Publicação). The curriculum is a
// table per module; editing a lesson opens a side drawer.

type Tab = 'details' | 'curriculum' | 'publish'
type Drawer = { readonly kind: 'lesson'; readonly id: string } | { readonly kind: 'new'; readonly moduleId: string } | null
type ModuleDialog = { readonly kind: 'new' } | { readonly kind: 'rename'; readonly module: CourseModule } | null

export function VariantC({ course, api, onDeleted }: VariantProps & { readonly onDeleted: () => void }) {
  const [tab, setTab] = useState<Tab>('curriculum')
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [dialog, setDialog] = useState<ModuleDialog>(null)
  const [dialogTitle, setDialogTitle] = useState('')

  const drawerLesson = drawer?.kind === 'lesson' ? course.modules.flatMap((m) => m.lessons).find((l) => l.id === drawer.id) : undefined
  const drawerModule = drawer?.kind === 'new' ? course.modules.find((m) => m.id === drawer.moduleId) : undefined

  const tabs: readonly { readonly key: Tab; readonly label: string }[] = [
    { key: 'details', label: 'Detalhes' },
    { key: 'curriculum', label: 'Currículo' },
    { key: 'publish', label: 'Publicação' },
  ]

  return (
    <div>
      <header className={styles.row}>
        <h2>{course.title}</h2>
        <StatusBadge status={course.status} />
      </header>
      <div className={styles.tabs} role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`${styles.tab} ${tab === t.key ? styles.tabActive : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'details' ? <CourseMetaForm course={course} api={api} /> : null}

      {tab === 'curriculum' ? (
        <div className={styles.stack}>
          {course.modules.map((module, moduleIndex) => (
            <section key={module.id} className={module.archived ? styles.dim : ''}>
              <div className={styles.row}>
                <h3>{module.title}{module.archived ? ' (arquivado)' : ''}</h3>
                <span className={styles.spacer} />
                <MoveButtons label="módulo" canUp={moduleIndex > 0} canDown={moduleIndex < course.modules.length - 1} onMove={(d) => api.moveModule(course.id, module.id, d)} />
                <Button variant="secondary" onClick={() => { setDialogTitle(module.title); setDialog({ kind: 'rename', module }) }}>Renomear</Button>
                <Button variant="secondary" onClick={() => api.setModuleArchived(course.id, module.id, !module.archived)}>{module.archived ? 'Desarquivar' : 'Arquivar'}</Button>
                <Button variant="danger" onClick={() => api.deleteModule(course.id, module.id)} title={module.lessons.length > 0 ? 'Módulo com aulas: exclua ou mova as aulas antes.' : undefined}>Excluir</Button>
              </div>
              <Table<Lesson>
                caption={`Aulas de ${module.title}`}
                rows={module.lessons}
                getRowKey={(l) => l.id}
                emptyMessage="Sem aulas neste módulo."
                columns={[
                  { key: 'title', header: 'Aula', render: (l) => <span className={l.archived ? styles.dim : ''}>{l.title}</span> },
                  { key: 'badges', header: 'Situação', render: (l) => <LessonBadges lesson={l} /> },
                  { key: 'durationSeconds', header: 'Duração', render: (l) => (l.durationSeconds ? `${Math.round(l.durationSeconds / 60)} min` : '-') },
                  {
                    key: 'actions',
                    header: 'Ações',
                    render: (l) => {
                      const index = module.lessons.findIndex((x) => x.id === l.id)
                      return (
                        <span className={styles.row}>
                          <MoveButtons label={`aula ${l.title}`} canUp={index > 0} canDown={index < module.lessons.length - 1} onMove={(d) => api.moveLesson(course.id, l.id, d)} />
                          <Button variant="secondary" onClick={() => setDrawer({ kind: 'lesson', id: l.id })}>Editar</Button>
                        </span>
                      )
                    },
                  },
                ]}
              />
              <Button variant="secondary" onClick={() => setDrawer({ kind: 'new', moduleId: module.id })}>+ Aula</Button>
            </section>
          ))}
          <div><Button variant="secondary" onClick={() => { setDialogTitle(''); setDialog({ kind: 'new' }) }}>+ Módulo</Button></div>
        </div>
      ) : null}

      {tab === 'publish' ? (
        <div className={styles.stack}>
          <GateChecklist course={course} />
          <StatusActions course={course} api={api} onDeleted={onDeleted} />
          <h3>Auditoria</h3>
          <AuditList />
        </div>
      ) : null}

      {drawerLesson ? (
        <aside className={styles.drawer} aria-label="Editar aula">
          <div className={styles.row}><h3>Editar aula</h3><span className={styles.spacer} /><Button variant="secondary" onClick={() => setDrawer(null)}>Fechar</Button></div>
          <LessonForm key={drawerLesson.id + JSON.stringify(drawerLesson.video)} initial={drawerLesson} submitLabel="Salvar aula" onSubmit={(input) => api.saveLesson(course.id, drawerLesson.id, input)} />
          <LessonMoveSelect course={course} lessonId={drawerLesson.id} onMove={(moduleId) => api.moveLessonToModule(course.id, drawerLesson.id, moduleId)} />
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => api.setLessonArchived(course.id, drawerLesson.id, !drawerLesson.archived)}>{drawerLesson.archived ? 'Desarquivar' : 'Arquivar'}</Button>
            <Button variant="danger" onClick={() => { if (api.deleteLesson(course.id, drawerLesson.id).ok) setDrawer(null) }}>Excluir aula</Button>
          </div>
        </aside>
      ) : null}
      {drawerModule ? (
        <aside className={styles.drawer} aria-label="Nova aula">
          <div className={styles.row}><h3>Nova aula em {drawerModule.title}</h3><span className={styles.spacer} /><Button variant="secondary" onClick={() => setDrawer(null)}>Fechar</Button></div>
          {course.status === 'published' ? <p className={styles.muted}>Curso publicado: a aula precisa de vídeo.</p> : null}
          <LessonForm submitLabel="Criar aula" resetOnSuccess onSubmit={(input) => api.addLesson(course.id, drawerModule.id, input)} />
        </aside>
      ) : null}

      <Dialog
        open={dialog !== null}
        title={dialog?.kind === 'rename' ? 'Renomear módulo' : 'Novo módulo'}
        onClose={() => setDialog(null)}
        footer={
          <Button
            onClick={() => {
              const result = dialog?.kind === 'rename' ? api.renameModule(course.id, dialog.module.id, dialogTitle) : api.addModule(course.id, dialogTitle)
              if (result.ok) setDialog(null)
            }}
          >
            Salvar
          </Button>
        }
      >
        <Input label="Título do módulo" value={dialogTitle} onChange={(e) => setDialogTitle(e.target.value)} data-autofocus />
      </Dialog>
    </div>
  )
}
