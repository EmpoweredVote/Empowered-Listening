/**
 * Stub for the `server-only` package under vitest.
 *
 * The real package exports a module that throws the moment it is loaded outside
 * a React Server Component, which is the point of it — but it also means any
 * module importing it cannot be unit tested at all. That is why `user-id.ts`
 * and `expiry-time.ts` were split out of their server modules rather than
 * tested in place.
 *
 * Aliasing it to this empty module in vitest.config.ts lets a server module be
 * tested directly with its dependencies mocked, without weakening the guard in
 * the real build — nothing outside the test environment resolves to this file.
 */
export {};
