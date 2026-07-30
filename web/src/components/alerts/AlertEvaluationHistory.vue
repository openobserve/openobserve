<!-- Copyright 2026 OpenObserve Inc.
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
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  Per-EVALUATION history for one alert — one row per scheduled run, sourced
  from the triggers/usage stream via GET /api/v2/{org}/alerts/history (D8),
  the same endpoint the org-wide history page and the overview drawer use.

  This is the complement of AlertGroupHistory, not a replacement: the
  transitions table is write-on-change, so an alert that has been Critical
  for an hour has ONE transition but sixty evaluations. Operators asking
  "did it actually run every minute, and what did it measure?" need this
  view; "when did it change level?" is the transitions view.
-->
<template>
  <OTable
    :data="rows"
    :columns="columns"
    row-key="rowKey"
    pagination="server"
    v-model:current-page="currentPage"
    v-model:page-size="pageSize"
    :total-count="totalCount"
    :loading="loading"
    :frame="false"
    :show-global-filter="false"
    :persist-columns="true"
    table-id="alert-evaluation-history"
    :enable-column-resize="true"
    class="h-full min-h-0"
    data-test="alerts-alertevaluationhistory-table"
    @pagination-change="onPaginationChange"
  >
    <template #toolbar>
      <OToggleGroup
        :model-value="range"
        data-test="alerts-alertevaluationhistory-range"
        @update:model-value="onRangeChange"
      >
        <OToggleGroupItem
          v-for="option in rangeOptions"
          :key="option.value"
          :value="option.value"
          size="sm"
        >
          {{ option.label }}
        </OToggleGroupItem>
      </OToggleGroup>
    </template>

    <template #toolbar-trailing>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        data-test="alerts-alertevaluationhistory-refresh"
        @click="fetchHistory"
      >
        <OTooltip side="bottom" :content="t('alerts.groups.refresh')" />
      </OButton>
    </template>

    <template #cell-timestamp="{ row }">
      <OTimeCell
        :value="row.timestamp"
        unit="us"
        mode="relative"
        :timezone="store.state.timezone"
      />
    </template>

    <template #cell-status="{ row }">
      <span class="inline-flex">
        <OTag
          type="alertState"
          :value="row.status"
          size="sm"
          data-test="alerts-alertevaluationhistory-status"
        />
        <OTooltip v-if="row.error" :content="row.error" />
      </span>
    </template>

    <!-- T-10 value context: what was observed, against what, and the level it
         classified to. Rows written before those fields existed render "—". -->
    <template #cell-condition="{ row }">
      <div class="flex min-w-0 items-center gap-1.5">
        <span class="text-compact font-mono whitespace-nowrap tabular-nums">
          {{ conditionSummary(row) }}
        </span>
        <template v-if="row.level">
          <span class="text-2xs text-text-secondary shrink-0">→</span>
          <OTag type="alertLevel" :value="row.level" size="sm" class="shrink-0" />
        </template>
      </div>
    </template>

    <template #cell-evaluation_time="{ row }">
      <span class="text-compact tabular-nums">
        {{
          row.evaluation_took_in_secs != null ? row.evaluation_took_in_secs.toFixed(3) + "s" : "—"
        }}
      </span>
    </template>

    <template #cell-query_time="{ row }">
      <span class="text-compact tabular-nums">
        {{ row.query_took != null ? row.query_took + "ms" : "—" }}
      </span>
    </template>

    <template #cell-error="{ row }">
      <span class="text-compact">{{ row.error || "—" }}</span>
    </template>

    <template #empty>
      <OEmptyState
        v-if="!loading"
        size="hero"
        :title="t('alerts.groups.noEvaluationsTitle')"
        :description="t('alerts.groups.noEvaluationsDescription')"
        data-test="alerts-alertevaluationhistory-empty"
      />
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import alertsService from "@/services/alerts";
import { conditionSummary } from "@/utils/alerts/runOutcome";

const props = defineProps<{ alertId: string }>();

const { t } = useI18n();
const store = useStore();

const history = ref<any[]>([]);
const loading = ref(false);
const totalCount = ref(0);
const currentPage = ref(1);
const pageSize = ref(25);

// Same range vocabulary as the evaluation chart above this table, so the two
// answer for the same window by default.
const range = ref<string>("1h");
const rangeOptions = computed(() => [
  { value: "1h", label: t("alerts.groups.range1h") },
  { value: "6h", label: t("alerts.groups.range6h") },
  { value: "24h", label: t("alerts.groups.range24h") },
]);
const RANGE_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

// Newest first within the fetched page — the endpoint pages but does not
// promise an order this view can rely on.
const rows = computed(() =>
  [...history.value]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .map((row, index) => ({ ...row, rowKey: `${row.timestamp}-${index}` })),
);

const fetchHistory = async () => {
  const orgId = store.state.selectedOrganization?.identifier;
  if (!orgId || !props.alertId) return;
  loading.value = true;
  try {
    const endTime = Date.now() * 1000;
    const startTime = endTime - (RANGE_MS[range.value] ?? RANGE_MS["1h"]) * 1000;
    const res = await alertsService.getHistory(orgId, {
      alert_id: props.alertId,
      start_time: startTime,
      end_time: endTime,
      from: (currentPage.value - 1) * pageSize.value,
      size: pageSize.value,
    });
    history.value = res.data?.hits || [];
    totalCount.value = res.data?.total || 0;
  } catch {
    history.value = [];
    totalCount.value = 0;
  } finally {
    loading.value = false;
  }
};

const onRangeChange = (value: unknown) => {
  if (!value) return;
  range.value = String(value);
  currentPage.value = 1;
  fetchHistory();
};

const onPaginationChange = (params: { page: number; size: number }) => {
  currentPage.value = params.page;
  pageSize.value = params.size;
  fetchHistory();
};

watch(
  () => props.alertId,
  () => {
    currentPage.value = 1;
    fetchHistory();
  },
);

onMounted(fetchHistory);

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "timestamp",
    accessorKey: "timestamp",
    header: t("alerts.historyTable.timestamp"),
    cell: " ",
    size: 150,
    resizable: true,
    meta: { align: "left" },
  },
  {
    id: "status",
    accessorKey: "status",
    header: t("alerts.historyTable.status"),
    cell: " ",
    size: 140,
    resizable: true,
    meta: { align: "left" },
  },
  {
    id: "condition",
    accessorKey: "actual_value",
    header: t("alerts.historyTable.condition"),
    cell: " ",
    resizable: true,
    meta: { align: "left", flex: true },
  },
  {
    id: "evaluation_time",
    accessorKey: "evaluation_took_in_secs",
    header: t("alerts.historyTable.evaluationTime"),
    cell: " ",
    size: 140,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "query_time",
    accessorKey: "query_took",
    header: t("alerts.historyTable.queryTime"),
    cell: " ",
    size: 120,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "error",
    accessorKey: "error",
    header: t("alerts.historyTable.error"),
    cell: " ",
    size: 220,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
]);
</script>
