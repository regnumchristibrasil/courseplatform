// admin-courses Edge Function -- acoes `create` e `update` de curso.
//
// A autorizacao, as invariantes (matriz de papeis, preco/duracao so admin,
// locking otimista) e a auditoria vivem no banco (app.staff_create_course /
// app.staff_update_course, chamadas com o cliente do CALLER). Esta funcao
// existe para emitir os eventos de analytics do servidor (mudanca de preco e
// duracao, acoes negadas), sem titulo nem dados pessoais. O ator vem SOMENTE
// do JWT, nunca do corpo.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SaveCourseResponse } from '../../../contracts/adminCourses.ts';
import { requireEnv } from '../_shared/config.ts';
import {
  BodyParseError,
  corsPreflightResponse,
  errorJsonResponse,
  generateRequestId,
  jsonResponse,
  parseJsonBody,
} from '../_shared/http.ts';
import { captureAndFlush, type PostHogEnv } from '../_shared/observability.ts';
import { createCallerClient, MissingAuthorizationError } from '../_shared/supabase.ts';
import { mapRpcError, type RpcErrorLike } from './map-rpc-error.ts';
import { InvalidCourseRequestError, validateCourseRequest } from './validate-request.ts';

// Titulo (200) + descricao (5000) em UTF-8 cabem com folga.
const MAX_BODY_BYTES = 32768;
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export interface AdminCoursesDeps {
  readonly postHogEnv: PostHogEnv;
  readonly createCallerClientFn?: typeof createCallerClient;
  readonly captureFn?: typeof captureAndFlush;
  // Somente metadados seguros (requestId, SQLSTATE); nunca JWT, titulo ou mensagem do banco.
  readonly logFn?: (line: string) => void;
}

interface RpcRow {
  readonly id?: unknown;
  readonly updated_at?: unknown;
  readonly price_changed?: unknown;
  readonly access_duration_changed?: unknown;
  readonly previous_price_cents?: unknown;
  readonly previous_access_duration_days?: unknown;
}

function unauthorized(requestId: string): Response {
  return errorJsonResponse({
    code: 'unauthorized',
    message: 'Missing or invalid credentials',
    requestId,
    status: 401,
  });
}

export async function handleAdminCourses(
  request: Request,
  deps: AdminCoursesDeps,
): Promise<Response> {
  if (request.method === 'OPTIONS') return corsPreflightResponse();
  if (request.method !== 'POST') {
    return errorJsonResponse({
      code: 'method_not_allowed',
      message: `Method ${request.method} is not allowed`,
      status: 405,
    });
  }

  const requestId = generateRequestId();
  const log = deps.logFn ?? ((line: string) => console.error(line));
  const capture = async (input: Parameters<typeof captureAndFlush>[1]): Promise<void> => {
    try {
      const result = await (deps.captureFn ?? captureAndFlush)(deps.postHogEnv, input);
      if (!result.ok) log(`admin-courses requestId=${requestId} posthog capture failed`);
    } catch {
      log(`admin-courses requestId=${requestId} posthog capture threw`);
    }
  };

  let caller: SupabaseClient;
  try {
    caller = (deps.createCallerClientFn ?? createCallerClient)(request);
  } catch (error) {
    if (error instanceof MissingAuthorizationError) return unauthorized(requestId);
    throw error;
  }
  const token = BEARER_PATTERN.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (token === undefined) return unauthorized(requestId);

  let actorId: string;
  try {
    const { data, error } = await caller.auth.getUser(token);
    if (error || !data.user) return unauthorized(requestId);
    actorId = data.user.id;
  } catch {
    return unauthorized(requestId);
  }

  let input;
  try {
    input = validateCourseRequest(
      await parseJsonBody<unknown>(request, { maxBytes: MAX_BODY_BYTES }),
    );
  } catch (error) {
    if (error instanceof BodyParseError || error instanceof InvalidCourseRequestError) {
      return errorJsonResponse({
        code: 'invalid_input',
        message: error.message,
        requestId,
        status: 400,
      });
    }
    throw error;
  }

  const fields = {
    p_title: input.title,
    p_description: input.description,
    p_price_cents: input.priceCents,
    p_access_duration_days: input.accessDurationDays,
  };
  const courseId = input.action === 'update' ? input.courseId : null;

  let rpcData: unknown;
  let rpcError: RpcErrorLike | null = null;
  try {
    const result = input.action === 'create'
      ? await caller.schema('app').rpc('staff_create_course', fields)
      : await caller.schema('app').rpc('staff_update_course', {
        p_course_id: input.courseId,
        p_expected_updated_at: input.expectedUpdatedAt,
        ...fields,
      });
    rpcData = result.data;
    rpcError = result.error ?? null;
  } catch (error) {
    rpcError = { message: error instanceof Error ? error.name : 'thrown' };
  }

  const internalError = async (sqlstate: string): Promise<Response> => {
    log(`admin-courses requestId=${requestId} rpc failed code=${sqlstate}`);
    await capture({
      event: '$exception',
      distinctId: actorId,
      properties: {
        error_code: 'internal_error',
        sqlstate,
        request_id: requestId,
        actor_user_id: actorId,
        course_id: courseId,
        course_action: input.action,
      },
    });
    return errorJsonResponse({
      code: 'internal_error',
      message: 'Failed to save course',
      requestId,
      status: 500,
    });
  };

  if (rpcError !== null) {
    const mapped = mapRpcError(rpcError);
    if (mapped === null) return await internalError(rpcError.code ?? 'none');
    await capture({
      event: 'admin_action_denied',
      distinctId: actorId,
      properties: {
        error_code: mapped.code,
        request_id: requestId,
        actor_user_id: actorId,
        course_id: courseId,
        course_action: input.action,
      },
    });
    return errorJsonResponse({
      code: mapped.code,
      message: `Request denied: ${mapped.code}`,
      requestId,
      status: mapped.status,
    });
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : undefined) as RpcRow | undefined;
  if (!row || typeof row.id !== 'string' || typeof row.updated_at !== 'string') {
    return await internalError('no_row');
  }

  if (row.price_changed === true) {
    await capture({
      event: 'admin_course_price_changed',
      distinctId: actorId,
      properties: {
        course_id: row.id,
        actor_user_id: actorId,
        old_price_cents: row.previous_price_cents ?? null,
        new_price_cents: input.priceCents,
        request_id: requestId,
      },
    });
  }
  if (row.access_duration_changed === true) {
    await capture({
      event: 'admin_course_duration_changed',
      distinctId: actorId,
      properties: {
        course_id: row.id,
        actor_user_id: actorId,
        old_access_duration_days: row.previous_access_duration_days ?? null,
        new_access_duration_days: input.accessDurationDays,
        request_id: requestId,
      },
    });
  }

  const body: SaveCourseResponse = { courseId: row.id, updatedAt: row.updated_at };
  return jsonResponse(body);
}

// Wiring real so roda como entrypoint, nunca no import (testes).
if (import.meta.main) {
  const postHogEnv: PostHogEnv = {
    apiKey: requireEnv('POSTHOG_API_KEY'),
    host: requireEnv('POSTHOG_HOST'),
  };
  Deno.serve((request) => handleAdminCourses(request, { postHogEnv }));
}
