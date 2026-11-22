import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

const requireModeratorFromRequest = vi.fn();

// The factory is hoisted above every declaration in this file, so the error
// class is defined inside it and the delegate is wrapped in an arrow — a bare
// reference would read an uninitialised binding.
vi.mock('@/lib/auth/require-moderator', () => {
  class ModeratorGateError extends Error {
    constructor(public readonly status: 401 | 403, message: string) {
      super(message);
      this.name = 'ModeratorGateError';
    }
  }
  return {
    ModeratorGateError,
    requireModeratorFromRequest: (req: NextRequest) => requireModeratorFromRequest(req),
  };
});

import { GET } from './route';
import { ModeratorGateError } from '@/lib/auth/require-moderator';

const req = {} as NextRequest;

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => errorSpy.mockRestore());

describe('GET /api/moderator/me', () => {
  it('answers yes for a user holding the listening_moderator role', async () => {
    requireModeratorFromRequest.mockResolvedValueOnce('user-uuid');
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isModerator: true });
  });

  it('answers no with 403 when the user is signed in without the role', async () => {
    requireModeratorFromRequest.mockRejectedValueOnce(
      new ModeratorGateError(403, 'Moderator role required'),
    );
    const res = await GET(req);
    expect(res.status).toBe(403);
    expect((await res.json()).isModerator).toBe(false);
  });

  it('answers no with 401 when there is no usable token', async () => {
    requireModeratorFromRequest.mockRejectedValueOnce(
      new ModeratorGateError(401, 'Missing bearer token'),
    );
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect((await res.json()).isModerator).toBe(false);
  });

  // verifyToken itself throwing — an unknown issuer, unreachable JWKS, a
  // missing external_id.  The gate never got as far as deciding, so this is
  // not a 403: it is "we could not establish who you are".
  it('answers no with 401 when verification itself throws', async () => {
    requireModeratorFromRequest.mockRejectedValueOnce(new Error('JWKS unreachable'));
    const res = await GET(req);
    expect(res.status).toBe(401);
    expect((await res.json()).isModerator).toBe(false);
  });

  it('logs an unexpected verification failure rather than swallowing it', async () => {
    requireModeratorFromRequest.mockRejectedValueOnce(new Error('JWKS unreachable'));
    await GET(req);
    expect(errorSpy).toHaveBeenCalled();
  });

  // This endpoint exists to let the UI decide what to render.  It is not an
  // identity endpoint, and a gate answer should not become a way to read back
  // an internal user id.
  it('never returns the user id', async () => {
    requireModeratorFromRequest.mockResolvedValueOnce('11111111-1111-1111-1111-111111111111');
    const body = await (await GET(req)).json();
    expect(JSON.stringify(body)).not.toContain('11111111');
  });
});
