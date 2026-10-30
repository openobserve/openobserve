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
  /** From the Score Config: the context a bare number cannot carry on its own. */
  description: string | null;
  /** The judge's reasoning for this exact value, when the scorer recorded one. */
  reasoning: string | null;
  /** Epoch ms; an async Eval Job can score a trace long after it landed. */
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

/** Every failure path must resolve to "no chips": this renders on every trace, LLM or not. */
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
        // The streaming endpoint evaluates window functions per slice, which can rank a stale row first.
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

      // An eval job score and a manual annotation are separate ledger entries, so keep the newest per scorer.
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
