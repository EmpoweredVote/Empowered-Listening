import { Pool } from 'pg';
import type { QueryResult, QueryResultRow, PoolClient } from 'pg';
import { env } from '@/lib/env';
import { resolve4 } from 'node:dns/promises';

let _pool: Pool | null = null;
let _init: Promise<Pool> | null = null;

async function buildPool(): Promise<Pool> {
  const connStr = env.DATABASE_TRANSACTION_POOLER_URL;
  if (!connStr) throw new Error('DATABASE_TRANSACTION_POOLER_URL is not set');
  const url = new URL(connStr);
  const [ip] = await resolve4(url.hostname);
  url.hostname = ip;
  return new Pool({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
}

async function resolved(): Promise<Pool> {
  if (_pool) return _pool;
  if (!_init) _init = buildPool();
  return (_pool = await _init);
}

// Lazy proxy — callers already await .query() / .connect(), so the
// synchronous getPool() signature is preserved with no caller changes needed.
// resolve4() explicitly requests A records, bypassing OS IPv6 preference.
function makeProxy() {
  return {
    query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
      return resolved().then(p => p.query<T>(text, values as unknown[]));
    },
    connect(): Promise<PoolClient> {
      return resolved().then(p => p.connect());
    },
  };
}

const _proxy = makeProxy();

export function getPool(): typeof _proxy {
  return _proxy;
}

export const pool = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) =>
    _proxy.query<T>(text, values),
};
