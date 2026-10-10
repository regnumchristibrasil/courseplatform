// admin-courses Edge Function -- acoes `create`, `update`, `set_status` e `delete`.
//
// A autorizacao, as invariantes (matriz de papeis, preco/duracao so admin,
// locking otimista) e a auditoria vivem no banco (app.staff_create_course /
// app.staff_update_course, chamadas com o cliente do CALLER). Esta funcao
// existe para emitir os eventos de analytics do servidor (mudanca de preco,
// duracao e status, exclusao, acoes negadas), sem titulo nem dados pessoais. O ator vem SOMENTE
// do JWT, nunca do corpo.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ADMIN_COURSES_ERROR_STATUS,
  type AdminCoursesRequest,
  type DeleteCourseResponse,
  type GateViolation,
  type SaveCourseResponse,
} from '../../../contracts/adminCourses.ts';
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
import { parseGateViolations } from './gate-violations.ts';
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
  readonly previous_status?: unknown;
}

function gateViolatedResponse(requestId: string, violations: readonly GateViolation[]): Response {
  const envelope = {
    error: {
      code: 'publish_gate_violated',
      message: 'Request denied: publish_gate_violated',
      requestId,
      violations,
    },
  };
  return jsonResponse(envelope, { status: ADMIN_COURSES_ERROR_STATUS.publish_gate_violated });
}

interface RpcResult {
  readonly data: unknown;
  readonly error: RpcErrorLike | null;
}

function callRpc(caller: SupabaseClient, input: AdminCoursesRequest): PromiseLike<RpcResult> {
  const app = caller.schema('app');
  switch (input.action) {
    case 'set_status':
      return app.rpc('staff_set_course_status', {
        p_course_id: input.courseId,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_status: input.status,
      });
    case 'delete':
      return app.rpc('staff_delete_course', {
        p_course_id: input.courseId,
        p_expected_updated_at: input.expectedUpdatedAt,
      });
    case 'create':
      return app.rpc('staff_create_course', courseFields(input));
    case 'update':
      return app.rpc('staff_update_course', {
        p_course_id: input.courseId,
        p_expected_updated_at: input.expectedUpdatedAt,
        ...courseFields(input),
      });
  }
}

function courseFields(
  input: Extract<AdminCoursesRequest, { readonly action: 'create' | 'update' }>,
) {
  return {
    p_title: input.title,
    p_description: input.description,
    p_price_cents: input.priceCents,
    p_access_duration_days: input.accessDurationDays,
  };
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

  const courseId = input.action === 'create' ? null : input.courseId;

  let rpcData: unknown;
  let rpcError: RpcErrorLike | null = null;
  try {
    const result = await callRpc(caller, input);
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
    const violations = mapped.code === 'publish_gate_violated'
      ? parseGateViolations(rpcError.details)
      : undefined;
    await capture({
      event: 'admin_action_denied',
      distinctId: actorId,
      properties: {
        error_code: mapped.code,
        request_id: requestId,
        actor_user_id: actorId,
        course_id: courseId,
        course_action: input.action,
        ...(violations && { violation_codes: violations.map((violation) => violation.code) }),
      },
    });
    return violations ? gateViolatedResponse(requestId, violations) : errorJsonResponse({
      code: mapped.code,
      message: `Request denied: ${mapped.code}`,
      requestId,
      status: mapped.status,
    });
  }

  if (input.action === 'delete') {
    await capture({
      event: 'admin_course_deleted',
      distinctId: actorId,
      properties: { course_id: input.courseId, actor_user_id: actorId, request_id: requestId },
    });
    const deleted: DeleteCourseResponse = { courseId: input.courseId };
    return jsonResponse(deleted);
  }

  const row = (Array.isArray(rpcData) ? rpcData[0] : undefined) as RpcRow | undefined;
  if (!row || typeof row.id !== 'string' || typeof row.updated_at !== 'string') {
    return await internalError('no_row');
  }

  if (input.action === 'set_status') {
    await capture({
      event: 'admin_course_status_changed',
      distinctId: actorId,
      properties: {
        course_id: row.id,
        actor_user_id: actorId,
        old_status: row.previous_status ?? null,
        new_status: input.status,
        request_id: requestId,
      },
    });
  }
  if (input.action === 'update' && row.price_changed === true) {
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
  if (input.action === 'update' && row.access_duration_changed === true) {
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
