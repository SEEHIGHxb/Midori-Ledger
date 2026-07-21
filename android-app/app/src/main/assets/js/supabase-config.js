/**
 * Midori — Premium Finance Ledger
 * supabase-config.js: backend endpoint and publishable key.
 *
 * This is deliberately the SAME Supabase project Runaway uses. auth.users is
 * per-project, so sharing the project is what makes one Google login resolve to
 * one auth.uid() across Midori, Runaway and Life Balance Index. Splitting them
 * into separate projects would make the same email two unrelated identities and
 * force a hand-maintained mapping table to ever join the data.
 *
 * The publishable key is safe to commit. It grants nothing on its own: every
 * table is protected by row-level security keyed on auth.uid(), so this key
 * with no session attached yields zero rows. What must NEVER appear in this
 * file is the service_role key, which bypasses RLS entirely.
 *
 * Plain `const` rather than `export const` — Midori has no build step and loads
 * everything through classic <script> tags, so ES module syntax would throw.
 * Runaway's config.js is a module; the two files are not interchangeable.
 */

const SUPABASE_URL = 'https://hzgmjfgezlduxezbwpkm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1qQr0FV7gADjFUUaSMrbGA_QAdIZVvl';
