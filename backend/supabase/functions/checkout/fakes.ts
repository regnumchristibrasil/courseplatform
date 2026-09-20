// Test-only fakes for the narrow subset of the Supabase JS query-builder
// chain this feature actually uses: `select().eq()...maybeSingle()`,
// `insert().select().single()`, and `update().eq()`. Not part of the
// runtime module -- imported only by this directory's `*.test.ts` files.
//
// Shared across `courses.test.ts`, `orders.test.ts`, and `handler.test.ts`
// instead of duplicated per file: the repo's usual convention is a small
// ad hoc fake per test file (see `fakeFetch` in
// `_shared/payments/mercadopago/provider.test.ts`), but that gets unwieldy
// once a fake needs to model several distinct chains rather than one.

export interface RecordedCall {
  readonly table: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface QueryResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface SelectChainBuilder {
  select(...args: unknown[]): SelectChainBuilder;
  eq(...args: unknown[]): SelectChainBuilder;
  or(...args: unknown[]): SelectChainBuilder;
  order(...args: unknown[]): SelectChainBuilder;
  limit(...args: unknown[]): SelectChainBuilder;
  maybeSingle(): Promise<QueryResult>;
  single(): Promise<QueryResult>;
}

function chainableSelect(
  table: string,
  calls: RecordedCall[],
  result: QueryResult,
): SelectChainBuilder {
  const record = (method: string, args: unknown[]) => calls.push({ table, method, args });
  const builder: SelectChainBuilder = {
    select: (...args) => {
      record('select', args);
      return builder;
    },
    eq: (...args) => {
      record('eq', args);
      return builder;
    },
    or: (...args) => {
      record('or', args);
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
    maybeSingle: () => {
      record('maybeSingle', []);
      return Promise.resolve(result);
    },
    single: () => {
      record('single', []);
      return Promise.resolve(result);
    },
  };
  return builder;
}

export interface FakeTableConfig {
  readonly select?: QueryResult;
  readonly insert?: QueryResult;
  readonly update?: QueryResult;
}

export interface FakeTable {
  select(...args: unknown[]): SelectChainBuilder;
  insert(row: unknown): { select(...args: unknown[]): { single(): Promise<QueryResult> } };
  update(row: unknown): { eq(...args: unknown[]): Promise<QueryResult> };
}

export interface FakeClient {
  from(table: string): FakeTable;
}

// Builds a minimal fake standing in for `SupabaseClient` -- callers must
// cast the result with `as unknown as SupabaseClient` at the call site
// (same pattern as `_shared/supabase.test.ts`'s `{ __fake: true } as
// unknown as SupabaseClient`), since this fake intentionally implements
// only the methods this feature calls, not the full client surface.
export function createFakeClient(
  tables: Readonly<Record<string, FakeTableConfig>>,
): { client: FakeClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const client: FakeClient = {
    from(table: string): FakeTable {
      const config = tables[table];
      if (!config) {
        throw new Error(`fakes.ts: no config registered for table "${table}"`);
      }
      return {
        select: (...args: unknown[]) => {
          calls.push({ table, method: 'select', args });
          if (!config.select) {
            throw new Error(`fakes.ts: table "${table}" has no select config`);
          }
          return chainableSelect(table, calls, config.select);
        },
        insert: (row: unknown) => {
          calls.push({ table, method: 'insert', args: [row] });
          return {
            select: (...selectArgs: unknown[]) => {
              calls.push({ table, method: 'select', args: selectArgs });
              return {
                single: () => {
                  calls.push({ table, method: 'single', args: [] });
                  if (!config.insert) {
                    throw new Error(`fakes.ts: table "${table}" has no insert config`);
                  }
                  return Promise.resolve(config.insert);
                },
              };
            },
          };
        },
        update: (row: unknown) => {
          calls.push({ table, method: 'update', args: [row] });
          return {
            eq: (...eqArgs: unknown[]) => {
              calls.push({ table, method: 'eq', args: eqArgs });
              if (!config.update) {
                throw new Error(`fakes.ts: table "${table}" has no update config`);
              }
              return Promise.resolve(config.update);
            },
          };
        },
      };
    },
  };

  return { client, calls };
}
