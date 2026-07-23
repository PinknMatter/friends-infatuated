// FRIENDS INFATUATED — submission API. The form itself is static HTML on
// GitHub Pages (docs/index.html → https://pinknmatter.github.io/
// friends-infatuated/) because Supabase's gateway refuses to serve text/html
// from *.supabase.co (anti-phishing). This function only takes the POST,
// validates, and inserts with the service role — the table has no public
// write policy, so this is the only door in. verify_jwt=false: it's a
// QR-code site for a crowd.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const SITE = 'https://pinknmatter.github.io/friends-infatuated/';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

// ---- content guardrail -----------------------------------------------------
// This goes on a projector in front of a crowd. Ordinary swearing is fine
// (the builtin pool swears); slurs and hate speech are not. Matches get the
// honeypot treatment: fake success, nothing stored, no signal to iterate on.
// Normalization defeats the cheap tricks: case, leet substitutions, spacing
// (f a g g o t), and stretched letters (niiigger).

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
  '@': 'a', '$': 's', '!': 'i', '¡': 'i', '€': 'e',
};

// Unambiguous hate terms — matched as substrings of the letters-only text
// (also catches spaced-out and suffixed variants).
const SUB_BLOCK = [
  'nigger', 'nigga', 'faggot', 'kike', 'wetback', 'raghead', 'towelhead',
  'beaner', 'darkie', 'heilhitler', 'gasthejews', 'killalljews', 'killallgays',
];
// Shorter/ambiguous terms — whole-word only (substring would eat innocent
// words: raccoon, conspicuous, gobbledygook…).
const WORD_BLOCK = new Set([
  'fag', 'fags', 'spic', 'spics', 'chink', 'chinks', 'coon', 'coons',
  'gook', 'gooks', 'tranny', 'trannies', 'dyke', 'dykes',
  'retard', 'retards', 'retarded',
  // Not slurs per se, but on this wall they only ever arrive as the insult
  // ("X is gayyyy") — operator's call to block outright.
  'gay', 'gays', 'homo', 'homos',
]);

// Stretched spellings ("gayyyy") collapse to their base before the word
// check; the block set is pre-collapsed the same way so both sides align.
const dedupe = (s: string): string => s.replace(/(.)\1+/g, '$1');
const WORD_BLOCK_DEDUPED = new Set([...WORD_BLOCK].map(dedupe));

// Spaced-out spellings ("g a y y y", "ga y") appear as runs of tiny tokens —
// merge each run of ≤2-letter tokens into a candidate word for the check.
function mergedRuns(words: string[]): string[] {
  const out: string[] = [];
  let run = '';
  for (const w of words) {
    if (w.length <= 2) {
      run += w;
    } else {
      if (run.length > 2) out.push(run);
      run = '';
    }
  }
  if (run.length > 2) out.push(run);
  return out;
}

function isHateful(input: string): boolean {
  const norm = input
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('');
  const words = norm.split(/[^a-z]+/).filter(Boolean);
  if (words.some((w) => WORD_BLOCK.has(w) || WORD_BLOCK_DEDUPED.has(dedupe(w)))) return true;
  // Merged runs are agglomerations of deliberate fragments ("ga y as" →
  // "gayas"), so SUBSTRING matching is right here — exact match lets the
  // surrounding fragments mask the term. Tokens are deduped BEFORE merging
  // so a stretched fragment ("g a yyyy") still reads as a short one.
  for (const run of mergedRuns(words.map(dedupe))) {
    for (const t of WORD_BLOCK_DEDUPED) {
      if (run.includes(t)) return true;
    }
  }
  const compact = words.join('');
  // Collapse 3+ repeats to 2 so stretched spellings still match.
  const collapsed = compact.replace(/(.)\1{2,}/g, '$1$1');
  return SUB_BLOCK.some((t) => compact.includes(t) || collapsed.includes(t));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // Someone opened the API URL in a browser → send them to the real page.
  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Response(null, { status: 302, headers: { Location: SITE } });
  }
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  try {
    const body = await req.json();
    // Honeypot field filled → bot. Pretend success.
    if (typeof body.website === 'string' && body.website.length > 0) {
      return json({ ok: true });
    }
    const text = String(body.text ?? '').replace(/\s+/g, ' ').trim();
    const author = String(body.author ?? '').slice(0, 60).trim();
    const words = text.split(' ').length;
    if (text.length < 3 || text.length > 300 || words > 40) {
      return json({ error: 'keep it between 3 and 300 characters (max 40 words)' }, 422);
    }
    // Hate speech → same as the honeypot: pretend success, store nothing.
    if (isHateful(text) || isHateful(author)) {
      return json({ ok: true });
    }

    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/sentences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ text, author: author || null }),
    });
    if (!res.ok) {
      console.error('insert failed', res.status, await res.text());
      return json({ error: 'could not save' }, 500);
    }
    return json({ ok: true });
  } catch {
    return json({ error: 'bad request' }, 400);
  }
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
