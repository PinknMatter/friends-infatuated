// Supabase connection for the audience-submission pipeline. The publishable
// key is safe to ship to the browser — Row Level Security only exposes
// SELECT on approved sentences; all writes go through the `submit` edge
// function with the service role. Leave SUPABASE_URL empty to disable sync
// entirely (the engine falls back to the built-in pool).

export const SUPABASE_URL = 'https://slopgzmjfkdccgxlmdzi.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_s-GJOx3zD8LMSTXke1Plmw_cAyyXVRH';

/** Public submission page, served by GitHub Pages from /docs (the QR code
 *  points here; the form POSTs to the `submit` edge function). */
export const SUBMIT_URL = 'https://pinknmatter.github.io/friends-infatuated/';
