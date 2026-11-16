'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client — ANON KEY ONLY, deliberately.
 *
 * No user JWT is ever handed to this client (`persistSession: false`, and no
 * caller invokes `realtime.setAuth()`), so `auth.uid()` is always null for the
 * browser and the `auth.uid()`-based RLS policies on the `listening` tables are
 * dormant by design — every authenticated read and write goes through a route
 * handler using `verifyToken` + the service-role pool instead.
 *
 * That matters since ev-accounts decision 0002: a WorkOS token's `sub` is a
 * WorkOS id, so `auth.uid()` would NOT equal the internal UUID those policies
 * compare against. If you ever give this client a user token, read
 * lib/auth/user-id.ts first — the policies would need to resolve identity the
 * same issuer-aware way, or they will match nothing and look like missing data.
 */
let _client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  }

  _client = createClient(url, anon, {
    realtime: { params: { eventsPerSecond: 10 } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return _client;
}
