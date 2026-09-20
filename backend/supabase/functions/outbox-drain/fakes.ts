// Test-only fake standing in for the narrow subset of the Supabase JS
// client this feature actually uses:
//  - `.schema('app_private').from('email_outbox').select()...limit()`, a
//    thenable chain (mirrors `payments-reconcile/fakes.ts`'s
//    `ThenableOrdersBuilder`).
//  - `.schema('app_private').from('email_outbox').update(patch).eq('id', id)`,
//    keyed per-row so a test can make one row's update fail without
//    affecting others.
//  - `.from('users'|'courses'|'orders').select()...eq('id', id).maybeSingle()`,
//    keyed per-id so different candidate rows in the same batch can resolve
//    to different lookup results.
// Not part of the runtime module -- imported only by this directory's
// `*.test.ts` files (same convention as `checkout/fakes.ts`).

export interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

const NOT_FOUND: QueryResult = { data: null, error: null };
const DEFAULT_UPDATE_RESULT: QueryResult = { data: null, error: null };
const DEFAULT_CANDIDATES_RESULT: QueryResult = { data: [], error: null };

export interface RecordedUpdate {
  readonly id: string;
  readonly patch: Readonly<Record<string, unknown>>;
}

export interface FakeSupabaseOptions {
  readonly candidatesResult?: QueryResult;
  readonly candidatesThrows?: unknown;
  readonly updateResultById?: Readonly<Record<string, QueryResult>>;
  readonly usersById?: Readonly<Record<string, QueryResult>>;
  readonly coursesById?: Readonly<Record<string, QueryResult>>;
  readonly ordersById?: Readonly<Record<string, QueryResult>>;
}

interface ThenableEmailOutboxSelectBuilder extends PromiseLike<QueryResult> {
  select(...args: unknown[]): ThenableEmailOutboxSelectBuilder;
  in(...args: unknown[]): ThenableEmailOutboxSelectBuilder;
  lt(...args: unknown[]): ThenableEmailOutboxSelectBuilder;
  order(...args: unknown[]): ThenableEmailOutboxSelectBuilder;
  limit(...args: unknown[]): ThenableEmailOutboxSelectBuilder;
}

function createEmailOutboxSelectBuilder(
  options: FakeSupabaseOptions,
): ThenableEmailOutboxSelectBuilder {
  const settle = (): Promise<QueryResult> => {
    if (options.candidatesThrows !== undefined) {
      return Promise.reject(options.candidatesThrows);
    }
    return Promise.resolve(
      options.candidatesResult ?? DEFAULT_CANDIDATES_RESULT,
    );
  };
  const builder: ThenableEmailOutboxSelectBuilder = {
    select: () => builder,
    in: () => builder,
    lt: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (onFulfilled, onRejected) => settle().then(onFulfilled, onRejected),
  };
  return builder;
}

function createIdKeyedSelectBuilder(
  resultsById: Readonly<Record<string, QueryResult>> | undefined,
  calls: string[],
) {
  return {
    select(..._args: unknown[]) {
      return {
        eq(_col: string, id: unknown) {
          calls.push(id as string);
          return {
            maybeSingle: () => Promise.resolve(resultsById?.[id as string] ?? NOT_FOUND),
          };
        },
      };
    },
  };
}

export function createFakeOutboxDrainSupabase(
  options: FakeSupabaseOptions = {},
) {
  const updateCalls: RecordedUpdate[] = [];
  const usersCalls: string[] = [];
  const coursesCalls: string[] = [];
  const ordersCalls: string[] = [];

  const emailOutboxTable = {
    select: (..._args: unknown[]) => createEmailOutboxSelectBuilder(options),
    update: (patch: Record<string, unknown>) => ({
      eq: (_col: string, id: unknown) => {
        updateCalls.push({ id: id as string, patch });
        return Promise.resolve(
          options.updateResultById?.[id as string] ?? DEFAULT_UPDATE_RESULT,
        );
      },
    }),
  };

  const client = {
    schema(schemaName: string) {
      if (schemaName !== 'app_private') {
        throw new Error(
          `fakes.ts: no config registered for schema "${schemaName}"`,
        );
      }
      return {
        from(table: string) {
          if (table !== 'email_outbox') {
            throw new Error(
              `fakes.ts: no config registered for schema table "${table}"`,
            );
          }
          return emailOutboxTable;
        },
      };
    },
    from(table: string) {
      switch (table) {
        case 'users':
          return createIdKeyedSelectBuilder(options.usersById, usersCalls);
        case 'courses':
          return createIdKeyedSelectBuilder(options.coursesById, coursesCalls);
        case 'orders':
          return createIdKeyedSelectBuilder(options.ordersById, ordersCalls);
        default:
          throw new Error(
            `fakes.ts: no config registered for table "${table}"`,
          );
      }
    },
  };

  return { client, updateCalls, usersCalls, coursesCalls, ordersCalls };
}
