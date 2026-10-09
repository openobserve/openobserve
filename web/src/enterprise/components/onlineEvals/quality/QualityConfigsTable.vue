<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    class="bg-card-glass-bg flex h-full min-h-0 min-w-0 flex-1 flex-col"
    data-test="quality-configs"
  >
    <OTable
      class="min-h-0 flex-1"
      data-test="quality-configs-table"
      :data="filteredRows"
      :columns="columns"
      row-key="configId"
      :loading="loading"
      :forbidden="forbidden"
      :show-global-filter="false"
      :default-columns="false"
      :enable-column-resize="true"
      :persist-columns="true"
      table-id="quality-score-configs-v3"
      sort-by="health"
      sort-order="asc"
      width="100%"
      @row-click="(row: QualityRow) => emit('open', row, 'all')"
    >
      <template #subheader>
        <div
          class="px-page-edge border-table-row-divider border-b py-1.5"
          data-test="quality-tiles"
        >
          <OStatStrip>
            <OTooltip :content="t('onlineEvals.quality.tiles.attentionTooltip')">
              <OStatCard
                class="grow basis-52 max-lg:shrink-0 max-lg:basis-auto"
                :label="t('onlineEvals.quality.tiles.attention')"
                :value="loading ? '—' : tiles.attention"
                :max="tiles.total"
                :tone="tiles.attention > 0 ? 'error' : 'neutral'"
                clickable
                :selected="tileFilter === 'attention'"
                data-test="quality-tile-attention"
                @click="toggleTile('attention')"
              >
                <template #value>
                  <span data-test="quality-tile-attention-value">{{
                    loading ? "—" : tiles.attention
                  }}</span>
                  <span v-if="!loading" class="text-text-secondary ms-1 text-sm font-normal">{{
                    t("onlineEvals.quality.tiles.ofTotal", { total: tiles.total })
                  }}</span>
                </template>
                <template #chart>
                  <span class="text-text-secondary text-xs">{{
                    t("onlineEvals.quality.tiles.attentionNote")
                  }}</span>
                </template>
              </OStatCard>
            </OTooltip>
            <OTooltip :content="t('onlineEvals.quality.tiles.withoutResultTooltip')">
              <OStatCard
                class="grow basis-52 max-lg:shrink-0 max-lg:basis-auto"
                :label="t('onlineEvals.quality.tiles.withoutResult')"
                :value="loading ? '—' : tiles.withoutResult"
                :max="tiles.total"
                :tone="tiles.withoutResult > 0 ? 'warning' : 'neutral'"
                clickable
                :selected="tileFilter === 'withoutResult'"
                data-test="quality-tile-without-result"
                @click="toggleTile('withoutResult')"
              >
                <template #value>
                  <span data-test="quality-tile-without-result-value">{{
                    loading ? "—" : tiles.withoutResult
                  }}</span>
                  <span v-if="!loading" class="text-text-secondary ms-1 text-sm font-normal">{{
                    t("onlineEvals.quality.tiles.ofTotal", { total: tiles.total })
                  }}</span>
                </template>
                <template #chart>
                  <div
                    class="text-text-secondary flex flex-wrap items-center gap-x-1.5 text-xs"
                    data-test="quality-tile-without-result-note"
                  >
                    <template v-for="(part, index) in withoutResultParts" :key="index">
                      <span v-if="index">·</span>
                      <span>{{ part }}</span>
                    </template>
                    <!-- Failed judge runs explain missing scores, so they show only when there are some. -->
                    <template v-if="(failedRuns ?? 0) > 0">
                      <span>·</span>
                      <span class="text-status-error-text" data-test="quality-tile-failed-runs">{{
                        t(
                          "onlineEvals.quality.tiles.failedRuns",
                          { count: failedRuns },
                          failedRuns!,
                        )
                      }}</span>
                      <span>·</span>
                      <OButton
                        variant="ghost-primary"
                        size="chip"
                        data-test="quality-tile-eval-jobs"
                        @click.stop="openEvalJobs"
                      >
                        {{ t("onlineEvals.quality.tiles.evalJobs") }}
                      </OButton>
                    </template>
                  </div>
                </template>
              </OStatCard>
            </OTooltip>
          </OStatStrip>
        </div>
      </template>

      <template #toolbar>
        <div class="flex min-w-0 flex-1 items-center gap-2 max-md:contents">
          <OSearchInput
            v-model="search"
            class="min-w-0 flex-1 max-md:min-w-40"
            :placeholder="t('onlineEvals.quality.table.searchPlaceholder')"
            data-test="quality-configs-search"
          />
        </div>
      </template>

      <template #empty>
        <div class="flex items-center justify-center py-8" data-test="quality-configs-empty">
          <OEmptyState v-if="loadError" size="hero" preset="load-error" @action="emit('retry')" />
          <OEmptyState
            v-else
            size="hero"
            preset="no-score-configs"
            :filtered="!!search.trim() || !!tileFilter"
            @action="onEmptyAction"
          />
        </div>
      </template>

      <template #cell-name="{ row }">
        <div class="flex min-w-0 flex-col gap-0.5">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="text-text-heading truncate font-semibold">{{ row.name }}</span>
            <OTag type="evalDataType" :value="row.dataType" size="xs" />
          </div>
          <span v-if="row.description" class="text-text-secondary truncate text-xs">{{
            row.description
          }}</span>
        </div>
      </template>

      <template #cell-health="{ row }">
        <div class="flex min-w-0 flex-col items-start gap-0.5" data-test="quality-configs-health">
          <OTag type="qualityStatus" :value="row.status" />
          <span class="text-text-secondary max-w-full truncate text-xs">{{ healthLine(row) }}</span>
        </div>
      </template>

      <template #cell-typical="{ row }">
        <div v-if="typicalScore(row, t)" class="flex min-w-0 flex-col gap-0.5">
          <span class="text-text-heading truncate font-semibold">{{
            typicalScore(row, t)?.value
          }}</span>
          <span class="text-text-secondary truncate text-xs">{{ typicalScore(row, t)?.sub }}</span>
        </div>
        <span v-else class="text-text-muted">—</span>
      </template>

      <template #cell-unhealthy="{ row }">
        <OButton
          v-if="unhealthyShare(row) != null"
          variant="cell"
          :title="t('onlineEvals.quality.table.openUnhealthy')"
          :data-test="`quality-configs-unhealthy-${row.configId}`"
          @click.stop="emit('open', row, 'unhealthy')"
        >
          <OProgressBar
            :value="unhealthyShare(row) ?? 0"
            :variant="unhealthyTone(unhealthyShare(row)) ?? 'default'"
            size="sm"
          />
          <span class="flex items-baseline gap-1.5 text-xs whitespace-nowrap">
            <span class="text-text-secondary">{{
              t("onlineEvals.quality.outOf", { count: row.unhealthy ?? 0, total: row.total })
            }}</span>
            <span class="text-text-heading font-semibold">{{
              formatPercent(row.unhealthy ?? 0, row.total)
            }}</span>
          </span>
        </OButton>
        <span v-else class="text-text-muted">—</span>
      </template>

      <template #cell-scores="{ row }">
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-text-heading font-semibold tabular-nums">{{ row.total }}</span>
          <span class="text-text-secondary truncate text-xs">{{
            scopeMixText(row.scopeCounts, t)
          }}</span>
        </div>
      </template>

      <template #cell-updated="{ row }">
        <OTimeCell :value="row.lastScoredAt" unit="us" />
      </template>

      <template #cell-actions="{ row }">
        <OButton
          variant="ghost-primary"
          size="xs"
          :data-test="`quality-configs-config-link-${row.configId}`"
          @click.stop="openConfig(row)"
        >
          {{ t("onlineEvals.quality.table.configLink") }}
        </OButton>
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useOrgId } from "@/composables/query/useOrgId";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import OStatCard from "@/lib/data/StatStrip/OStatCard.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { QualityTileFilter, qualityTiles } from "../composables/useQualityList";
import {
  formatPercent,
  healthSortValue,
  scopeMixText,
  scoreConfigLink,
  typicalScore,
  typicalSortValue,
  unhealthyShare,
  unhealthyTone,
  type QualityOnly,
  type QualityRow,
} from "../utils/qualityFormat";

const props = defineProps<{
  rows: QualityRow[];
  tiles: ReturnType<typeof qualityTiles>;
  /** Failed evaluator runs in the window; null while unknown. */
  failedRuns: number | null;
  /** The tile filtering the table, if any; one at a time. */
  tileFilter: QualityTileFilter | null;
  loading: boolean;
  forbidden: boolean;
  loadError: boolean;
}>();

const emit = defineEmits<{
  (e: "update:tileFilter", value: QualityTileFilter | null): void;
  (e: "open", row: QualityRow, only: QualityOnly): void;
  (e: "retry"): void;
}>();

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const search = ref("");

const filteredRows = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return props.rows;
  return props.rows.filter(
    (row) =>
      row.name.toLowerCase().includes(query) || row.description.toLowerCase().includes(query),
  );
});

// As on Alerts, the selected tile carries the filter and its ring: clicking it again clears, the other tile switches.
function toggleTile(filter: QualityTileFilter) {
  emit("update:tileFilter", props.tileFilter === filter ? null : filter);
}

/** The non-zero reasons a config gives no result, or the all-clear line. */
const withoutResultParts = computed(() => {
  const { noScores, noThreshold } = props.tiles;
  const parts = [
    noScores && t("onlineEvals.quality.tiles.noScores", { count: noScores }, noScores),
    noThreshold && t("onlineEvals.quality.tiles.noThreshold", { count: noThreshold }, noThreshold),
  ].filter((part): part is I18nText => !!part);
  return parts.length ? parts : [t("onlineEvals.quality.tiles.allGiveResult")];
});

const columns = computed<OTableColumnDef<QualityRow>[]>(() =>
  [
    {
      id: "name",
      header: t("onlineEvals.quality.table.columns.scoreConfig"),
      accessorKey: "name",
      sortable: true,
      size: COL.name,
      minSize: 200,
      meta: { align: "left" as const, flex: true },
    },
    {
      id: "health",
      header: t("onlineEvals.quality.table.columns.health"),
      accessorFn: healthSortValue,
      sortable: true,
      size: 200,
      minSize: 150,
    },
    {
      id: "typical",
      header: t("onlineEvals.quality.table.columns.typicalScore"),
      accessorFn: typicalSortValue,
      sortable: true,
      size: 190,
      minSize: 140,
    },
    {
      id: "unhealthy",
      header: t("onlineEvals.quality.table.columns.unhealthy"),
      accessorFn: (row: QualityRow) => unhealthyShare(row) ?? -1,
      sortable: true,
      size: 170,
      minSize: 140,
    },
    {
      id: "scores",
      header: t("onlineEvals.quality.table.columns.scores"),
      accessorKey: "total",
      sortable: true,
      size: 170,
      minSize: 110,
    },
    {
      id: "updated",
      header: t("onlineEvals.quality.table.columns.updated"),
      accessorFn: (row: QualityRow) => row.lastScoredAt ?? 0,
      sortable: true,
      size: 150,
      minSize: 120,
    },
    { id: "actions", header: raw(""), isAction: true, size: 110 },
  ].map((column) => ({
    ...column,
    meta: { align: "left" as const, ...(column as any).meta },
    hideable: column.id !== "name" && column.id !== "actions",
  })),
);

function healthLine(row: QualityRow) {
  if (row.status === "no_data") return t("onlineEvals.quality.noScoresInWindow");
  if (row.unhealthy == null) return t("onlineEvals.quality.setThreshold");
  return row.thresholdLabel
    ? t("onlineEvals.quality.healthyIf", { rule: row.thresholdLabel })
    : raw("");
}

const orgId = useOrgId();

// Same tab: browser Back returns to this view with its URL state.
function openConfig(row: QualityRow) {
  router
    .push(scoreConfigLink(String(route.name), orgId.value, row.configId, "view"))
    .catch(() => {});
}

function openEvalJobs() {
  router
    .push({ name: String(route.name), query: { org_identifier: orgId.value, tab: "jobs" } })
    .catch(() => {});
}

function onEmptyAction(id?: string) {
  if (id === "clear-filters") {
    search.value = "";
    emit("update:tileFilter", null);
    return;
  }
  if (id !== "create") return;
  router
    .push({
      name: route.name as string,
      query: { org_identifier: orgId.value, tab: "scoreConfigs", action: "add" },
    })
    .catch(() => {});
}
</script>
