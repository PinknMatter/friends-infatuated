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
