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

// A failed or impossible traffic query leaves the counts unknown, never 0.

import { computed, onUnmounted, ref, watch, type Ref } from "vue";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import type { EvalTargetScope } from "@/services/online-evals.service";
import {
  ESTIMATE_DAYS,
  estimateJobSpend,
  judgeHistorySql,
  matchedPerDaySql,
  parseJudgeHistory,
  type JudgeHistory,
} from "../utils/evalSpend";

const DEBOUNCE_MS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

export function useJobSpendEstimate(opts: {
  stream: Ref<string>;
  where: Ref<string>;
  ready: Ref<boolean>;
  scope: Ref<EvalTargetScope>;
  /** Field names of the stream's schema; null while it loads. */
  fields: Ref<readonly string[] | null>;
  /** Entity ids of the selected LLM-judge scorers. */
  judgeIds: Ref<string[]>;
  rate: Ref<number>;
}) {
  const { executeQueryOnce } = useLLMStreamQuery();
  const dailyCounts = ref<number[] | null>([]);
  const history = ref<JudgeHistory[]>([]);
  const loadingTraffic = ref(false);
  const loadingJudges = ref(false);

  const lastWeek = () => {
    const end = Date.now();
    return { startUs: (end - ESTIMATE_DAYS * DAY_MS) * 1000, endUs: end * 1000 };
  };

  // A session count waits for the schema that names its column.
  const fieldsPending = () => opts.scope.value === "session" && !opts.fields.value;

  async function loadTraffic() {
    loadingTraffic.value = false;
    if (!opts.stream.value || !opts.ready.value) {
      dailyCounts.value = [];
      return;
    }
    if (fieldsPending()) {
      dailyCounts.value = [];
      loadingTraffic.value = true;
      return;
    }
    const { startUs, endUs } = lastWeek();
    const sql = matchedPerDaySql(
      opts.stream.value,
      opts.where.value,
      opts.scope.value,
      opts.fields.value ?? [],
      startUs,
    );
    if (!sql) {
      dailyCounts.value = null;
      return;
    }
    loadingTraffic.value = true;
    try {
      const rows = await executeQueryOnce(sql, startUs, endUs, "traces");
      dailyCounts.value = rows.map((r: any) => Number(r.cnt) || 0);
    } catch (err) {
      console.warn("[JobSpendEstimate:traffic] failed", err);
      dailyCounts.value = null;
    } finally {
      loadingTraffic.value = false;
    }
  }

  // No `_evaluator` stream or no priced call yet fails the query: nothing to estimate from.
  async function loadJudges() {
    if (!opts.judgeIds.value.length) {
      history.value = [];
      return;
    }
    const { startUs, endUs } = lastWeek();
    loadingJudges.value = true;
    try {
      const rows = await executeQueryOnce(
        judgeHistorySql(opts.judgeIds.value),
        startUs,
        endUs,
        "traces",
      );
      history.value = parseJudgeHistory(rows);
    } catch {
      history.value = [];
    } finally {
      loadingJudges.value = false;
    }
  }

  const timers: ReturnType<typeof setTimeout>[] = [];
  const debounced = (fn: () => Promise<void>, slot: number) => () => {
    clearTimeout(timers[slot]);
    timers[slot] = setTimeout(() => void fn(), DEBOUNCE_MS);
  };
  watch([opts.stream, opts.where, opts.ready, opts.scope, opts.fields], debounced(loadTraffic, 0), {
    immediate: true,
  });
  watch(() => opts.judgeIds.value.join(","), debounced(loadJudges, 1), { immediate: true });
  onUnmounted(() => timers.forEach(clearTimeout));

  const estimate = computed(() =>
    estimateJobSpend({
      dailyCounts: dailyCounts.value,
      rate: opts.rate.value,
      judgeIds: opts.judgeIds.value,
      history: history.value,
    }),
  );
  const loading = computed(() => loadingTraffic.value || loadingJudges.value);

  return { estimate, loading };
}
