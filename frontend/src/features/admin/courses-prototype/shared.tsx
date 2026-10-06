import { useState } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import { Select } from '../../../components/ui/Select'
import { duplicatesOf, formatBRL, gateViolations, parseVideoInput } from './rules'
import { useProto, type ProtoApi } from './store'
import styles from './proto.module.css'
import type { Course, CourseStatus, Direction, Lesson, LessonInput, Result, Video } from './types'

export interface VariantProps {
  readonly course: Course
  readonly api: ProtoApi
}

const STATUS_LABEL: Readonly<Record<CourseStatus, string>> = { draft: 'Rascunho', published: 'Publicado', archived: 'Arquivado' }
const STATUS_VARIANT = { draft: 'neutral', published: 'success', archived: 'warning' } as const

export function StatusBadge({ status }: { readonly status: CourseStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
}

export function LessonBadges({ lesson }: { readonly lesson: Lesson }) {
  return (
    <>
      {lesson.isFreePreview ? <Badge variant="info">Prévia grátis</Badge> : null}
      {lesson.video ? <Badge variant="neutral">{lesson.video.provider === 'youtube' ? 'YouTube' : 'Panda'}</Badge> : <Badge variant="danger">Sem vídeo</Badge>}
      {lesson.archived ? <Badge variant="warning">Arquivada</Badge> : null}
    </>
  )
}

// Stand-in for the staff-only mode of video-resolve (#5): same provider path
// as production, nothing saved. Panda needs a JWT, hence the extra line.
export function VideoPreview({ video }: { readonly video: Video }) {
  return (
    <div className={styles.preview}>
      <strong>Pré-visualização (simulada)</strong>
      <span>{video.provider === 'youtube' ? 'YouTube' : 'Panda'}: <code>{video.ref}</code></span>
      {video.provider === 'panda' ? <span>JWT simulado, expira em 24 h. Status: CONVERTED, playable.</span> : <span>Player incorporado sem expiração.</span>}
    </div>
  )
}

export function MoveButtons({ onMove, label, canUp = true, canDown = true }: { readonly onMove: (d: Direction) => void; readonly label: string; readonly canUp?: boolean; readonly canDown?: boolean }) {
  return (
    <span className={styles.moveButtons}>
      <button type="button" disabled={!canUp} onClick={() => onMove('up')} aria-label={`Subir ${label}`}>&uarr;</button>
      <button type="button" disabled={!canDown} onClick={() => onMove('down')} aria-label={`Descer ${label}`}>&darr;</button>
    </span>
  )
}

export function GateChecklist({ course }: { readonly course: Course }) {
  const violations = gateViolations(course)
  if (violations.length === 0) return <Alert variant="success"><p>Portão de publicação: tudo certo.</p></Alert>
  return (
    <Alert variant="warning">
      <p>Portão de publicação: pendências</p>
      <ul>{violations.map((v) => <li key={v}>{v}</li>)}</ul>
    </Alert>
  )
}

export function StatusActions({ course, api, onDeleted }: VariantProps & { readonly onDeleted: () => void }) {
  const sold = course.enrollments > 0 || course.pendingOrders > 0
  return (
    <div className={styles.actions}>
      {course.status === 'draft' ? <Button onClick={() => api.setCourseStatus(course.id, 'published')}>Publicar</Button> : null}
      {course.status === 'published' ? (
        <>
          <Button variant="secondary" onClick={() => api.setCourseStatus(course.id, 'draft')}>Despublicar</Button>
          <Button variant="secondary" onClick={() => api.setCourseStatus(course.id, 'archived')}>Arquivar</Button>
        </>
      ) : null}
      {course.status === 'archived' ? <Button variant="secondary" onClick={() => api.setCourseStatus(course.id, 'draft')}>Voltar para rascunho</Button> : null}
      <Button
        variant="danger"
        disabled={sold}
        title={sold ? `${course.enrollments} matrícula(s) e ${course.pendingOrders} pedido(s) pendente(s): arquive em vez de excluir.` : 'Excluir o curso e todo o conteúdo'}
        onClick={() => { if (api.deleteCourse(course.id).ok) onDeleted() }}
      >
        Excluir curso
      </Button>
      {sold ? <span className={styles.muted}>Exclusão bloqueada: {course.enrollments} matrícula(s), {course.pendingOrders} pedido(s) pendente(s).</span> : null}
    </div>
  )
}

export function CourseMetaForm({ course, api }: VariantProps) {
  const [title, setTitle] = useState(course.title)
  const [description, setDescription] = useState(course.description)
  const [priceText, setPriceText] = useState((course.priceCents / 100).toFixed(2).replace('.', ','))
  const [durationText, setDurationText] = useState(course.accessDurationDays === null ? '' : String(course.accessDurationDays))
  const priceChanged = priceText.trim() !== (course.priceCents / 100).toFixed(2).replace('.', ',')

  return (
    <form
      className={styles.stack}
      onSubmit={(event) => { event.preventDefault(); api.saveCourseMeta(course.id, { title, description, priceText, durationText }) }}
    >
      <Input label="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className={styles.field}>
        <span>Descrição</span>
        <textarea className={styles.textarea} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className={styles.grid2}>
        <Input label="Preço (R$)" value={priceText} onChange={(e) => setPriceText(e.target.value)} />
        <Input label="Acesso (dias, vazio = vitalício)" value={durationText} onChange={(e) => setDurationText(e.target.value)} />
      </div>
      {priceChanged && course.pendingOrders > 0 ? (
        <Alert variant="warning"><p>{course.pendingOrders} pedido(s) pendente(s) manterão o valor antigo ({formatBRL(course.priceCents)}) por até 30 minutos.</p></Alert>
      ) : null}
      <div><Button type="submit">Salvar detalhes</Button></div>
    </form>
  )
}

interface LessonFormProps {
  readonly initial?: Lesson
  readonly submitLabel: string
  readonly onSubmit: (input: LessonInput) => Result
  readonly resetOnSuccess?: boolean
}

export function LessonForm({ initial, submitLabel, onSubmit, resetOnSuccess = false }: LessonFormProps) {
  const { courses } = useProto()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [durationText, setDurationText] = useState(initial?.durationSeconds ? String(initial.durationSeconds) : '')
  const [isFreePreview, setIsFreePreview] = useState(initial?.isFreePreview ?? false)
  const [videoText, setVideoText] = useState(initial?.video?.ref ?? '')
  const [showPreview, setShowPreview] = useState(false)

  const parsed = videoText.trim() === '' ? null : parseVideoInput(videoText)
  const duplicates = parsed?.ok ? duplicatesOf(courses, parsed.video, initial?.id) : []

  return (
    <form
      className={styles.stack}
      onSubmit={(event) => {
        event.preventDefault()
        const result = onSubmit({ title, durationText, isFreePreview, videoText })
        if (result.ok && resetOnSuccess) { setTitle(''); setDurationText(''); setIsFreePreview(false); setVideoText(''); setShowPreview(false) }
      }}
    >
      <Input label="Título da aula" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className={styles.grid2}>
        <Input label="Duração (segundos, opcional)" value={durationText} onChange={(e) => setDurationText(e.target.value)} />
        <label className={styles.checkbox}>
          <input type="checkbox" checked={isFreePreview} onChange={(e) => setIsFreePreview(e.target.checked)} />
          <span>Prévia gratuita</span>
        </label>
      </div>
      <Input
        label="Vídeo (URL ou ID do YouTube, ou UUID / URL de embed do Panda)"
        value={videoText}
        onChange={(e) => { setVideoText(e.target.value); setShowPreview(false) }}
        error={parsed && !parsed.ok ? parsed.message : undefined}
      />
      {parsed?.ok ? (
        <div className={styles.row}>
          <Badge variant="success">{parsed.video.provider === 'youtube' ? 'YouTube' : 'Panda'}: {parsed.video.ref}</Badge>
          <Button variant="secondary" onClick={() => setShowPreview((v) => !v)}>{showPreview ? 'Ocultar prévia' : 'Pré-visualizar'}</Button>
        </div>
      ) : null}
      {parsed?.ok && showPreview ? <VideoPreview video={parsed.video} /> : null}
      {duplicates.length > 0 ? <Alert variant="warning"><p>Este vídeo também está em: {duplicates.join('; ')}.</p></Alert> : null}
      <div><Button type="submit">{submitLabel}</Button></div>
    </form>
  )
}

export function LessonMoveSelect({ course, lessonId, onMove }: { readonly course: Course; readonly lessonId: string; readonly onMove: (moduleId: string) => void }) {
  const current = course.modules.find((m) => m.lessons.some((l) => l.id === lessonId))
  return (
    <Select
      label="Mover para o módulo"
      value={current?.id ?? ''}
      onChange={(e) => onMove(e.target.value)}
      options={course.modules.filter((m) => !m.archived).map((m) => ({ value: m.id, label: m.title }))}
    />
  )
}

export function AuditList() {
  const { audit } = useProto()
  if (audit.length === 0) return <p className={styles.muted}>Auditoria (simulada): nenhuma ação destrutiva ou de visibilidade ainda.</p>
  return (
    <ul className={styles.audit}>
      {audit.map((entry) => (
        <li key={entry.id}><code>{entry.at}</code> <strong>{entry.action}</strong> {entry.detail}</li>
      ))}
    </ul>
  )
}
