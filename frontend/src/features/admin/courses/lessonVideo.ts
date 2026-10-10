import { parseVideoRef, type ParsedVideoRef } from '../../../contracts/videoRef'
import { PROVIDER_LABELS } from './format'

export type VideoInputValidation =
  | { readonly ok: true; readonly parsed: ParsedVideoRef }
  | { readonly ok: false; readonly message: string }

const BLANK_MESSAGE = 'Informe o ID ou a URL do vídeo.'
const FORMAT_MESSAGE =
  'Formato não reconhecido. Use o ID ou a URL do YouTube, ou o UUID ou a URL de embed do Panda.'

// Mesmas regras do servidor (parser compartilhado); aqui só se antecipa a mensagem.
export function validateVideoInput(raw: string): VideoInputValidation {
  const parsed = parseVideoRef(raw)
  if (parsed !== null) return { ok: true, parsed }
  return { ok: false, message: raw.trim() === '' ? BLANK_MESSAGE : FORMAT_MESSAGE }
}

export function describeVideoRef(video: ParsedVideoRef): string {
  return `${PROVIDER_LABELS[video.provider]}: ${video.externalRef}`
}
