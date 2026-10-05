import {
  ADMIN_USERS_ERROR_STATUS,
  type AdminUsersErrorCode,
} from '../../../contracts/adminUsers.ts';

export interface RpcErrorLike {
  readonly message?: string;
  readonly code?: string;
  readonly hint?: string;
}

export interface MappedRpcError {
  readonly code: AdminUsersErrorCode;
  readonly status: number;
}

// Codigos que o banco pode levantar (auth_sync_failed so nasce na Edge Function).
type DbErrorCode = Exclude<AdminUsersErrorCode, 'auth_sync_failed'>;

export const SQLSTATE_TO_CODE: Readonly<Record<string, DbErrorCode>> = {
  '42501': 'forbidden',
  '22023': 'invalid_input',
  'P0002': 'not_found',
  'AD001': 'self_target',
  'AD002': 'actor_inactive',
  'AD003': 'stale_target',
  'AD004': 'last_superadmin',
};

const DB_CODES: ReadonlySet<string> = new Set(Object.values(SQLSTATE_TO_CODE));

function build(code: DbErrorCode): MappedRpcError {
  return { code, status: ADMIN_USERS_ERROR_STATUS[code] };
}

// A mensagem da excecao e o codigo estavel; o SQLSTATE e o fallback.
// Retorna null para erro desconhecido (o chamador responde 500 internal_error).
export function mapRpcError(error: RpcErrorLike): MappedRpcError | null {
  if (error.message !== undefined && DB_CODES.has(error.message)) {
    return build(error.message as DbErrorCode);
  }
  const bySqlstate = error.code === undefined ? undefined : SQLSTATE_TO_CODE[error.code];
  return bySqlstate === undefined ? null : build(bySqlstate);
}
