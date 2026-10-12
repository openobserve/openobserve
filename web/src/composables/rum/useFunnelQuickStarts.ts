// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { ref } from "vue";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import {
  pushRecentFunnel,
  readRecentFunnels,
  type NamedEvent,
} from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

const ENTRY_LIMIT = 5;

export type FunnelEntry = { key: string; sessions: number };

/** The top entry pages and recent funnels a funnel can start from. */
export default function useFunnelQuickStarts(events: () => readonly NamedEvent[]) {
  const pa = useProductAnalytics();
  const entries = ref<FunnelEntry[]>([]);
  const entriesLoading = ref(false);
  const entriesFailed = ref(false);
  const recent = ref<FunnelDef[]>([]);

  let entriesFor: string | null = null;

  const org = () => pa.toQuery().org_identifier as string;

  // Another app or range has other entry pages; a read for a scope since left must not land.
  const loadEntries = async () => {
    // An absolute range keeps its scopeKey across a Refresh, so the tick is what forces a re-read.
    const key = `${pa.scopeKey.value}|${pa.refreshTick.value}`;
    if (entriesFor === key) return;
    entriesFor = key;
    entries.value = [];
    entriesLoading.value = true;
    entriesFailed.value = false;
    let next: FunnelEntry[] = [];
    let failed = false;
    try {
      next = (await pa.entryExit())
        .map((r) => ({ key: String(r.k), sessions: Number(r.entry_sessions) || 0 }))
        .filter((r) => r.key && r.sessions > 0)
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, ENTRY_LIMIT);
    } catch {
      failed = true;
    }
    if (entriesFor !== key) return;
    entries.value = next;
    entriesLoading.value = false;
    entriesFailed.value = failed;
    if (failed) entriesFor = null;
  };

  // A funnel that names a deleted event is dropped from Recent rather than offered with a dead step.
  const refreshRecent = () => {
    const known = new Set(events().map((e) => e.id));
    recent.value = readRecentFunnels(org(), pa.state.app).filter((d) =>
      d.steps.every((s) => s.kind !== "e" || known.has(s.key)),
    );
  };

  const pushRecent = (def: FunnelDef) => {
    recent.value = pushRecentFunnel(org(), pa.state.app, def);
  };

  return { entries, entriesLoading, entriesFailed, recent, loadEntries, refreshRecent, pushRecent };
}
