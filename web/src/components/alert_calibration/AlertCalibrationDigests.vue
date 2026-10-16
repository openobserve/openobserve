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
  <OPageLayout
    :title="t('alertCalibration.title')"
    :subtitle="t('alertCalibration.subtitle')"
    icon="tune"
    tabs-below
    bleed
    data-test="alert-calibration-digests-page"
  >
    <template #header-tabs><AlertCalibrationTabs /></template>

    <template #actions>
      <AlertCalibrationActions :config="config" part="run" />
    </template>

    <template #actions-overflow>
      <AlertCalibrationActions :config="config" part="configure" />
    </template>

    <div class="flex h-full min-h-0 flex-col">
      <div class="px-page-edge flex shrink-0 flex-col gap-3 py-3">
        <AlertCalibrationLastRun v-if="config" only-failure />
        <OStatStrip :items="stats" data-test="alert-calibration-digests-stats" />
      </div>

      <div class="min-h-0 flex-1 overflow-hidden">
        <OTable
          :data="filtered"
          :columns="columns"
          :row-key="runKey"
          :loading="runs.loading.value"
          :error="runs.error.value"
          pagination="client"
          :page-size="20"
          sorting="client"
          :show-global-filter="false"
          :frame="false"
          table-id="alert-calibration-digests"
          class="h-full w-full"
          data-test="alert-calibration-digests-table"
          @row-click="open"
        >
          <template #toolbar>
            <div class="flex w-full items-center gap-2 max-md:contents">
              <OToggleGroup
                :model-value="scope"
                mobile-dropdown
                data-test="alert-calibration-digests-scope"
                @update:model-value="onScope"
              >
                <OToggleGroupItem value="all" size="sm">{{
                  t("alertCalibration.digests.scopeAll")
                }}</OToggleGroupItem>
                <OToggleGroupItem value="findings" size="sm">
                  {{ t("alertCalibration.digests.scopeFindings") }}
                </OToggleGroupItem>
                <OToggleGroupItem value="gaps" size="sm">{{
                  t("alertCalibration.digests.scopeGaps")
                }}</OToggleGroupItem>
              </OToggleGroup>
              <OSearchInput
                v-model="search"
                class="min-w-0 flex-1 max-md:min-w-40"
                :placeholder="t('alertCalibration.digests.searchPlaceholder')"
                :debounce="300"
                clearable
                data-test="alert-calibration-digests-search"
              />
            </div>
          </template>

          <template #toolbar-trailing>
            <OButton
              variant="outline"
              size="icon-sm"
              icon-left="refresh"
              :aria-label="t('alertCalibration.refresh')"
              :loading="runs.loading.value"
              data-test="alert-calibration-digests-refresh"
              @click="refresh"
            >
              <OTooltip side="bottom" :content="t('alertCalibration.refresh')" />
            </OButton>
          </template>

          <template #cell-window="{ row }">
            <span class="relative inline-flex min-w-0 items-baseline gap-2">
              <OTimeCell :value="row.window_end" unit="us" mode="absolute" />
              <span class="text-text-secondary truncate text-xs">
                {{ formatMinutes(t, windowMinutes(row)) }}
              </span>
              <OTooltip side="right" :content="formatAgo(row.emitted_at)" />
            </span>
          </template>

          <template #cell-findings="{ row }">
            <OBadge v-if="isClean(row)" variant="success-soft" size="sm" shape="rounded">
              {{ t("alertCalibration.digests.clean") }}
            </OBadge>
            <OBadge
              v-else-if="row.finding_count === 0"
              variant="default-soft"
              size="sm"
              shape="rounded"
            >
              {{ t("alertCalibration.digests.noneFound") }}
            </OBadge>
            <OBadge
              v-else
              variant="error-soft"
              size="sm"
              shape="rounded"
              :count="row.finding_count"
            >
              {{ t("alertCalibration.digests.findings") }}
            </OBadge>
          </template>

          <template #cell-coverage="{ row }">
            <span class="relative inline-flex">
              <OBadge
                :variant="COVERAGE_BADGE[coverageVerdict(row)].variant"
                size="sm"
                shape="rounded"
              >
                {{ t(COVERAGE_BADGE[coverageVerdict(row)].labelKey) }}
              </OBadge>
              <OTooltip v-if="coverageNotes(t, row).length" side="left" max-width="25rem">
                <template #content>
                  <span v-for="note in coverageNotes(t, row)" :key="note" class="block">{{
                    note
                  }}</span>
                </template>
              </OTooltip>
            </span>
          </template>

          <template #empty>
            <OEmptyState
              size="hero"
              illustration="history"
              :title="
                isFiltered
                  ? t('alertCalibration.digests.filteredTitle')
                  : t('alertCalibration.digests.emptyTitle', { days: RUNS_LOOKBACK_DAYS })
              "
              :description="
                isFiltered
                  ? t('alertCalibration.digests.filteredDescription')
                  : t('alertCalibration.digests.emptyDescription')
              "
              :filtered="isFiltered"
              hide-action
            />
          </template>

          <template #error="{ message }">
            <OEmptyState
              size="hero"
              illustration="broken-panel"
              variant="error"
              :title="t('alertCalibration.digests.errorTitle')"
              :description="raw(message)"
              :action-label="t('alertCalibration.retry')"
              action-icon="refresh"
              @action="refresh"
            />
          </template>

          <template v-if="capNotes.length" #footer-note>
            <div class="flex flex-col gap-0.5">
              <OText v-for="note in capNotes" :key="note" variant="meta" as="p">{{ note }}</OText>
            </div>
          </template>
        </OTable>
      </div>
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { formatDistanceToNowStrict } from "date-fns";
import { useQuery } from "@tanstack/vue-query";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { alertCalibrationConfigQuery } from "@/services/alert_calibration.queries";
import { useLeaveIfAlertCalibrationOff } from "@/composables/alertCalibration/useAlertCalibrationEnabled";
import AlertCalibrationTabs from "./AlertCalibrationTabs.vue";
import AlertCalibrationActions from "./AlertCalibrationActions.vue";
import AlertCalibrationLastRun from "./AlertCalibrationLastRun.vue";
import { useDigestSearch, useLatestRead } from "./useDigestSearch";
import {
  coverageNotes,
  coverageVerdict,
  isClean,
  latestPerWindow,
  latestRun,
  lookbackRange,
  runKey,
  RUNS_LOOKBACK_DAYS,
  SEARCH_SIZE,
  type RunRow,
} from "./digests";
import { COVERAGE_BADGE, formatMinutes, splitMinutes } from "./format";

type Scope = "all" | "findings" | "gaps";

const { t } = useI18nTyped();
useLeaveIfAlertCalibrationOff("alertList");
const router = useRouter();
const { search: searchDigests, orgId } = useDigestSearch();

const configQuery = useQuery(() => alertCalibrationConfigQuery(orgId.value));
const config = computed(() => configQuery.data.value ?? null);

const FINDINGS_COL = 120;
/** Room for "Measured nothing", the widest coverage badge. */
const COVERAGE_COL = 130;

const nowMicros = () => Date.now() * 1000;
const windowMinutes = (row: RunRow) => Math.round((row.window_end - row.window_start) / 60_000_000);
const formatAgo = (micros: number) =>
  raw(formatDistanceToNowStrict(micros / 1000, { addSuffix: true }));

const runs = useLatestRead(async () => {
  const emissions = await searchDigests<RunRow>("", lookbackRange(nowMicros()));
  return { emissions: emissions.length, rows: latestPerWindow(emissions) };
});
const rows = computed(() => runs.data.value?.rows ?? []);

const search = ref("");
const scope = ref<Scope>("all");
const matching = useLatestRead(async () => {
  const name = search.value.trim();
  if (!name) return null;
  const hits = await searchDigests<RunRow>("/alerts", {
    alert_name: name,
    ...lookbackRange(nowMicros()),
  });
  return new Set(hits.map(runKey));
});

const isFiltered = computed(() => !!search.value.trim() || scope.value !== "all");

const filtered = computed(() =>
  rows.value.filter((row) => {
    if (scope.value === "findings" && row.finding_count === 0) return false;
    if (scope.value === "gaps" && !row.coverage_gap) return false;
    const names = matching.data.value;
    return !search.value.trim() || !names || names.has(runKey(row));
  }),
);

const latest = computed(() => latestRun(rows.value));

const stats = computed<StatItem[]>(() => {
  const c = config.value;
  const run = latest.value;
  const cadence = splitMinutes(t, c?.frequency_minutes ?? 0);
  const window = splitMinutes(t, c?.window_minutes ?? 0);
  return [
    {
      key: "latest",
      label: t("alertCalibration.digests.latestFindings"),
      value: run ? run.finding_count : raw("—"),
      sub: run ? t(COVERAGE_BADGE[coverageVerdict(run)].labelKey) : undefined,
      icon: "fact-check",
      tone: run && run.finding_count > 0 ? "warning" : "neutral",
    },
    {
      key: "window",
      label: t("alertCalibration.digests.window"),
      value: c ? window.count : raw("—"),
      sub: c ? window.unit : t("alertCalibration.digests.notConfigured"),
      icon: "calendar-month",
    },
    {
      key: "schedule",
      label: t("alertCalibration.digests.schedule"),
      value: c ? (c.enabled ? cadence.count : t("alertCalibration.digests.off")) : raw("—"),
      sub: c
        ? c.enabled
          ? cadence.unit
          : t("alertCalibration.digests.noScheduledRun")
        : t("alertCalibration.digests.notConfigured"),
      icon: "schedule",
      tone: c?.enabled ? "success" : "neutral",
    },
  ];
});

/** A search that fills its page may have left rows behind, so it says so instead of paging. */
const capNotes = computed<I18nText[]>(() => {
  const notes: I18nText[] = [];
  if (runs.data.value?.emissions === SEARCH_SIZE) {
    notes.push(t("alertCalibration.digests.runsCapped", { count: SEARCH_SIZE }));
  }
  if (matching.data.value?.size === SEARCH_SIZE) {
    notes.push(t("alertCalibration.digests.searchCapped", { count: SEARCH_SIZE }));
  }
  return notes;
});

const columns = computed<OTableColumnDef<RunRow>[]>(() => [
  {
    id: "window",
    header: t("alertCalibration.digests.colRun"),
    accessorFn: (row) => row.window_end,
    sortable: true,
    // The slack goes to the run, so the badge columns keep their width.
    meta: { align: "left", isName: true, autoWidth: true, fillRemaining: true },
  },
  {
    id: "findings",
    header: t("alertCalibration.digests.colFindings"),
    accessorKey: "finding_count",
    sortable: true,
    size: FINDINGS_COL,
    maxSize: FINDINGS_COL,
    meta: { align: "left" },
  },
  {
    id: "coverage",
    header: t("alertCalibration.digests.colCoverage"),
    accessorFn: (row) => coverageVerdict(row),
    sortable: true,
    size: COVERAGE_COL,
    maxSize: COVERAGE_COL,
    meta: { align: "left" },
  },
]);

const onScope = (value: unknown) => {
  if (value) scope.value = value as Scope;
};

const open = (row: RunRow) =>
  router.push({
    name: "alertCalibrationDigest",
    params: { windowStart: String(row.window_start), windowEnd: String(row.window_end) },
    query: { org_identifier: orgId.value },
  });

/** A refresh reaches the server for everything the view shows. */
function refresh() {
  void configQuery.refetch();
  void runs.load();
  void matching.load();
}

watch(search, () => void matching.load());
onMounted(() => void runs.load());
</script>
