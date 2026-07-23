// Live audience sentences from Supabase → the sentence store. Plain REST
// polling (no supabase-js dependency, no websocket to babysit mid-set): every
// POLL_SECS fetch the FULL approved set and reconcile — new rows feed
// store.addExternal (→ onAdded → batched reshuffle), vanished rows (deleted or
// unapproved in the dashboard: the moderation path) feed store.removeExternal
// (→ onRemoved → boxes showing them retire). Network failures are silent and
// retried on the next tick — venue wifi dying must never take the visuals
// down, and a failed fetch must NOT read as "everything was deleted".

import type { StaticSentenceStore } from './sentences';
import { SUPABASE_URL, SUPABASE_KEY } from './supabaseConfig';

const POLL_SECS = 8;

export function startSupabaseSync(
  store: StaticSentenceStore,
  log: (text: string) => void,
): void {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;

  // id → text of every row we've fed the store; the reconcile diff base.
  const known = new Map<number, string>();
  let firstLoadDone = false;

  const tick = async (): Promise<void> => {
    try {
      const query =
        `${SUPABASE_URL}/rest/v1/sentences` +
        `?select=id,text&approved=is.true&order=id.asc&limit=1000`;
      const res = await fetch(query, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (!res.ok) return;
      const rows: { id: number; text: string }[] = await res.json();
      if (!Array.isArray(rows)) return;

      const liveIds = new Set(rows.map((r) => r.id));

      let added = 0;
      for (const row of rows) {
        if (known.has(row.id)) continue;
        known.set(row.id, row.text);
        if (store.addExternal(row.text)) added++;
      }

      let removed = 0;
      for (const [id, text] of known) {
        if (liveIds.has(id)) continue;
        known.delete(id);
        if (store.removeExternal(text)) removed++;
      }

      if (!firstLoadDone) {
        firstLoadDone = true;
        log(`supabase: loaded ${added} audience sentences`);
      } else {
        if (added > 0) log(`supabase: +${added} new from the crowd`);
        if (removed > 0) log(`supabase: -${removed} moderated off the wall`);
      }
    } catch {
      /* offline — retry next tick */
    }
  };

  void tick();
  setInterval(() => void tick(), POLL_SECS * 1000);
}
