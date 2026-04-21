import 'server-only';
import { verifyToken } from '@/lib/auth/jwks';
import type { NextRequest } from 'next/server';

export class ModeratorGateError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
    this.name = 'ModeratorGateError';
  }
}

export async function requireModerator(token: string): Promise<string> {
  if (!token) throw new ModeratorGateError(401, 'Missing token');
  const payload = await verifyToken(token);
  const roles = extractRoles(payload);
  if (!roles.includes('listening_moderator')) {
    throw new ModeratorGateError(403, 'Missing listening_moderator role');
  }
  return payload.sub as string;
}

function extractRoles(payload: Record<string, unknown>): string[] {
  // Check both JWT role claim locations: app_metadata.roles (Supabase standard)
  // and top-level roles claim. The Empowered Vote accounts JWT may use either.
  const appMeta = (payload as { app_metadata?: { roles?: unknown } }).app_metadata;
  const top = (payload as { roles?: unknown }).roles;
  const candidate = appMeta?.roles ?? top;
  if (Array.isArray(candidate)) return candidate.filter((r): r is string => typeof r === 'string');
  return [];
}

export async function requireModeratorFromRequest(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new ModeratorGateError(401, 'Missing Authorization header');
  return requireModerator(token);
}
