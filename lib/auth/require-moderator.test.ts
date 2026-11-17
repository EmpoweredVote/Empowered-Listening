import { describe, it, expect, vi, beforeEach } from 'vitest';

// Both dependencies are mocked: verifyToken would reach a remote JWKS, and the
// pool would reach the shared production instance. Neither belongs in a test.
const verifyToken = vi.fn();
const query = vi.fn();

vi.mock('@/lib/auth/jwks', () => ({ verifyToken: (t: string) => verifyToken(t) }));
vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ query }) }));

const { requireModerator, requireModeratorFromRequest, ModeratorGateError, LISTENING_MODERATOR_SLUG } =
  await import('./require-moderator');

const USER_ID = '4e6dde8f-2bd0-4054-824f-4164744165ea';

/** One row as `SELECT public.get_user_roles($1) AS roles` returns it. */
function getUserRolesReturning(roles: unknown) {
  return { rows: [{ roles }] };
}

function moderatorGrant() {
  return {
    id: 'a0000000-0000-0000-0000-000000000001',
    role_id: 'b0000000-0000-0000-0000-000000000001',
    slug: LISTENING_MODERATOR_SLUG,
    name: 'Listening Moderator',
    granted_at: '2026-11-17T18:00:00Z',
    feature_scope: 'platform',
    jurisdiction_geoid: null,
    resource_id: null,
    granted_by_display_name: null,
  };
}

beforeEach(() => {
  verifyToken.mockReset();
  query.mockReset();
  verifyToken.mockResolvedValue({ userId: USER_ID, payload: {} });
});

describe('requireModerator', () => {
  it('admits a user holding listening_moderator', async () => {
    query.mockResolvedValueOnce(getUserRolesReturning([moderatorGrant()]));
    await expect(requireModerator('good.token')).resolves.toBe(USER_ID);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('admits when the moderator grant sits among other roles', async () => {
    query.mockResolvedValueOnce(
      getUserRolesReturning([
        { ...moderatorGrant(), slug: 'treasury_editor' },
        moderatorGrant(),
      ]),
    );
    await expect(requireModerator('good.token')).resolves.toBe(USER_ID);
  });

  it('rejects with 403 when the user holds no roles at all', async () => {
    // The empty array is what get_user_roles returns for a user with no grants
    // — and what every WorkOS sign-in effectively produced before this change.
    query.mockResolvedValueOnce(getUserRolesReturning([]));
    await expect(requireModerator('good.token')).rejects.toMatchObject({
      name: 'ModeratorGateError',
      status: 403,
      message: 'Missing listening_moderator role',
    });
  });

  it('rejects with 403 when the user holds other roles but not this one', async () => {
    query.mockResolvedValueOnce(
      getUserRolesReturning([{ ...moderatorGrant(), slug: 'treasury_editor' }]),
    );
    await expect(requireModerator('good.token')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects with 403 when the grant has been revoked', async () => {
    // get_user_roles filters revoked_at itself, so a revoked grant simply is
    // not in the array. This is the case that the old token-claim gate got
    // wrong: a revoked role stayed valid until the holder's token expired.
    query.mockResolvedValueOnce(getUserRolesReturning([]));
    await expect(requireModerator('good.token')).rejects.toMatchObject({ status: 403 });
  });

  it('rejects with 401 for a missing token, without touching the database', async () => {
    await expect(requireModerator('')).rejects.toMatchObject({
      name: 'ModeratorGateError',
      status: 401,
      message: 'Missing token',
    });
    expect(verifyToken).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('propagates a verification failure and never reaches the role check', async () => {
    // Callers turn this into a 401 and log the reason — it is not a
    // ModeratorGateError, which is how they tell the two apart.
    verifyToken.mockRejectedValue(new Error('Unknown token issuer: https://example.test'));
    await expect(requireModerator('bad.token')).rejects.toThrow('Unknown token issuer');
    expect(query).not.toHaveBeenCalled();
  });

  it('never reads a role from the token payload', async () => {
    // The whole point of ev-cto 0041: a token claiming the role does not get it.
    verifyToken.mockResolvedValue({
      userId: USER_ID,
      payload: { roles: [LISTENING_MODERATOR_SLUG], app_metadata: { roles: [LISTENING_MODERATOR_SLUG] } },
    });
    query.mockResolvedValueOnce(getUserRolesReturning([]));
    await expect(requireModerator('forged.token')).rejects.toMatchObject({ status: 403 });
  });
});

describe('requireModerator — fallback to public.user_roles', () => {
  it('falls back when get_user_roles throws, and admits on a live grant', async () => {
    query
      .mockRejectedValueOnce(new Error('function public.get_user_roles(uuid) does not exist'))
      .mockResolvedValueOnce({ rows: [{ ok: true }] });
    await expect(requireModerator('good.token')).resolves.toBe(USER_ID);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('falls back when get_user_roles answers in an unexpected shape', async () => {
    query
      .mockResolvedValueOnce(getUserRolesReturning({ not: 'an array' }))
      .mockResolvedValueOnce({ rows: [{ ok: true }] });
    await expect(requireModerator('good.token')).resolves.toBe(USER_ID);
  });

  it('rejects with 403 when the fallback finds no live grant', async () => {
    query
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ rows: [{ ok: false }] });
    await expect(requireModerator('good.token')).rejects.toMatchObject({ status: 403 });
  });

  it('filters revoked grants in the fallback query itself', async () => {
    query.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ rows: [{ ok: false }] });
    await expect(requireModerator('good.token')).rejects.toMatchObject({ status: 403 });

    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('revoked_at IS NULL');
    expect(params).toEqual([USER_ID, LISTENING_MODERATOR_SLUG]);
    // Parameterised, never string-built.
    expect(sql).not.toContain(USER_ID);
    expect(sql).not.toContain(`'${LISTENING_MODERATOR_SLUG}'`);
  });
});

describe('requireModeratorFromRequest', () => {
  function reqWith(headers: Record<string, string>) {
    return { headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as never;
  }

  it('rejects with 401 when the Authorization header is absent', async () => {
    await expect(requireModeratorFromRequest(reqWith({}))).rejects.toMatchObject({
      status: 401,
      message: 'Missing Authorization header',
    });
  });

  it('rejects with 401 when the header is not a Bearer token', async () => {
    await expect(
      requireModeratorFromRequest(reqWith({ authorization: 'Basic abc123' })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('passes a Bearer token through to the gate', async () => {
    query.mockResolvedValueOnce(getUserRolesReturning([moderatorGrant()]));
    await expect(
      requireModeratorFromRequest(reqWith({ authorization: 'Bearer good.token' })),
    ).resolves.toBe(USER_ID);
    expect(verifyToken).toHaveBeenCalledWith('good.token');
  });
});

describe('ModeratorGateError', () => {
  it('is identifiable by name so callers can separate it from a verify failure', () => {
    const e = new ModeratorGateError(403, 'Missing listening_moderator role');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ModeratorGateError');
    expect(e.status).toBe(403);
  });
});
