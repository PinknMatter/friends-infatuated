// Live audience sentences from Supabase → the sentence store. Plain REST
// polling (no supabase-js dependency, no websocket to babysit mid-set): every
// POLL_SECS fetch approved rows newer than the last seen id and feed them
// through store.addExternal, which fires onAdded → the layout engine batches
// a reshuffle. Network failures are silent and retried on the next tick —
// venue wifi dying must never take the visuals down.

import type { StaticSentenceStore } from './sentences';
import { SUPABASE_URL, SUPABASE_KEY } from './supabaseConfig';

const POLL_SECS = 8;

export function startSupabaseSync(
  store: StaticSentenceStore,
  log: (text: string) => void,
): void {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  let lastId = 0;
  let announcedTotal = false;

  const tick = async (): Promise<void> => {
    try {
      const query =
        `${SUPABASE_URL}/rest/v1/sentences` +
        `?select=id,text&approved=is.true&id=gt.${lastId}&order=id.asc&limit=200`;
      const res = await fetch(query, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (!res.ok) return;
      const rows: { id: number; text: string }[] = await res.json();
      if (rows.length === 0) return;

      const firstLoad = lastId === 0;
      let added = 0;
      for (const row of rows) {
        lastId = Math.max(lastId, row.id);
        if (store.addExternal(row.text)) added++;
      }
      if (firstLoad && !announcedTotal) {
        announcedTotal = true;
        log(`supabase: loaded ${added} audience sentences`);
      } else if (added > 0) {
        log(`supabase: +${added} new from the crowd`);
      }
    } catch {
      /* offline — retry next tick */
    }
  };

  void tick();
  setInterval(() => void tick(), POLL_SECS * 1000);
}
