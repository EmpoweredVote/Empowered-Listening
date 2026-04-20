import { z } from 'zod';

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  ACCOUNTS_API_BASE: z.string().url().default('https://api.empowered.vote'),
  JWKS_URL: z
    .string()
    .url()
    .default('https://kxsdzaojfaibhuzmclfq.supabase.co/auth/v1/.well-known/jwks.json'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  DATABASE_TRANSACTION_POOLER_URL: z.string().optional(),
  AUTH_BYPASS: z.enum(['0', '1']).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Mux (Phase 3 — video streaming)
  MUX_TOKEN_ID: z.string().optional(),
  MUX_TOKEN_SECRET: z.string().optional(),
  MUX_WEBHOOK_SECRET: z.string().optional(),
  // AWS S3 (Phase 3 — recordings storage)
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET_NAME: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
});

export const env = schema.parse(process.env);

if (env.AUTH_BYPASS === '1' && env.NODE_ENV !== 'development') {
  throw new Error(
    'AUTH_BYPASS=1 in a non-development environment. Refusing to start. This is a critical security misconfiguration.',
  );
}
