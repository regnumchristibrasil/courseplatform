// A busca de usuários põe e-mail/nome em ?q= nas rotas /admin/*. Antes de
// qualquer evento sair para o PostHog, o parâmetro q é removido das URLs e o
// texto de elementos autocapturados é descartado nessas rotas (PII/LGPD).
const ADMIN_PATH = /^\/admin(\/|$)/
const SANITIZED_URL_PROPERTIES = ['$current_url', '$referrer', '$initial_referrer'] as const
const PLACEHOLDER_BASE = 'http://placeholder.invalid'

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATH.test(pathname)
}

function parse(url: string): URL | null {
  try {
    return new URL(url, PLACEHOLDER_BASE)
  } catch {
    return null
  }
}

export function sanitizeUrl(url: string): string {
  const parsed = parse(url)
  if (!parsed || !isAdminPath(parsed.pathname) || !parsed.searchParams.has('q')) return url
  parsed.searchParams.delete('q')
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(url)
  const base = isAbsolute ? parsed.origin : ''
  return `${base}${parsed.pathname}${parsed.search}${parsed.hash}`
}

function isAdminUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const parsed = parse(value)
  return parsed !== null && isAdminPath(parsed.pathname)
}

function stripElementText(elements: unknown): unknown {
  if (!Array.isArray(elements)) return elements
  return elements.map((element: unknown) => {
    if (typeof element !== 'object' || element === null) return element
    const { $el_text: _text, ...rest } = element as Record<string, unknown>
    return rest
  })
}

export interface SanitizableCapture {
  readonly event?: string
  readonly properties?: Record<string, unknown>
}

// Função pura (não muta a entrada); usada como before_send do posthog-js.
export function sanitizeCaptureResult<T extends SanitizableCapture | null>(result: T): T {
  if (!result?.properties) return result
  const props = result.properties
  const onAdmin = isAdminUrl(props.$current_url) || (typeof props.$pathname === 'string' && isAdminPath(props.$pathname))
  if (!onAdmin) return result
  const next: Record<string, unknown> = { ...props }
  for (const key of SANITIZED_URL_PROPERTIES) {
    if (typeof next[key] === 'string') next[key] = sanitizeUrl(next[key])
  }
  if ('$elements' in next) next.$elements = stripElementText(next.$elements)
  return { ...result, properties: next }
}
