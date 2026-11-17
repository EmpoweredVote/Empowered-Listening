/**
 * Generate the ev-ui `@theme` block in app/globals.css.
 *
 * Why this exists
 * ---------------
 * The token block in globals.css was hand-copied from ev-ui 0.4.4 and carried a
 * version note that nothing kept honest.  The values turned out not to have
 * drifted — all 44 colour stops still match 0.16.0 — but the copy only ever
 * covered the four brand scales.  The gray scale, the status colours, the
 * light/dark semantic layers and the pillar colours were all left behind, and
 * nothing would have told us if any of them had moved.
 *
 * ev-ui ships no CSS: `./tailwind-preset` is a Tailwind **v3** config object and
 * `./tokens` is ESM.  Under Tailwind v4 the tokens have to be emitted as custom
 * properties inside `@theme`, so generating them is the only way to stay in step
 * short of ev-ui publishing a v4 stylesheet.
 *
 * What it deliberately does NOT emit
 * ----------------------------------
 * Colours only, every name prefixed `--color-ev-*`.
 *
 * ev-ui's `spacing` is a sparse set ("150": "6px", "050": "2px"), and its
 * `fontSizes`, `borderRadius` and `breakpoints` would land on Tailwind v4's own
 * `--spacing-*`, `--text-*`, `--radius-*` and `--breakpoint-*` variables.
 * Emitting those would REPLACE Tailwind's core scales and silently restyle every
 * component in the app.  They are left out on purpose; if they are ever wanted
 * they need their own non-colliding prefix and a deliberate migration.
 *
 * Usage
 * -----
 *   node scripts/generate-theme-tokens.mjs           # rewrite globals.css
 *   node scripts/generate-theme-tokens.mjs --check   # exit 1 if it would change
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as tokens from '@empoweredvote/ev-ui/tokens';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ev-ui does not export './package.json', so read it off disk rather than
// resolving it as a subpath (that throws ERR_PACKAGE_PATH_NOT_EXPORTED).
const EV_UI_VERSION = JSON.parse(
  await readFile(path.join(ROOT, 'node_modules', '@empoweredvote', 'ev-ui', 'package.json'), 'utf8'),
).version;
const CSS_PATH = path.join(ROOT, 'app', 'globals.css');

const START = '/* ev-ui:tokens:start */';
const END = '/* ev-ui:tokens:end */';

/** camelCase / PascalCase -> kebab-case, with digit runs kept whole. */
function kebab(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * A colour value we are willing to emit. Anything else is skipped, loudly.
 * Covers hex plus the rgb()/rgba()/hsl() forms the overlay tokens use.
 */
function isColor(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^(rgba?|hsla?)\([^)]+\)$/i.test(v);
}

const lines = [];
const skipped = [];

function emit(name, value) {
  if (!isColor(value)) {
    skipped.push(`${name} = ${JSON.stringify(value)}`);
    return;
  }
  // Hex uppercases cleanly; rgba()/hsl() keep their own casing.
  const v = value.trim();
  lines.push(`  --color-${name}: ${v.startsWith('#') ? v.toUpperCase() : v};`);
}

/**
 * CSS comments do not nest, and a `*` immediately followed by `/` inside one
 * closes it early — which silently turns the rest of the token block into
 * garbage PostCSS then rejects.  Everything that reaches a comment goes through
 * here, because some of this text comes from ev-ui's own data (palette names).
 */
function commentSafe(text) {
  return String(text).replace(/\*\//g, '*​/');
}

function section(title) {
  lines.push('', `  /* ${commentSafe(title)} */`);
}

// ---------------------------------------------------------------------------
// Brand colours.
//
// `evMutedBlue` -> `--color-ev-muted-blue`, which is the name 22 existing
// utility classes already use (text-ev-muted-blue, ring-ev-light-blue, …).
// These names are load-bearing: renaming them breaks the app silently, because
// an unknown Tailwind colour class simply does not apply.
// ---------------------------------------------------------------------------
section(`Brand and semantic colours — ev-ui ${EV_UI_VERSION} \`colors\``);
for (const [key, value] of Object.entries(tokens.colors)) {
  // `black`/`white` would collide with Tailwind's own; keep them prefixed.
  emit(`ev-${kebab(key).replace(/^ev-/, '')}`, value);
}

// ---------------------------------------------------------------------------
// Full colour scales, including the gray scale the hand-copy never carried.
// ---------------------------------------------------------------------------
for (const [scaleName, scale] of Object.entries(tokens.colorScales)) {
  section(`${scaleName} scale`);
  // Numeric-ish stops sorted as numbers so 050 precedes 100 precedes 950.
  const stops = Object.keys(scale).sort((a, b) => Number(a) - Number(b));
  for (const stop of stops) {
    emit(`ev-${kebab(scaleName)}-${stop}`, scale[stop]);
  }
}

// ---------------------------------------------------------------------------
// Pillar colours. Listening is the Connect pillar; its accent lives here rather
// than as a hard-coded hex in a component.
// ---------------------------------------------------------------------------
section('Pillar colours');
for (const [pillar, def] of Object.entries(tokens.pillars)) {
  for (const key of ['color', 'dark', 'light', 'textColor']) {
    if (def?.[key] !== undefined) emit(`ev-pillar-${kebab(pillar)}-${kebab(key)}`, def[key]);
  }
  for (const [key, value] of Object.entries(def?.darkMode ?? {})) {
    emit(`ev-pillar-${kebab(pillar)}-dark-mode-${kebab(key)}`, value);
  }
}

// ---------------------------------------------------------------------------
// Light/dark semantic layers. This app is a dark UI currently built on 168 raw
// Tailwind `slate-*` classes; these are what those should eventually become.
// ---------------------------------------------------------------------------
// The shape is not uniform: `divider` is a bare colour string, `layerBase` is a
// flat object of roles, and `buttonPrimary.background` is a further object of
// interaction states.  Walk it rather than assuming a depth — iterating a string
// with Object.entries yields its characters, which is exactly the silent
// nonsense this generator exists to prevent.
function walk(prefix, node) {
  if (isColor(node)) {
    emit(prefix, node);
    return;
  }
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      walk(`${prefix}-${kebab(key)}`, value);
    }
    return;
  }
  skipped.push(`${prefix} = ${JSON.stringify(node)}`);
}

for (const [mode, layers] of Object.entries(tokens.semanticTokens)) {
  section(`Semantic layer — ${mode}`);
  for (const [layer, roles] of Object.entries(layers)) {
    walk(`ev-${kebab(mode)}-${kebab(layer)}`, roles);
  }
}

// ---------------------------------------------------------------------------
// Tier colours (federal / state / local).
// ---------------------------------------------------------------------------
section('Tier colours');
for (const [tier, def] of Object.entries(tokens.tierColors ?? {})) {
  for (const [role, value] of Object.entries(def ?? {})) {
    emit(`ev-tier-${kebab(tier)}-${kebab(role)}`, value);
  }
}

// ---------------------------------------------------------------------------
// Data-viz palette, positional — these are a sequence, not named roles.
// ---------------------------------------------------------------------------
// Each entry is { name, base, shades: [...5] } — positional, because a chart
// series is picked by index, not by role.  The human-readable `name` is kept in
// a comment so the variable can be traced back to the palette.
if (Array.isArray(tokens.dataVizPalette)) {
  section('Data-viz palette — positional, by series index');
  tokens.dataVizPalette.forEach((entry, i) => {
    const n = i + 1;
    if (isColor(entry)) {
      emit(`ev-dataviz-${n}`, entry);
      return;
    }
    if (entry?.name) lines.push(`  /* ${n}: ${commentSafe(entry.name)} */`);
    if (entry?.base !== undefined) emit(`ev-dataviz-${n}`, entry.base);
    if (Array.isArray(entry?.shades)) {
      entry.shades.forEach((shade, j) => emit(`ev-dataviz-${n}-${j + 1}`, shade));
    }
  });
}

const generated = [
  START,
  '  /*',
  '   * GENERATED — do not edit by hand.',
  '   *',
  `   * Source: @empoweredvote/ev-ui@${EV_UI_VERSION} (\`./tokens\`)`,
  '   * Regenerate: npm run tokens     Verify: npm run tokens:check',
  '   *',
  '   * Colours only, all prefixed --color-ev-*. Spacing, font sizes, radii and',
  '   * breakpoints are deliberately NOT emitted: they would land on Tailwind',
  "   * v4's own --spacing, --text, --radius and --breakpoint variables and",
  '   * replace the core scales. See scripts/generate-theme-tokens.mjs.',
  '   *',
  '   * (Those names are written bare above on purpose: a trailing star followed',
  '   * by a slash would close this comment early and break the stylesheet.)',
  '   */',
  ...lines,
  END,
].join('\n');

const css = await readFile(CSS_PATH, 'utf8');
const startAt = css.indexOf(START);
const endAt = css.indexOf(END);

if (startAt === -1 || endAt === -1 || endAt < startAt) {
  console.error(
    `[tokens] Could not find the ${START} … ${END} markers in app/globals.css.\n` +
      '         The generated block is replaced between those two comments; add them back.',
  );
  process.exit(2);
}

const next = css.slice(0, startAt) + generated + css.slice(endAt + END.length);
const checkOnly = process.argv.includes('--check');

if (next === css) {
  console.log(`[tokens] app/globals.css is up to date with ev-ui@${EV_UI_VERSION}.`);
  if (skipped.length) console.log(`[tokens] skipped ${skipped.length} non-colour value(s).`);
  process.exit(0);
}

if (checkOnly) {
  console.error(
    `[tokens] app/globals.css is OUT OF DATE with ev-ui@${EV_UI_VERSION}.\n` +
      '         Run: npm run tokens — then commit the result.',
  );
  process.exit(1);
}

await writeFile(CSS_PATH, next, 'utf8');
console.log(
  `[tokens] Wrote ${lines.filter((l) => l.startsWith('  --color-')).length} colour tokens ` +
    `from ev-ui@${EV_UI_VERSION} into app/globals.css.`,
);
if (skipped.length) {
  console.log(`[tokens] Skipped ${skipped.length} non-colour value(s):`);
  for (const s of skipped.slice(0, 10)) console.log(`         ${s}`);
}
