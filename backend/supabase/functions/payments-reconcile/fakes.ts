// Test-only fake standing in for the narrow subset of the Supabase JS
// client this feature actually uses: a `from('orders').select()...limit()`
// chain that is itself awaitable (Supabase's real query builders are
// thenable -- `candidates.ts` never calls `.single()`/`.maybeSingle()`, it
// just `await`s the builder directly), plus `.schema('app').rpc(...)`.
// Not part of the runtime module -- imported only by this directory's
// `*.test.ts` files (same convention as `checkout/fakes.ts`).

export interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

export interface FakeSupabaseOptions {
  readonly ordersSelectResult?: QueryResult;
  readonly ordersSelectThrows?: unknown;
  readonly rpcResult?: QueryResult;
  readonly rpcThrows?: unknown;
}

interface ThenableOrdersBuilder extends PromiseLike<QueryResult> {
  select(...args: unknown[]): ThenableOrdersBuilder;
  eq(...args: unknown[]): ThenableOrdersBuilder;
  not(...args: unknown[]): ThenableOrdersBuilder;
  lte(...args: unknown[]): ThenableOrdersBuilder;
  order(...args: unknown[]): ThenableOrdersBuilder;
  limit(...args: unknown[]): ThenableOrdersBuilder;
}

function createOrdersBuilder(
  calls: RecordedCall[],
  options: FakeSupabaseOptions,
): ThenableOrdersBuilder {
  const record = (method: string, args: unknown[]) => calls.push({ method, args });
  const settle = (): Promise<QueryResult> => {
    if (options.ordersSelectThrows !== undefined) {
      return Promise.reject(options.ordersSelectThrows);
    }
    return Promise.resolve(options.ordersSelectResult ?? { data: [], error: null });
  };
  const builder: ThenableOrdersBuilder = {
    select: (...args) => {
      record('select', args);
      return builder;
    },
    eq: (...args) => {
      record('eq', args);
      return builder;
    },
    not: (...args) => {
      record('not', args);
      return builder;
    },
    lte: (...args) => {
      record('lte', args);
      return builder;
    },
    order: (...args) => {
      record('order', args);
      return builder;
    },
    limit: (...args) => {
      record('limit', args);
      return builder;
    },
    then: (onFulfilled, onRejected) => settle().then(onFulfilled, onRejected),
  };
  return builder;
}

export interface RpcCall {
  readonly schema: string;
  readonly fn: string;
  readonly args: unknown;
}

export function createFakeReconcileSupabase(options: FakeSupabaseOptions = {}) {
  const ordersCalls: RecordedCall[] = [];
  const rpcCalls: RpcCall[] = [];

  const client = {
    from(table: string) {
      if (table !== 'orders') {
        throw new Error(`fakes.ts: no config registered for table "${table}"`);
      }
      return createOrdersBuilder(ordersCalls, options);
    },
    schema(schemaName: string) {
      return {
        rpc(fn: string, args: unknown) {
          rpcCalls.push({ schema: schemaName, fn, args });
          if (options.rpcThrows !== undefined) {
            return Promise.reject(options.rpcThrows);
          }
          return Promise.resolve(options.rpcResult ?? { data: 0, error: null });
        },
      };
    },
  };

  return { client, ordersCalls, rpcCalls };
}
