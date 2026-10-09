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

import { computed, ref, type Ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useStore } from "vuex";
import { useOrgId } from "@/composables/query/useOrgId";
import type {
  QualityAgentParams,
  QualityConfigSummary,
  ScoreConfig,
} from "@/services/online-evals.service";
import { qualityFailedRunsQuery, qualityListQuery } from "@/services/online-evals.service.queries";
import { entityId, valueOf } from "../utils/evalEntity";
import { evaluatorAgentWhere, type QualityRow } from "../utils/qualityFormat";
import type { GenAiAgentListItem } from "@/services/gen-ai-agent-mapping.service";
import { thresholdForConfig } from "../utils/scoreThreshold";

/** Absolute time window in microseconds. */
export interface DateWindow {
  startUs: number;
  endUs: number;
}

export const httpStatus = (error: unknown): number | undefined =>
  (error as any)?.response?.status ?? (error as any)?.status;

/** Adds the description, version, range and threshold rule from the Score Config list. */
export function joinQualityRows(
  list: QualityConfigSummary[],
  configs: ScoreConfig[],
): QualityRow[] {
  const byId = new Map(configs.map((config) => [entityId(config), config]));
  return list.map((summary) => {
    const config = byId.get(summary.configId);
    const range = config ? valueOf<any>(config, "numericRange", "numeric_range") : null;
    return {
      ...summary,
      description: config?.description ?? "",
      version: config?.version ?? null,
      thresholdLabel: config ? String(thresholdForConfig(config).label) : "",
      range: { min: Number(range?.min ?? 0), max: Number(range?.max ?? 1) },
    };
  });
}

/** The two clickable tiles; one filters the table at a time. */
export type QualityTileFilter = "attention" | "withoutResult";

const TILE_STATUSES: Record<QualityTileFilter, QualityRow["status"][]> = {
  attention: ["attention"],
  withoutResult: ["no_data", "unset"],
};

export const matchesTileFilter = (row: QualityRow, filter: QualityTileFilter) =>
  TILE_STATUSES[filter].includes(row.status);

/** Tile values, all from the one list response. */
export function qualityTiles(rows: QualityRow[]) {
  const count = (status: QualityRow["status"]) =>
    rows.filter((row) => row.status === status).length;
  const noScores = count("no_data");
  const noThreshold = count("unset");
  return {
    total: rows.length,
    attention: count("attention"),
    withoutResult: noScores + noThreshold,
    noScores,
    noThreshold,
  };
}

export function useQualityList(opts: {
  scoreConfigs: Ref<ScoreConfig[]>;
  dateWindow: Ref<DateWindow>;
  agentParams: Ref<QualityAgentParams>;
  /** Agents the cascade selects; null while every level is "All". */
  evaluatorAgents: Ref<GenAiAgentListItem[] | null>;
  enabled: Ref<boolean>;
}) {
  const store = useStore();
  const orgId = useOrgId();
  const enabled = computed(() => !!orgId.value && opts.enabled.value);

  const listQuery = useQuery(() =>
    Object.assign(
      qualityListQuery(orgId.value, {
        start_time: opts.dateWindow.value.startUs,
        end_time: opts.dateWindow.value.endUs,
        ...opts.agentParams.value,
      }),
      { enabled: enabled.value },
    ),
  );

  // `_evaluator` has no env or version, so the count follows the ids of the agents the levels select; none selected, no count.
  const countable = computed(() => opts.evaluatorAgents.value?.length !== 0);
  const agentWhere = computed(() =>
    opts.evaluatorAgents.value ? evaluatorAgentWhere(opts.evaluatorAgents.value) : null,
  );

  const failedRunsQuery = useQuery(() =>
    Object.assign(
      qualityFailedRunsQuery(orgId.value, {
        startTime: opts.dateWindow.value.startUs,
        endTime: opts.dateWindow.value.endUs,
        agentWhere: agentWhere.value,
        base64: !!store.state.zoConfig?.sql_base64_enabled,
      }),
      { enabled: enabled.value && countable.value },
    ),
  );
  /** Failed evaluator runs; null while unknown or when no agent matches the selection. */
  const failedRuns = computed(() =>
    countable.value && !failedRunsQuery.error.value ? (failedRunsQuery.data.value ?? null) : null,
  );

  const rows = computed(() => joinQualityRows(listQuery.data.value ?? [], opts.scoreConfigs.value));
  const tiles = computed(() => qualityTiles(rows.value));
  const tileFilter = ref<QualityTileFilter | null>(null);
  const visibleRows = computed(() => {
    const filter = tileFilter.value;
    return filter ? rows.value.filter((row) => matchesTileFilter(row, filter)) : rows.value;
  });
  const listStatus = computed(() => httpStatus(listQuery.error.value));

  return {
    listQuery,
    failedRunsQuery,
    failedRuns,
    rows,
    visibleRows,
    tiles,
    tileFilter,
    listStatus,
  };
}
