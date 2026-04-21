'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (_client) return _client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
  }

  const evToken = typeof window !== 'undefined' ? localStorage.getItem('ev_token') : null;

  _client = createClient(url, anon, {
    realtime: {
      params: { eventsPerSecond: 10 },
      ...(evToken ? { headers: { Authorization: `Bearer ${evToken}` } } : {}),
    },
    auth: { persistSession: false, autoRefreshToken: false },
    ...(evToken ? { global: { headers: { Authorization: `Bearer ${evToken}` } } } : {}),
  });
  return _client;
}
