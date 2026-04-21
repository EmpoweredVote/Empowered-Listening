import { Pool } from 'pg';
import { env } from '@/lib/env';
import dns from 'node:dns';

// Render's outbound network cannot route IPv6; force IPv4 DNS resolution.
dns.setDefaultResultOrder('ipv4first');

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) {
    if (!env.DATABASE_TRANSACTION_POOLER_URL) {
      throw new Error('DATABASE_TRANSACTION_POOLER_URL is not set');
    }
    _pool = new Pool({
      connectionString: env.DATABASE_TRANSACTION_POOLER_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return _pool;
}

export const pool = {
  query: (text: string, params?: unknown[]) => getPool().query(text, params),
};
