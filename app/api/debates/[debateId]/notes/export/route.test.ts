import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listeningSchemaColumns, selectedColumns } from '@/test/schema-columns';

/**
 * The export route 500'd in production on every debate: it selected
 * `scheduled_at` from `listening.debates`, and the column is
 * `scheduled_start`. Nothing caught it, because nothing in CI runs this
 * query — a bad column name in a template literal is invisible to the
 * compiler, the linter and the build.
 *
 * So these tests do two things the suite could not do before:
 *
 *   1. run the handler end to end with the pool mocked, which would have
 *      caught the second bug in the same route — `scheduled_start` is
 *      `timestamptz`, node-postgres hands back a `Date`, and the old code
 *      called `.slice(0, 10)` on it;
 *   2. check every column the route's SQL actually names against the
 *      migrations, which is what catches a typo like `scheduled_at`.
 */

const query = vi.fn();
const verifyToken = vi.fn();
const renderToBuffer = vi.fn();

vi.mock('@/lib/db/pool', () => ({ getPool: () => ({ query }) }));
vi.mock('@/lib/auth/jwks', () => ({ verifyToken: (t: string) => verifyToken(t) }));
vi.mock('@/lib/auth/account', () => ({
  getAccountMe: async () => ({ display_name: 'Kades' }),
}));
vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: (el: unknown) => renderToBuffer(el),
  StyleSheet: { create: <T,>(s: T) => s },
  Document: 'Document',
  Page: 'Page',
  View: 'View',
  Text: 'Text',
}));

const { GET } = await import('./route');

const DEBATE_ID = '80110ad3-e2c5-46f5-aff9-fea260109c86';
const USER_ID = '4e6dde8f-2bd0-4054-824f-4164744165ea';

function request(): Request {
  return new Request(`https://example.test/api/debates/${DEBATE_ID}/notes/export`, {
    headers: { authorization: 'Bearer token' },
  });
}

/** Params arrive as a promise in Next 16 route handlers. */
function params() {
  return { params: Promise.resolve({ debateId: DEBATE_ID }) };
}

/**
 * The route issues five queries. They are matched on the table each one reads
 * rather than on call order, so adding a query elsewhere does not silently
 * shift the fixtures onto the wrong statement.
 */
function respondByTable(sql: string) {
  if (/FROM\s+listening\.debates\b/i.test(sql)) {
    return {
      rows: [{ id: DEBATE_ID, topic: 'Bainbridge should have a new ferry', scheduled_date: '2026-11-18' }],
    };
  }
  if (/FROM\s+listening\.debate_speakers\b/i.test(sql)) {
    return {
      rows: [
        { id: 'spk-aff', role: 'affirmative', display_name: 'Jackson' },
        { id: 'spk-neg', role: 'negative', display_name: 'Cantrell' },
        { id: 'spk-mod', role: 'moderator', display_name: 'Kades' },
      ],
    };
  }
  if (/FROM\s+listening\.transcript_entries\b/i.test(sql)) {
    return {
      rows: [
        { id: 'te-1', speaker_id: 'spk-aff', debate_time_mmss: '00:04', text: 'First line.' },
      ],
    };
  }
  if (/FROM\s+listening\.notes\b/i.test(sql)) {
    return {
      rows: [{ id: 'n-1', content: 'A note.', debate_time_mmss: '00:05', is_edited: false }],
    };
  }
  throw new Error(`unexpected query: ${sql}`);
}

beforeEach(() => {
  query.mockReset();
  verifyToken.mockReset();
  renderToBuffer.mockReset();
  verifyToken.mockResolvedValue({ userId: USER_ID, payload: {} });
  query.mockImplementation((sql: string) => respondByTable(sql));
  renderToBuffer.mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
});

describe('GET /api/debates/[debateId]/notes/export', () => {
  it('returns a PDF', async () => {
    const res = await GET(request() as never, params());

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain(`debate-notes-${DEBATE_ID}.pdf`);
  });

  it('passes the scheduled date straight through, already formatted', async () => {
    await GET(request() as never, params());

    expect(renderToBuffer).toHaveBeenCalledOnce();
    const element = renderToBuffer.mock.calls[0][0] as { props: { debate: { date: string } } };
    expect(element.props.debate.date).toBe('2026-11-18');
  });

  it('falls back to today when the debate has no scheduled date', async () => {
    query.mockImplementation((sql: string) => {
      if (/FROM\s+listening\.debates\b/i.test(sql)) {
        return { rows: [{ id: DEBATE_ID, topic: 'T', scheduled_date: null }] };
      }
      return respondByTable(sql);
    });

    await GET(request() as never, params());

    const element = renderToBuffer.mock.calls[0][0] as { props: { debate: { date: string } } };
    expect(element.props.debate.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('401s without a bearer token', async () => {
    const res = await GET(
      new Request(`https://example.test/x`) as never,
      params(),
    );
    expect(res.status).toBe(401);
  });

  it('only selects columns that exist in the listening schema', async () => {
    await GET(request() as never, params());

    const schema = listeningSchemaColumns();
    const checked: string[] = [];

    for (const [sql] of query.mock.calls as [string][]) {
      const parsed = selectedColumns(sql);
      if (!parsed) continue;

      const known = schema.get(parsed.table);
      expect(known, `no migration defines listening.${parsed.table}`).toBeDefined();

      for (const column of parsed.columns) {
        expect(
          known!.has(column),
          `listening.${parsed.table} has no column "${column}" — see supabase/migrations/`,
        ).toBe(true);
        checked.push(`${parsed.table}.${column}`);
      }
    }

    // Guard the guard: if the parser silently matched nothing, the loop above
    // passes vacuously and this test is worthless.
    expect(checked).toContain('debates.scheduled_start');
    expect(checked.length).toBeGreaterThan(10);
  });
});
