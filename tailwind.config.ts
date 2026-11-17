/**
 * Tailwind CSS v4 Configuration
 *
 * Tailwind v4 is CSS-first; the real configuration is the `@theme` block in
 * app/globals.css. This file is retained only for IDE tooling compatibility.
 *
 * There is NO CSS import of ev-ui. An earlier version of this comment claimed
 * globals.css used an `@import "@empoweredvote/ev-ui/tailwind-preset"` path —
 * it never did, and no such path exists: ev-ui publishes no stylesheet, only
 * `./tokens` (ESM) and `./tailwind-preset` (a Tailwind **v3** config object).
 *
 * So the tokens are generated into globals.css from the installed package:
 *
 *   npm run tokens         regenerate the @theme block
 *   npm run tokens:check   fail if it disagrees with ev-ui (runs in CI)
 *
 * See scripts/generate-theme-tokens.mjs for what is emitted and, more
 * importantly, what is deliberately not.
 *
 * Font: Manrope (Google Fonts, loaded in app/layout.tsx via next/font)
 */
const config = {};

export default config;
