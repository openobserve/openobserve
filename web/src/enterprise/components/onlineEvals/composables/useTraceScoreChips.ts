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
import { useStore } from "vuex";
import { useLLMStreamQuery } from "@/plugins/traces/composables/useLLMStreamQuery";
import onlineEvalsService, { type ScoreConfig } from "@/services/online-evals.service";
import { buildTargetScoresSql, type TraceScoreScope } from "../utils/traceScoreSql";

export interface TraceScoreChip {
  key: string;
  label: string;
  value: string;
  /** What this dimension measures, from the Score Config — the "why does
   *  this number mean anything" context a bare chip can't carry on its own. */
  description: string | null;
  /** The judge's stated reasoning for this specific score, when the scorer
   *  recorded one — the single most useful thing to surface on hover, since
   *  it explains this exact value rather than the dimension in general. */
  reasoning: string | null;
  /** When this score was recorded, in epoch ms — a chip on a 6-day-old trace
   *  could easily be evaluated well after the fact by an async Eval Job. */
  scoredAtMs: number | null;
}

function formatValue(row: Record<string, unknown>): string {
  if (row.value_numeric !== null && row.value_numeric !== undefined && row.value_numeric !== "") {
    const numeric = Number(row.value_numeric);
    return Number.isFinite(numeric) ? numeric.toFixed(2) : String(row.value_numeric);
  }
  if (
    row.value_boolean !== null &&
    row.value_boolean !== undefined &&
    String(row.value_boolean) !== ""
  ) {
    return String(row.value_boolean) === "true" ? "true" : "false";
  }
  if (row.value_categorical) return String(row.value_categorical);
  return "—";
}

/** Real per-target evaluation scores, shown as a chip on the trace/span the
 *  reviewer is already looking at instead of only in the separate Quality
 *  dashboard. Every failure path — a non-LLM org with no `_llm_scores`
 *  stream, a transient search error, a missing score-config lookup — must
 *  resolve to "no chips" rather than surface anywhere, since this is a
 *  purely additive affordance on a page every trace (LLM or not) renders. */
export function useTraceScoreChips() {
  const store = useStore();
  const { executeQueryOnce } = useLLMStreamQuery();
  const chips = ref<TraceScoreChip[]>([]);
  const loading = ref(false);

  async function load(scope: TraceScoreScope, targetId: string, startTimeUs: number) {
    chips.value = [];
    const orgId = store.state.selectedOrganization?.identifier ?? "";
    if (!targetId || !orgId) return;

    loading.value = true;
    try {
      const endTimeUs = Date.now() * 1000;
      const [rows, configs] = await Promise.all([
        // The dedup subquery's ROW_NUMBER()/ORDER BY need the full time range
        // in one shot — the streaming endpoint evaluates window functions per
        // slice, which can surface a stale row ahead of a newer one.
        executeQueryOnce(
          buildTargetScoresSql(scope, targetId),
          Math.max(0, Math.floor(startTimeUs) - 1),
          endTimeUs,
          "logs",
        ),
        onlineEvalsService.scoreConfigs.listCached(orgId).catch(() => [] as ScoreConfig[]),
      ]);

      const configById = new Map<string, ScoreConfig>();
      for (const config of configs) {
        const id = String(config.entityId ?? config.entity_id ?? config.id ?? "");
        if (id) configById.set(id, config);
      }

      // An automated Eval Job score and a manual annotation for the same
      // dimension are separate evaluation attempts with separate identities
      // by design (append-only ledger), so the dedup subquery legitimately
      // returns both. Collapse them here to the single most recent value per
      // scorer, so a later manual override actually supersedes the chip.
      const latestByScorer = new Map<
        string,
        { row: Record<string, unknown>; scoredAtUs: number }
      >();
      for (const row of (rows ?? []) as Record<string, unknown>[]) {
        const configId = String(row.score_config_id ?? "");
        const scorerKey = configId || String(row.scorer_id ?? "score");
        const scoredAtUs = Number(row._timestamp ?? row.timestamp ?? NaN);
        const existing = latestByScorer.get(scorerKey);
        if (!existing || (Number.isFinite(scoredAtUs) && scoredAtUs > existing.scoredAtUs)) {
          latestByScorer.set(scorerKey, { row, scoredAtUs });
        }
      }

      chips.value = Array.from(latestByScorer.entries()).map(([scorerKey, { row, scoredAtUs }]) => {
        const config = configById.get(scorerKey);
        return {
          key: scorerKey,
          label: config?.name || String(row.scorer_id ?? "Score"),
          value: formatValue(row),
          description: config?.description || null,
          reasoning: (row.reasoning as string | null) || null,
          scoredAtMs: Number.isFinite(scoredAtUs) ? Math.floor(scoredAtUs / 1000) : null,
        };
      });
    } catch {
      chips.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { chips, loading, load };
}
