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
});

export const env = schema.parse(process.env);

if (env.AUTH_BYPASS === '1' && env.NODE_ENV !== 'development') {
  throw new Error(
    'AUTH_BYPASS=1 in a non-development environment. Refusing to start. This is a critical security misconfiguration.',
  );
}
