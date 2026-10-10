import { useId, useState, type FormEvent } from 'react'
import { Alert } from '../../../components/ui/Alert'
import { Button } from '../../../components/ui/Button'
import { Input } from '../../../components/ui/Input'
import type { CourseFieldsInput } from '../../../contracts/adminCourses'
import {
  formatPriceInput,
  parsePriceToCents,
  toFieldsInput,
  validateCourseForm,
  type CourseFormErrors,
  type CourseFormValues,
} from './courseForm'
import styles from './CourseForm.module.css'

export interface CourseFormProps {
  readonly initial: CourseFieldsInput
  readonly canEditCommercial: boolean
  readonly priceRequired: boolean
  // Ausente no cadastro: sem valor anterior não há o que avisar.
  readonly pendingOrderCount?: number
  readonly isSaving: boolean
  readonly errorMessage?: string | null
  readonly submitLabel: string
  readonly onSubmit: (fields: CourseFieldsInput) => void
  readonly onCancel?: () => void
}

function initialValues(initial: CourseFieldsInput): CourseFormValues {
  return {
    title: initial.title,
    description: initial.description ?? '',
    price: formatPriceInput(initial.priceCents),
    accessDurationDays: initial.accessDurationDays === null ? '' : String(initial.accessDurationDays),
  }
}

function pendingOrdersWarning(count: number): string {
  return count === 1
    ? 'Há 1 pedido pendente. Ele mantém o valor antigo por até 30 minutos.'
    : `Há ${count} pedidos pendentes. Eles mantêm o valor antigo por até 30 minutos.`
}

export function CourseForm(props: CourseFormProps) {
  const { initial, canEditCommercial, priceRequired, pendingOrderCount, isSaving, errorMessage, submitLabel, onSubmit, onCancel } = props
  const baseline = pendingOrderCount === undefined ? null : initial
  const [values, setValues] = useState<CourseFormValues>(() => initialValues(initial))
  const [errors, setErrors] = useState<CourseFormErrors>({})
  const descriptionId = useId()

  const set = (field: keyof CourseFormValues) => (value: string) => setValues((current) => ({ ...current, [field]: value }))

  const priceChanged = baseline !== null && canEditCommercial && parsePriceToCents(values.price) !== baseline.priceCents
  const durationChanged = baseline !== null && canEditCommercial && values.accessDurationDays.trim() !== (baseline.accessDurationDays === null ? '' : String(baseline.accessDurationDays))

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateCourseForm(values, { priceRequired, canEditCommercial })
    setErrors(found)
    if (Object.keys(found).length > 0) return
    onSubmit(toFieldsInput(values, canEditCommercial ? null : { priceCents: initial.priceCents, accessDurationDays: initial.accessDurationDays }))
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      {errorMessage ? <Alert variant="error">{errorMessage}</Alert> : null}
      <Input label="Título" value={values.title} error={errors.title} onChange={(e) => set('title')(e.target.value)} />
      <div className={styles.field}>
        <label htmlFor={descriptionId}>Descrição</label>
        <textarea
          id={descriptionId}
          rows={5}
          value={values.description}
          aria-invalid={errors.description ? true : undefined}
          onChange={(e) => set('description')(e.target.value)}
        />
        {errors.description ? <p role="alert" className={styles.error}>{errors.description}</p> : null}
      </div>
      <Input
        label="Preço (R$)"
        inputMode="decimal"
        value={values.price}
        readOnly={!canEditCommercial}
        error={errors.price}
        onChange={(e) => set('price')(e.target.value)}
      />
      {priceChanged && pendingOrderCount ? <Alert variant="warning">{pendingOrdersWarning(pendingOrderCount)}</Alert> : null}
      <Input
        label="Duração do acesso (dias)"
        inputMode="numeric"
        placeholder="Vazio = acesso vitalício"
        value={values.accessDurationDays}
        readOnly={!canEditCommercial}
        error={errors.accessDurationDays}
        onChange={(e) => set('accessDurationDays')(e.target.value)}
      />
      {durationChanged ? <Alert variant="warning">A nova duração vale apenas para novas compras.</Alert> : null}
      {canEditCommercial ? null : <p className={styles.hint}>Somente administradores alteram preço e duração do acesso.</p>}
      <div className={styles.actions}>
        <Button type="submit" isLoading={isSaving}>{submitLabel}</Button>
        {onCancel ? <Button variant="secondary" onClick={onCancel} disabled={isSaving}>Cancelar</Button> : null}
      </div>
    </form>
  )
}
