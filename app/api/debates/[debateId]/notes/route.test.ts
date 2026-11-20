import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listeningSchemaColumns } from '@/test/schema-columns';

/**
 * A quoted note keeps the time of the line it quotes — issue #101.
 *
 * `TranscriptSelectionPopup` sends `debateTimeMmss: null` beside a real
 * `sourceTranscriptEntryId`, and the INSERT took that null verbatim. The note
 * came out correctly linked and entirely untimed, so the exported PDF aligned
 * it to index -1 and parked it in the pre-transcript block with no `@ mm:ss` —
 * away from the line it quotes.
 *
 * The derivation is SQL, so these tests check the statement the route issues
 * rather than what Postgres makes of it: that both INSERT paths derive the
 * time from the anchored entry, that they scope the lookup to the debate, and
 * that a client-supplied time is still passed through for COALESCE to prefer.
 * The columns it names are checked against the migrations, which is the guard
 * that would have caught the `scheduled_at` typo in the export route.
 */

const query = vi.fn();
const verifyToken = vi.fn();
const requireConnectedTier = vi.fn();

vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ query }) }));
vi.mock('@/lib/auth/jwks', () => ({ verifyToken: (t: string) => verifyToken(t) }));
vi.mock('@/lib/auth/connected', () => ({
  requireConnectedTier: (t: string) => requireConnectedTier(t),
  mapTierError: () => ({ status: 403, body: { error: 'Inform tier' } }),
}));

const { POST } = await import('./route');

const DEBATE_ID = '80110ad3-e2c5-46f5-aff9-fea260109c86';
const USER_ID = '4e6dde8f-2bd0-4054-824f-4164744165ea';
const ENTRY_ID = '1e259fe0-5f74-4f57-bf5e-db10083b27df';

function ctx() {
  return { params: Promise.resolve({ debateId: DEBATE_ID }) };
}

function request(body: Record<string, unknown>) {
  return new Request(`https://example.test/api/debates/${DEBATE_ID}/notes`, {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

/** The INSERT the route issued, as [sql, params]. */
function insert(): [string, unknown[]] {
  const call = query.mock.calls.find(c => /INSERT\s+INTO\s+listening\.notes/i.test(String(c[0])));
  if (!call) throw new Error('route issued no INSERT into listening.notes');
  return [String(call[0]), call[1] as unknown[]];
}

/** Collapse whitespace so assertions do not depend on SQL indentation. */
function flat(sql: string): string {
  return sql.replace(/\s+/g, ' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyToken.mockResolvedValue({ userId: USER_ID });
  requireConnectedTier.mockResolvedValue(undefined);
  query.mockResolvedValue({ rows: [{ id: 'note-1', debate_time_mmss: '00:04' }], rowCount: 1 });
});

describe('POST notes — a quoted note keeps its line\'s time (#101)', () => {
  it('derives the time from the quoted entry when the client sends none', async () => {
    const res = await POST(
      request({
        content: 'ferries are expensive',
        debateTimeMmss: null,
        sourceTranscriptEntryId: ENTRY_ID,
        addToRebuttal: true,
      }),
      ctx(),
    );

    expect(res.status).toBe(201);
    const [sql, params] = insert();
    expect(flat(sql)).toContain('SELECT te.debate_time_mmss FROM listening.transcript_entries te');
    // The null still goes to the database — COALESCE is what makes the
    // derivation the fallback rather than the override.
    expect(params[3]).toBeNull();
    expect(params[4]).toBe(ENTRY_ID);
  });

  it('scopes the lookup to this debate, so a note cannot borrow another debate\'s time', async () => {
    await POST(
      request({
        content: 'x',
        debateTimeMmss: null,
        sourceTranscriptEntryId: ENTRY_ID,
        addToRebuttal: true,
      }),
      ctx(),
    );

    // `source_transcript_entry_id` carries no composite constraint tying it to
    // `debate_id`, so the statement has to check it.
    expect(flat(insert()[0])).toContain('WHERE te.id = $5::uuid AND te.debate_id = $2::uuid');
  });

  it('still sends a client-supplied time, which COALESCE prefers', async () => {
    await POST(
      request({ content: 'free-typed note', debateTimeMmss: '07:12', addToRebuttal: false }),
      ctx(),
    );

    const [sql, params] = insert();
    expect(params[3]).toBe('07:12');
    expect(flat(sql)).toContain('COALESCE( $4::text');
  });

  it('derives on the plain path too, not only the rebuttal one', async () => {
    await POST(
      request({
        content: 'quoted but not promoted',
        debateTimeMmss: null,
        sourceTranscriptEntryId: ENTRY_ID,
      }),
      ctx(),
    );

    const [sql] = insert();
    // The plain INSERT has no CTE — make sure this really is that branch.
    expect(sql).not.toMatch(/WITH\s+next_order/i);
    expect(flat(sql)).toContain('FROM listening.transcript_entries te');
  });

  it('writes no time when there is nothing to derive one from', async () => {
    await POST(request({ content: 'a thought of my own', debateTimeMmss: null }), ctx());

    const [, params] = insert();
    expect(params[3]).toBeNull();
    expect(params[4]).toBeNull();
  });
});

describe('POST notes — the derivation names real columns', () => {
  it('reads columns that exist on listening.transcript_entries', async () => {
    await POST(
      request({
        content: 'x',
        debateTimeMmss: null,
        sourceTranscriptEntryId: ENTRY_ID,
        addToRebuttal: true,
      }),
      ctx(),
    );

    const entries = listeningSchemaColumns().get('transcript_entries');
    expect(entries).toBeDefined();

    const sql = flat(insert()[0]);
    for (const column of ['debate_time_mmss', 'id', 'debate_id']) {
      expect(sql).toContain(`te.${column}`);
      expect(entries!.has(column)).toBe(true);
    }
  });
});
