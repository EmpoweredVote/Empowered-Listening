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

  _client = createClient(url, anon, {
    realtime: { params: { eventsPerSecond: 10 } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Supabase Realtime evaluates RLS using the JWT passed via setAuth().
  // global.headers only covers HTTP requests — the WebSocket connection needs
  // setAuth() so that postgres_changes events pass the RLS check.
  const evToken = typeof window !== 'undefined' ? localStorage.getItem('ev_token') : null;
  if (evToken) {
    _client.realtime.setAuth(evToken);
  }

  return _client;
}
