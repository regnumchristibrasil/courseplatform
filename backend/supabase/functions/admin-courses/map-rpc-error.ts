import {
  ADMIN_COURSES_ERROR_STATUS,
  type AdminCoursesErrorCode,
} from '../../../contracts/adminCourses.ts';

export interface RpcErrorLike {
  readonly message?: string;
  readonly code?: string;
  readonly hint?: string;
}

export interface MappedRpcError {
  readonly code: AdminCoursesErrorCode;
  readonly status: number;
}

export const SQLSTATE_TO_CODE: Readonly<Record<string, AdminCoursesErrorCode>> = {
  '42501': 'forbidden',
  '22023': 'invalid_input',
  'P0002': 'not_found',
  'CR001': 'stale_target',
  'CR002': 'module_not_empty',
  'CR003': 'course_has_sales',
};

const CODES: ReadonlySet<string> = new Set(Object.values(SQLSTATE_TO_CODE));

function build(code: AdminCoursesErrorCode): MappedRpcError {
  return { code, status: ADMIN_COURSES_ERROR_STATUS[code] };
}

// A mensagem da excecao e o codigo estavel; o SQLSTATE e o fallback.
// null = erro desconhecido (o chamador responde 500 internal_error).
export function mapRpcError(error: RpcErrorLike): MappedRpcError | null {
  if (error.message !== undefined && CODES.has(error.message)) {
    return build(error.message as AdminCoursesErrorCode);
  }
  const bySqlstate = error.code === undefined ? undefined : SQLSTATE_TO_CODE[error.code];
  return bySqlstate === undefined ? null : build(bySqlstate);
}
