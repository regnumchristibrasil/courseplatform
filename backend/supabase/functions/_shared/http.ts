// Shared HTTP helpers for Edge Functions: the frozen error envelope, a JSON
// response builder, CORS handling, and a raw-body-safe JSON body parser.
//
// Error envelope shape is frozen (see prompt_course_platform.md, "Edge
// Function HTTP contracts"):
//   { error: { code: string; message: string; requestId: string } }

const JSON_CONTENT_TYPE = 'application/json';
const DEFAULT_SUCCESS_STATUS = 200;
const DEFAULT_ERROR_STATUS = 400;
const NO_CONTENT_STATUS = 204;

// Permissive CORS: the frontend is a single known origin today, but Edge
// Functions are also invoked directly (curl, webhooks, cron), so a fixed
// allow-list isn't worth the maintenance cost yet. Revisit if browser
// clients ever need credentialed cross-origin requests.
export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

export interface JsonResponseInit {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ErrorJsonResponseInput {
  readonly code: string;
  readonly message: string;
  readonly requestId?: string;
  readonly status?: number;
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

export function jsonResponse(body: unknown, init: JsonResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? DEFAULT_SUCCESS_STATUS,
    headers: {
      'Content-Type': JSON_CONTENT_TYPE,
      ...CORS_HEADERS,
      ...init.headers,
    },
  });
}

export function errorJsonResponse(input: ErrorJsonResponseInput): Response {
  const requestId = input.requestId ?? generateRequestId();
  const envelope: ErrorEnvelope = {
    error: {
      code: input.code,
      message: input.message,
      requestId,
    },
  };
  return jsonResponse(envelope, { status: input.status ?? DEFAULT_ERROR_STATUS });
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: NO_CONTENT_STATUS, headers: CORS_HEADERS });
}

export class BodyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyParseError';
  }
}

const BODY_TOO_LARGE_MESSAGE = 'Request body is too large';

// Reads the body through a reader, counting bytes, so an oversized chunked or
// Content-Length-less request is cancelled mid-stream instead of buffered.
async function readBodyText(request: Request, maxBytes: number | undefined): Promise<string> {
  if (maxBytes === undefined) return await request.text();
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyParseError(BODY_TOO_LARGE_MESSAGE);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

// Reads and parses a JSON request body, raising a `BodyParseError` (never a
// raw `SyntaxError`) on empty or malformed input -- callers can catch this
// one type and translate it into the frozen error envelope. With `maxBytes`,
// the cap is enforced while streaming (and early via Content-Length).
export async function parseJsonBody<T>(
  request: Request,
  options: { readonly maxBytes?: number } = {},
): Promise<T> {
  const { maxBytes } = options;
  const declaredHeader = request.headers.get('Content-Length');
  if (maxBytes !== undefined && declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await request.body?.cancel();
      throw new BodyParseError(BODY_TOO_LARGE_MESSAGE);
    }
  }
  const raw = await readBodyText(request, maxBytes);
  if (raw.trim().length === 0) {
    throw new BodyParseError('Request body is empty');
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BodyParseError('Request body is not valid JSON');
  }
}
