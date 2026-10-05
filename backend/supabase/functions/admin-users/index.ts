// admin-users Edge Function -- unica acao: `set_active` (ativar/desativar
// usuario). Listagem e troca de papel sao RPCs diretas do frontend.
//
// Ordem inegociavel (decisao 3 do plano, ADR 0001):
//   1. RPC `app.admin_set_user_active` com o cliente do CALLER: autorizacao,
//      invariantes (I1-I6) e auditoria acontecem no banco. O flag no banco e
//      a fonte da verdade.
//   2. SOMENTE apos o RPC ter sucesso, o cliente service-role faz o ban/unban
//      no Auth. Ele nunca e construido antes disso.
//   3. Falha no Auth -> 502 auth_sync_failed; o flag do banco permanece. Um
//      retry com o MESMO payload (ou com expectedActive = estado pedido)
//      re-sincroniza o Auth: o RPC trata valor atual == valor pedido como
//      no-op idempotente ANTES da checagem de stale_target e devolve a linha,
//      sem auditoria; esta funcao entao reaplica o ban/unban.
// A identidade do ator vem SOMENTE do JWT (I5), nunca do corpo.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SetActiveResponse } from '../../../contracts/adminUsers.ts';
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
import {
  createCallerClient,
  createServiceRoleClient,
  MissingAuthorizationError,
} from '../_shared/supabase.ts';
import { mapRpcError, type RpcErrorLike } from './map-rpc-error.ts';
import { InvalidSetActiveRequestError, validateSetActiveRequest } from './validate-request.ts';

// Corpo de set_active e minusculo; acima disso e abuso.
const MAX_BODY_BYTES = 4096;
// ~100 anos: maior duracao de ban pratica aceita pelo Auth.
const BAN_FOREVER = '876000h';
const UNBAN = 'none';
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

export interface AdminUsersDeps {
  readonly postHogEnv: PostHogEnv;
  readonly createCallerClientFn?: typeof createCallerClient;
  readonly createServiceRoleClientFn?: typeof createServiceRoleClient;
  readonly captureFn?: typeof captureAndFlush;
  // Somente metadados seguros (codigo, requestId); nunca JWT, chave ou reason.
  readonly logFn?: (line: string) => void;
}

interface RpcRow {
  readonly user_id?: string;
  readonly is_active?: boolean;
}

function unauthorized(requestId: string): Response {
  return errorJsonResponse({
    code: 'unauthorized',
    message: 'Missing or invalid credentials',
    requestId,
    status: 401,
  });
}

export async function handleAdminUsers(
  request: Request,
  deps: AdminUsersDeps,
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
  const createCaller = deps.createCallerClientFn ?? createCallerClient;
  const createServiceRole = deps.createServiceRoleClientFn ?? createServiceRoleClient;
  const log = deps.logFn ?? ((line: string) => console.error(line));
  const capture = async (input: Parameters<typeof captureAndFlush>[1]): Promise<void> => {
    try {
      const result = await (deps.captureFn ?? captureAndFlush)(deps.postHogEnv, input);
      if (!result.ok) log(`admin-users requestId=${requestId} posthog capture failed`);
    } catch {
      log(`admin-users requestId=${requestId} posthog capture threw`);
    }
  };

  // Somente ids e SQLSTATE: nunca mensagem do banco, reason, e-mail ou segredo.
  const captureInternalError = (
    actor: string,
    target: string,
    sqlstate: string | undefined,
  ): Promise<void> =>
    capture({
      event: '$exception',
      distinctId: actor,
      properties: {
        error_code: 'internal_error',
        sqlstate: sqlstate ?? 'none',
        request_id: requestId,
        actor_user_id: actor,
        target_user_id: target,
      },
    });

  // (1) JWT: o ator e resolvido a partir do token, nunca do corpo (I5).
  let caller: SupabaseClient;
  try {
    caller = createCaller(request);
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

  // (2) Corpo.
  let input;
  try {
    input = validateSetActiveRequest(
      await parseJsonBody<unknown>(request, { maxBytes: MAX_BODY_BYTES }),
    );
  } catch (error) {
    if (error instanceof BodyParseError || error instanceof InvalidSetActiveRequestError) {
      return errorJsonResponse({
        code: 'invalid_input',
        message: error.message,
        requestId,
        status: 400,
      });
    }
    throw error;
  }

  // (3) RPC com o cliente do caller: autorizacao + invariantes + auditoria no banco.
  let rpcData: unknown;
  let rpcError: RpcErrorLike | null = null;
  try {
    const result = await caller.schema('app').rpc('admin_set_user_active', {
      p_target: input.userId,
      p_active: input.active,
      p_expected_active: input.expectedActive,
      p_reason: input.reason ?? null,
    });
    rpcData = result.data;
    rpcError = result.error ?? null;
  } catch (error) {
    rpcError = { message: error instanceof Error ? error.message : String(error) };
  }

  if (rpcError !== null) {
    const mapped = mapRpcError(rpcError);
    if (mapped === null) {
      log(`admin-users requestId=${requestId} rpc failed code=${rpcError.code ?? 'none'}`);
      await captureInternalError(actorId, input.userId, rpcError.code);
      return errorJsonResponse({
        code: 'internal_error',
        message: 'Failed to update user status',
        requestId,
        status: 500,
      });
    }
    await capture({
      event: 'admin_action_denied',
      distinctId: actorId,
      properties: {
        error_code: mapped.code,
        request_id: requestId,
        actor_user_id: actorId,
        target_user_id: input.userId,
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
  if (!row || typeof row.is_active !== 'boolean') {
    log(`admin-users requestId=${requestId} rpc returned no row`);
    await captureInternalError(actorId, input.userId, 'no_row');
    return errorJsonResponse({
      code: 'internal_error',
      message: 'Failed to update user status',
      requestId,
      status: 500,
    });
  }
  const isActive = row.is_active;

  // (4) Somente agora o service-role existe. Roda tambem em no-op do RPC.
  let authFailure: string | null = null;
  try {
    const { error } = await createServiceRole().auth.admin.updateUserById(input.userId, {
      ban_duration: isActive ? UNBAN : BAN_FOREVER,
    });
    if (error) authFailure = error.message;
  } catch (error) {
    // Excecao lancada pode carregar valores de ambiente na mensagem: so o nome.
    authFailure = `thrown ${error instanceof Error ? error.name : 'non-error'}`;
  }
  if (authFailure !== null) {
    log(`admin-users requestId=${requestId} auth sync failed: ${authFailure}`);
    await capture({
      event: 'admin_user_status_sync_failed',
      distinctId: actorId,
      properties: {
        error_code: 'auth_sync_failed',
        request_id: requestId,
        actor_user_id: actorId,
        target_user_id: input.userId,
        new_active: isActive,
      },
    });
    return errorJsonResponse({
      code: 'auth_sync_failed',
      message: 'User status saved but Auth sync failed; retry to re-sync',
      requestId,
      status: 502,
    });
  }

  await capture({
    event: 'admin_user_status_changed',
    distinctId: actorId,
    properties: {
      target_user_id: input.userId,
      actor_user_id: actorId,
      new_active: isActive,
      request_id: requestId,
    },
  });

  const body: SetActiveResponse = { userId: input.userId, isActive };
  return jsonResponse(body);
}

// Wiring real so roda como entrypoint, nunca no import (testes).
if (import.meta.main) {
  const postHogEnv: PostHogEnv = {
    apiKey: requireEnv('POSTHOG_API_KEY'),
    host: requireEnv('POSTHOG_HOST'),
  };
  Deno.serve((request) => handleAdminUsers(request, { postHogEnv }));
}
