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
    class="flex min-h-0 min-w-0 flex-1 flex-col max-lg:overflow-y-auto"
    data-test="quality-detail"
  >
    <div
      v-if="errorStatus"
      class="flex min-h-0 flex-1 items-center justify-center"
      data-test="quality-detail-error"
    >
      <OEmptyState
        v-if="errorStatus === 403"
        size="hero"
        preset="no-access"
        :action-label="t('onlineEvals.quality.detail.backToAll')"
        @action="emit('back')"
      />
      <OEmptyState
        v-else-if="errorStatus === 404"
        size="hero"
        illustration="no-results"
        :title="t('onlineEvals.quality.detail.notFound')"
        :description="t('onlineEvals.quality.detail.notFoundDescription')"
        :action-label="t('onlineEvals.quality.detail.backToAll')"
        @action="emit('back')"
      />
      <OEmptyState v-else size="hero" preset="load-error" @action="retry" />
    </div>

    <!-- First load keeps the detail's shape: chart, review toolbar, score list, and the pane with its own skeletons. -->
    <div
      v-else-if="scoresQuery.isPending.value"
      class="flex min-h-0 flex-1 flex-col max-lg:min-h-128"
      data-test="quality-detail-loading"
    >
      <div class="px-page-edge border-border-default flex shrink-0 flex-col gap-2 border-b py-1.5">
        <OSkeleton type="text" class="h-3 w-32" />
        <OSkeleton type="rect" class="h-24 w-full" />
      </div>
      <div class="px-page-edge border-border-default shrink-0 border-b py-1.5">
        <OSkeleton type="text" class="h-7 w-64" />
      </div>
      <div class="flex min-h-0 flex-1 max-md:flex-col">
        <div
          class="border-border-default flex w-96 shrink-0 flex-col gap-3 border-e p-3 max-lg:w-80 max-md:w-auto max-md:border-e-0 max-md:border-b"
        >
          <OSkeleton v-for="row in 5" :key="row" type="text" class="h-8 w-full" />
        </div>
        <QualityScorePane
          :score="null"
          threshold-label=""
          :can-prev="false"
          :can-next="false"
          loading
        />
      </div>
    </div>

    <div
      v-else-if="summary.total === 0"
      class="flex min-h-0 flex-1 items-center justify-center"
      data-test="quality-detail-empty"
    >
      <OEmptyState
        size="hero"
        illustration="hourglass"
        :title="
          scope === 'all'
            ? t('onlineEvals.quality.detail.emptyTitle')
            : t('onlineEvals.quality.detail.emptyTitleScoped', {
                scope: t(`onlineEvals.quality.scopeNouns.${scope}`),
              })
        "
        :description="t('onlineEvals.quality.detail.emptyDescription')"
      />
    </div>

    <template v-else>
      <div
        class="px-page-edge border-border-default shrink-0 border-b pt-1.5"
        data-test="quality-detail-distribution"
      >
        <div class="flex flex-wrap items-baseline gap-2 text-xs">
          <span class="text-text-heading font-semibold">{{
            isNumeric
              ? t("onlineEvals.quality.detail.distributionNumeric")
              : t("onlineEvals.quality.detail.distributionValues")
          }}</span>
          <template v-if="isNumeric && average != null">
            <span class="text-text-secondary">·</span>
            <span class="text-text-heading font-semibold" data-test="quality-detail-average">{{
              t("onlineEvals.quality.detail.averageValue", { value: average.toFixed(2) })
            }}</span>
          </template>
        </div>
        <div class="h-28 min-h-0">
          <QualityDistributionChart
            :buckets="distribution"
            :filter="filter"
            @select="onBarSelect"
          />
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col max-lg:min-h-128" data-test="quality-detail-review">
        <div
          class="px-page-edge border-border-default flex shrink-0 flex-wrap items-center gap-2 border-b py-1.5"
        >
          <span class="text-text-heading text-sm font-semibold">{{
            t("onlineEvals.quality.review.title")
          }}</span>
          <OToggleGroup
            :model-value="only"
            data-test="quality-detail-only"
            @update:model-value="(value) => emit('update:only', value as QualityOnly)"
          >
            <OToggleGroupItem value="all" size="sm" data-test="quality-detail-only-all">
              {{ t("onlineEvals.quality.review.all") }}
              <span class="font-semibold tabular-nums">{{ summary.total }}</span>
            </OToggleGroupItem>
            <OToggleGroupItem
              value="unhealthy"
              size="sm"
              :disabled="summary.unhealthy == null"
              :tooltip="
                summary.unhealthy == null
                  ? t('onlineEvals.quality.review.unhealthyDisabled')
                  : undefined
              "
              data-test="quality-detail-only-unhealthy"
            >
              {{ t("onlineEvals.quality.review.unhealthy") }}
              <span class="font-semibold tabular-nums">{{ summary.unhealthy ?? 0 }}</span>
            </OToggleGroupItem>
          </OToggleGroup>
          <OTag
            v-if="filter"
            variant="primary-soft"
            :label="chartFilterLabel(filter, distribution, t)"
            removable
            :remove-label="t('onlineEvals.quality.detail.clearFilter')"
            data-test="quality-detail-filter-chip"
            @remove="clearFilter"
          />
        </div>
        <div class="flex min-h-0 flex-1 max-md:flex-col">
          <div
            ref="listEl"
            class="border-border-default flex min-h-0 w-96 shrink-0 flex-col border-e max-lg:w-80 max-md:h-96 max-md:w-auto max-md:border-e-0 max-md:border-b"
          >
            <OTable
              class="min-h-0 flex-1"
              :data="list"
              :columns="scoreColumns"
              row-key="id"
              :show-header="false"
              :show-global-filter="false"
              :default-columns="false"
              pagination="server"
              sorting="none"
              :total-count="total"
              :current-page="page + 1"
              :page-size="SCORES_PAGE_SIZE"
              :page-size-options="[]"
              :loading="scoresQuery.isPending.value"
              :row-class="
                (score: QualityScore) =>
                  score.id === selected?.id ? 'bg-table-row-selected-bg' : ''
              "
              data-test="quality-detail-scores"
              @update:current-page="(next: number) => setPage(next - 1)"
              @row-click="(score: QualityScore) => select(score.id)"
            >
              <template #cell-score="{ row: score }">
                <div
                  class="flex min-w-0 items-start gap-2 py-1"
                  :data-test="`quality-score-row-${score.id}`"
                >
                  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      class="truncate text-sm"
                      :class="score.inputPreview ? 'text-text-body' : 'text-text-muted'"
                      >{{
                        score.inputPreview || t("onlineEvals.quality.review.inputNotCaptured")
                      }}</span
                    >
                    <span class="text-text-secondary flex items-center gap-1 text-xs">
                      <OTimeCell :value="score.timestamp" unit="us" mode="absolute" />
                      <template v-if="multiScope">
                        <span>·</span>
                        <span>{{ t(`onlineEvals.quality.scopes.${score.targetScope}`) }}</span>
                      </template>
                    </span>
                  </div>
                  <OTag
                    class="shrink-0"
                    :variant="pillVariant(score)"
                    :label="raw(formatScoreValue(score.value, dataType))"
                  />
                </div>
              </template>
              <template #empty>
                <OEmptyState
                  size="inline"
                  icon="filter-list"
                  :title="t('onlineEvals.quality.review.noMatch')"
                />
              </template>
            </OTable>
          </div>
          <QualityScorePane
            :score="selected"
            :threshold-label="thresholdLabel"
            :can-prev="canPrev"
            :can-next="canNext"
            :loading="listLoading"
            @prev="prev"
            @next="next"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import type {
  QualityAgentParams,
  QualityDistributionBucket,
  QualityScore,
  ScoreConfig,
  ScoreDataType,
} from "@/services/online-evals.service";
import { SCORES_PAGE_SIZE, useQualityDetail } from "../composables/useQualityDetail";
import type { DateWindow } from "../composables/useQualityList";
import { dataTypeOf } from "../utils/evalEntity";
import { thresholdForConfig } from "../utils/scoreThreshold";
import {
  QUALITY_SCOPES,
  chartFilterLabel,
  distributionDataType,
  formatScoreValue,
  nextChartFilter,
  type QualityOnly,
  type QualityRow,
  type QualityScope,
} from "../utils/qualityFormat";
import QualityDistributionChart from "./QualityDistributionChart.vue";
import QualityScorePane from "./QualityScorePane.vue";

const props = defineProps<{
  configId: string;
  /** The config's list row; null until the list loads or when the list does not have it. */
  row: QualityRow | null;
  /** The Score Config itself, for the type and threshold when there is no list row. */
  config: ScoreConfig | null;
  scope: QualityScope;
  only: QualityOnly;
  dateWindow: DateWindow;
  agentParams: QualityAgentParams;
  enabled: boolean;
  /** Zero-based page to reopen, from the URL. */
  initialPage: number;
  /** Score to reselect when it is on that page, from the URL. */
  initialScoreId: string | null;
}>();

const emit = defineEmits<{
  (e: "back"): void;
  (e: "update:only", only: QualityOnly): void;
  (e: "status", status: { updatedAt: number; fetching: boolean }): void;
  /** The page and selected score, for the URL. */
  (e: "position", position: { page: number; scoreId: string | null }): void;
}>();

const { t } = useI18nTyped();

const {
  scoresQuery,
  filter,
  page,
  distribution,
  summary,
  list,
  total,
  listLoading,
  selected,
  canPrev,
  canNext,
  next,
  prev,
  select,
  setPage,
  average,
  errorStatus,
} = useQualityDetail({
  configId: toRef(props, "configId"),
  scope: toRef(props, "scope"),
  only: toRef(props, "only"),
  dateWindow: toRef(props, "dateWindow"),
  agentParams: toRef(props, "agentParams"),
  enabled: toRef(props, "enabled"),
  initial: { page: props.initialPage, scoreId: props.initialScoreId },
});

// Without a list row, the Score Config list, then the distribution itself, says what the config is.
const dataType = computed<ScoreDataType>(
  () =>
    props.row?.dataType ??
    (props.config
      ? (dataTypeOf(props.config) as ScoreDataType)
      : distributionDataType(distribution.value)),
);
const isNumeric = computed(() => dataType.value === "numeric");
const thresholdLabel = computed(
  () =>
    props.row?.thresholdLabel ??
    (props.config ? String(thresholdForConfig(props.config).label) : ""),
);
const multiScope = computed(
  () => QUALITY_SCOPES.filter((scope) => (props.row?.scopeCounts[scope] ?? 0) > 0).length > 1,
);

const scoreColumns: OTableColumnDef<QualityScore>[] = [
  { id: "score", header: raw(""), accessorKey: "id", meta: { flex: true } },
];

function pillVariant(score: QualityScore): BadgeVariant {
  if (score.unhealthy == null) return "default-soft";
  return score.unhealthy ? "error-soft" : "success-soft";
}

function onBarSelect(bucket: QualityDistributionBucket, shift: boolean) {
  filter.value = nextChartFilter(filter.value, bucket, shift);
}

function clearFilter() {
  filter.value = null;
}

function retry() {
  void scoresQuery.refetch();
}

// Keep the selected row in view as previous and next move through the list.
const listEl = ref<HTMLElement | null>(null);
watch(selected, async (score) => {
  if (!score) return;
  await nextTick();
  listEl.value
    ?.querySelector(`[data-test="quality-score-row-${score.id}"]`)
    ?.scrollIntoView?.({ block: "nearest" });
});

// Reported once the page has loaded, so a page still loading never clears the score in the URL.
watch(
  () => [page.value, selected.value?.id ?? null, listLoading.value] as const,
  ([currentPage, scoreId, loading]) => {
    if (!loading) emit("position", { page: currentPage, scoreId });
  },
  { immediate: true },
);

watch(
  () => [scoresQuery.dataUpdatedAt.value, scoresQuery.isFetching.value] as const,
  ([updatedAt, fetching]) => emit("status", { updatedAt, fetching }),
  { immediate: true },
);

// Esc goes back to the list, unless a dialog, menu or dropdown is open and takes the key.
useShortcuts([
  {
    id: "qualityBack",
    handler: () => {
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      emit("back");
    },
  },
]);
</script>
