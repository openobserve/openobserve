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

import { computed, ref, watch } from "vue";
import type { Router } from "vue-router";
import useProductAnalytics from "@/composables/rum/useProductAnalytics";
import useAnalyticsSearch from "@/composables/rum/useAnalyticsSearch";
import { summarySql } from "@/utils/rum/productAnalyticsQueries";

export interface AppFilterCounts {
  builtin: number | null;
  rules: number | null;
  synthetic: number;
}

type HiddenCounts =
  { key: string; status: "ok"; builtin: number; rules: number } | { key: string; status: "failed" };

// Shared across callers, so the header menu and the Funnels tab never run the same query twice.
const hidden = ref<HiddenCounts | null>(null);
let loadingKey = "";

const split = (total: number, builtinKept: number, kept: number) => ({
  builtin: Math.max(0, total - builtinKept),
  rules: Math.max(0, builtinKept - kept),
});

const num = (v: unknown): number => Number(v) || 0;

/** Sessions the app filters remove from the current view, and the one-view switch that includes them. */
export default function useAppFilterCounts() {
  const pa = useProductAnalytics();
  const runner = useAnalyticsSearch();

  const synthetic = computed(() =>
    pa.schema.value.session_type ? (pa.summary.value?.syntheticSessions ?? 0) : 0,
  );

  const hiddenHere = computed(() =>
    hidden.value?.key === pa.scopeKey.value ? hidden.value : null,
  );

  // Under xall the page summary runs with every rule off, so only the rule counts wait on their own query.
  const counts = computed<AppFilterCounts | null>(() => {
    const s = pa.summary.value;
    if (!s) return null;
    if (!pa.state.includeExcluded) {
      return {
        ...split(s.totalSessions, s.builtinKeptSessions, s.sessions),
        synthetic: synthetic.value,
      };
    }
    const h = hiddenHere.value;
    return h?.status === "ok"
      ? { builtin: h.builtin, rules: h.rules, synthetic: synthetic.value }
      : { builtin: null, rules: null, synthetic: synthetic.value };
  });

  const hiddenTotal = computed(() => {
    const c = counts.value;
    return c && c.builtin !== null && c.rules !== null ? c.builtin + c.rules : null;
  });

  const hiddenFailed = computed(
    () => pa.state.includeExcluded && hiddenHere.value?.status === "failed",
  );

  const loadHidden = async (force = false) => {
    if (!pa.state.includeExcluded || !pa.state.app || pa.scopeStatus.value !== "ok") return;
    const key = pa.scopeKey.value;
    if (loadingKey === key || (!force && hidden.value?.key === key)) return;
    loadingKey = key;
    const cur = pa.resolveRange();
    const res = await runner.run<Record<string, unknown>>(
      "app-filter-counts",
      {
        sql: summarySql({ ...pa.scope.value, xall: undefined }, cur.startUs),
        ...cur,
        limit: 1,
        sampled: 1,
      },
      key,
    );
    if (loadingKey === key) loadingKey = "";
    // Each caller has its own runner, so a late result for an older scope must not replace the current one.
    if (res.status === "aborted" || key !== pa.scopeKey.value) return;
    if (res.status !== "ok") {
      hidden.value = { key, status: "failed" };
      return;
    }
    const hit = res.rows[0] ?? {};
    hidden.value = {
      key,
      status: "ok",
      ...split(num(hit.total_sessions), num(hit.builtin_kept_sessions), num(hit.sessions)),
    };
  };

  const retryHidden = () => loadHidden(true);

  const setIncludeHidden = async (router: Router, include: boolean) => {
    pa.setScope({ includeExcluded: include });
    await pa.loadScope();
    await pa.syncUrl(router);
  };

  watch(
    () => [pa.state.includeExcluded, pa.scopeKey.value, pa.scopeStatus.value],
    () => void loadHidden(),
    { immediate: true },
  );

  // An absolute range keeps its scope key across Refresh, so the refresh itself reruns the count.
  watch(
    () => pa.refreshTick.value,
    () => void loadHidden(true),
  );

  return { counts, hiddenTotal, hiddenFailed, retryHidden, setIncludeHidden };
}
