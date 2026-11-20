import { describe, it, expect, afterEach } from 'vitest';
import { GET } from './route';

const ORIGINAL = process.env.RENDER_GIT_COMMIT;

function setCommit(value: string | undefined) {
  if (value === undefined) delete process.env.RENDER_GIT_COMMIT;
  else process.env.RENDER_GIT_COMMIT = value;
}

afterEach(() => setCommit(ORIGINAL));

async function body() {
  const res = await GET();
  expect(res.status).toBe(200);
  return res.json();
}

describe('GET /api/health', () => {
  it('reports the commit Render deployed', async () => {
    setCommit('272544abf826154f6ea6e4bb39f26f208545fdec');
    expect((await body()).commit).toBe('272544abf826154f6ea6e4bb39f26f208545fdec');
  });

  it('still answers liveness', async () => {
    setCommit(undefined);
    const json = await body();
    expect(json.name).toBe('empowered-listening');
    expect(json.status).toBe('ok');
    expect(Date.parse(json.time)).not.toBeNaN();
  });

  it('is null off Render rather than absent', async () => {
    setCommit(undefined);
    const json = await body();
    // The key is present and explicitly null, so a caller comparing against an
    // expected SHA gets a clean mismatch instead of `undefined === undefined`.
    expect(json).toHaveProperty('commit');
    expect(json.commit).toBeNull();
  });

  it('is null when Render sets the variable empty', async () => {
    // Render leaves some automatic variables empty rather than unset on service
    // types that do not carry them. `""` would read as "deployed at no commit".
    setCommit('');
    expect((await body()).commit).toBeNull();
    setCommit('   ');
    expect((await body()).commit).toBeNull();
  });

  it('does not assume a SHA length', async () => {
    // Render documents the variable but not whether the value is abbreviated,
    // so the handler must not slice it or validate a width.
    setCommit('272544a');
    expect((await body()).commit).toBe('272544a');
  });

  it('reads the environment per request, not once at import', async () => {
    // This is the regression guard for moving the read to module scope, which
    // would pin the response to whatever was set when the module first loaded
    // and make a restarted-but-stale instance indistinguishable from a fresh
    // one.
    setCommit('aaaaaaa');
    expect((await body()).commit).toBe('aaaaaaa');
    setCommit('bbbbbbb');
    expect((await body()).commit).toBe('bbbbbbb');
  });
});
