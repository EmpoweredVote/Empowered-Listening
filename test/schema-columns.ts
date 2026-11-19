/**
 * Column names for the `listening` schema, read from the migrations.
 *
 * This exists because a column name inside a SQL template literal is invisible
 * to TypeScript, to `eslint` and to `next build`. The notes-export route
 * selected `scheduled_at` — a column that has never existed on
 * `listening.debates` — and shipped, because nothing in CI ever executes that
 * query. The failure only surfaced in production, as a 500.
 *
 * `supabase/migrations/` is the schema's source of truth in this repo, so a
 * test can read it and check the SQL a route actually issues against it,
 * without needing a live database in CI.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../supabase/migrations',
);

/** Line starts that declare a table constraint rather than a column. */
const CONSTRAINT_STARTS = [
  'constraint',
  'primary',
  'unique',
  'check',
  'foreign',
  'exclude',
];

/**
 * Split a `CREATE TABLE` body on the commas that separate its definitions,
 * ignoring commas nested inside parentheses — `CHECK (x IN ('a', 'b'))` is one
 * definition, not three.
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  let quoted = false;

  for (const ch of body) {
    if (ch === "'") quoted = !quoted;
    if (!quoted) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Every column of every `listening.*` table, as the migrations declare it.
 *
 * Reads `CREATE TABLE listening.<t> (...)` for the initial shape and
 * `ALTER TABLE listening.<t> ... ADD COLUMN <c>` for everything added since.
 * Columns are never dropped in this schema's history; if that changes, this
 * helper needs to learn `DROP COLUMN` too.
 */
export function listeningSchemaColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const add = (table: string, column: string) => {
    const set = tables.get(table) ?? new Set<string>();
    set.add(column);
    tables.set(table, set);
  };

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    // CREATE TABLE listening.<t> ( ... );
    const createRe =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?listening\.(\w+)\s*\(([\s\S]*?)\n\s*\);/gi;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(sql))) {
      const [, table, body] = m;
      for (const part of splitTopLevel(body)) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const first = trimmed.split(/\s+/)[0].toLowerCase();
        if (CONSTRAINT_STARTS.includes(first)) continue;
        add(table, trimmed.split(/\s+/)[0]);
      }
    }

    // ALTER TABLE listening.<t> ... ADD COLUMN [IF NOT EXISTS] <c>
    const alterRe =
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?listening\.(\w+)([\s\S]*?);/gi;
    while ((m = alterRe.exec(sql))) {
      const [, table, body] = m;
      const colRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
      let c: RegExpExecArray | null;
      while ((c = colRe.exec(body))) add(table, c[1]);
    }
  }

  return tables;
}

/**
 * The column identifiers a single-table `SELECT ... FROM listening.<t>` reads.
 *
 * Returns `null` when the statement does not select from exactly one
 * `listening.*` table, so a caller can skip what it cannot check rather than
 * guess. Aliases (`AS foo`) are the output name, not a column, and are
 * dropped; `to_char(scheduled_start, 'YYYY-MM-DD')` therefore yields
 * `scheduled_start` alone. Function names are excluded by ignoring any
 * identifier immediately followed by `(`.
 */
export function selectedColumns(
  sql: string,
): { table: string; columns: string[] } | null {
  const from = /FROM\s+listening\.(\w+)/gi;
  const tables = [...sql.matchAll(from)].map(m => m[1]);
  if (tables.length !== 1) return null;

  const select = /SELECT\s+([\s\S]*?)\s+FROM\s/i.exec(sql);
  if (!select) return null;

  const columns = new Set<string>();
  for (const expr of splitTopLevel(select[1])) {
    // Drop a trailing `AS alias` — that names the result, not a column.
    const withoutAlias = expr.replace(/\s+AS\s+\w+\s*$/i, '');
    // Strip single-quoted literals so format strings are not read as names.
    const withoutLiterals = withoutAlias.replace(/'[^']*'/g, '');
    const idRe = /\b([a-z_][a-z0-9_]*)\b\s*(\()?/gi;
    let m: RegExpExecArray | null;
    while ((m = idRe.exec(withoutLiterals))) {
      if (m[2]) continue; // identifier( → a function call
      // `te.id` → `id`; a bare table alias is never captured because the regex
      // continues past the dot to the column itself.
      const next = withoutLiterals[idRe.lastIndex];
      if (next === '.') continue;
      columns.add(m[1]);
    }
  }

  return { table: tables[0], columns: [...columns] };
}
