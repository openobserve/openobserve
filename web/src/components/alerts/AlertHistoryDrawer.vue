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
  <ODrawer data-test="alert-history-drawer"
    bleed
    :open="open"
    :width="65"
    :title="alertDetails?.name"
    :title-data-test="'alert-history-name-badge'"
    :sub-title="t('alert_list.alert_history')"
    @update:open="emit('update:open', $event)"
  >
    <!-- The alert name is the drawer title and "History" its subtitle (matching
         the other detail headers); the type badge + History/Condition toggle
         trail in header-left, the datetime picker sits in header-right. -->
    <template #header-left>
          <div
            class="flex items-center gap-2 flex-1 min-w-0"
            data-test="alert-details-title"
          >
            <!-- Alert Type Badge -->
            <div
              v-if="alertDetails"
              :class="[
                'flex items-center gap-1 px-2 py-1 rounded-default border shrink-0',
                'bg-surface-subtle border-border-default',
              ]"
            >
              <OIcon
                :name="
                  isAnomaly
                    ? 'query-stats'
                    : alertDetails.is-real-time
                      ? 'bolt'
                      : 'schedule'
                "
                size="sm"
                class="opacity-70"
              />
              <span
                :class="[
                  'text-xs font-semibold',
                  'text-text-body',
                ]"
              >
                {{
                  isAnomaly
                    ? "Anomaly Detection"
                    : alertDetails.is_real_time
                      ? "Real-time"
                      : "Scheduled"
                }}
              </span>
            </div>
            <!-- Tab toggle -->
            <OToggleGroup
              class="shrink-0"
              :model-value="activeTab"
              @update:model-value="activeTab = $event as string"
            >
              <OToggleGroupItem
                value="history"
                size="sm"
                data-test="alert-history-tab-history"
              >
                <template #icon-left>
                  <OIcon name="history" size="sm" />
                </template>
                History
              </OToggleGroupItem>
              <OToggleGroupItem
                value="condition"
                size="sm"
                data-test="alert-history-tab-condition"
              >
                <template #icon-left>
                  <OIcon name="code" size="sm" />
                </template>
                Condition
              </OToggleGroupItem>
            </OToggleGroup>
          </div>
    </template>
    <template #header-right>
      <div class="col-auto flex items-center gap-1">
        <DateTime
          :class="activeTab !== 'history' ? 'invisible' : ''"
          ref="dateTimeRef"
          auto-apply
          :default-type="dateTimeType"
          :default-absolute-time="{
            startTime: absoluteTime.startTime,
            endTime: absoluteTime.endTime,
          }"
          :default-relative-time="relativeTime"
          data-test="alert-history-drawer-date-picker"
          @on:date-change="updateDateTime"
        />
      </div>
    </template>

    <!-- Content -->
    <div class="flex flex-col h-full min-h-0" v-if="alertDetails">
      <!-- Tab Panels -->
      <OTabPanels
        v-model="activeTab"
        animated
        class="flex-1 overflow-hidden bg-transparent flex flex-col"
      >
        <!-- History Panel -->
        <OTabPanel
          name="history"
          layout="flex-col"
          stretch
          class="flex-1"
        >
          <div
            class="flex h-full flex-col flex-1 overflow-hidden px-2 py-2"
          >
            <!-- Empty state -->
            <OEmptyState
              v-if="!isLoadingHistory && alertHistory.length === 0"
              size="block"
              illustration="history"
              :title="t('alerts.alertDetails.noHistoryAvailable')"
              :description="t('alerts.alertDetails.tryExpandingTimeRange')"
              :hide-action="true"
              class="flex-1"
            />

            <!-- History Table -->
            <div
              v-else
              class="flex flex-col flex-1 overflow-hidden gap-2"
            >
              <!-- Firing frequency timeline -->
              <AlertHistoryTimeline
                v-if="alertHistory.length > 0"
                :history="alertHistory"
              />

              <div
                class="rounded-default overflow-hidden border flex flex-col flex-1"
                :class="
                  'border-border-default bg-surface-base'
                "
              >
                <OTable
                  :data="groupedHistory"
                  :columns="historyTableColumns"
                  row-key="timestamp"
                  pagination="server"
                  v-model:current-page="currentPage"
                  v-model:page-size="selectedPerPage"
                  :total-count="resultTotal"
                  :loading="isLoadingHistory"
                  :row-class="getRowClass"
                  :default-columns="false"
                  :show-global-filter="false"
                  class="history-table flex-1 overflow-hidden !border-0 !shadow-none"
                  data-test="alert-details-history-table"
                  @pagination-change="onPaginationChange"
                >
                  <template #[`cell-#`]="{ row }">
                    <span
                      class="text-compact tabular-nums"
                      :class="'text-text-secondary'"
                    >
                      {{ row._displayIndex ?? '—' }}
                    </span>
                  </template>

                  <template #cell-status="{ row }">
                    <!-- Flapping group row -->
                    <div v-if="row._flappingGroup" class="flex items-center gap-1.5">
                      <OIcon
                        :name="expandedGroups.has(row.timestamp) ? 'expand-less' : 'expand-more'"
                        size="sm"
                        class="cursor-pointer opacity-50 shrink-0"
                        @click="toggleFlappingGroup(row.timestamp)"
                      />
                      <OTag type="alertState" value="flapping" class="cursor-pointer shrink-0" @click="toggleFlappingGroup(row.timestamp)" />
                      <span class="text-2xs truncate text-text-secondary">
                        {{ row._children.length }} rows · {{ row._duration }}
                      </span>
                    </div>
                    <!-- Normal row -->
                    <span v-else class="inline-flex cursor-default">
                      <OTag
                        type="alertState"
                        :value="row.status"
                        data-test="alert-history-status-chip"
                      />
                      <OTooltip v-if="row.error" :max-width="'300px'" :content="row.error" />
                    </span>
                  </template>

                  <template #cell-timestamp="{ row }">
                    <span class="text-compact tabular-nums whitespace-nowrap" :class="row._child ? 'pl-5 opacity-70' : ''">
                      {{ formatTimestampFull(row.timestamp) }}
                    </span>
                  </template>

                  <template #cell-evaluation_time="{ row }">
                    <span class="text-compact tabular-nums">
                      {{ row.evaluation_took_in_secs ? row.evaluation_took_in_secs.toFixed(3) + "s" : "—" }}
                    </span>
                  </template>

                  <template #cell-query_time="{ row }">
                    <span class="text-compact tabular-nums">
                      {{ row.query_took ? row.query_took + "ms" : "—" }}
                    </span>
                  </template>

                  <template #cell-anomaly_count="{ row }">
                    <span
                      class="text-compact tabular-nums"
                      :class="row.anomaly_count > 0 ? 'text-status-error-text font-medium' : ''"
                    >
                      {{ row.anomaly_count != null ? row.anomaly_count : "—" }}
                    </span>
                  </template>

                  <template #cell-error="{ row }">
                    <span class="text-compact">{{ row.error || "—" }}</span>
                  </template>

                  <template #bottom>
                    <div class="flex items-center w-full h-12">
                      <div class="text-xs font-normal flex items-center w-55">
                        {{ resultTotal }} {{ t("alerts.alertDetails.results") }}
                      </div>
                    </div>
                  </template>
                </OTable>
              </div>
            </div>
          </div>
        </OTabPanel>

        <!-- Condition Panel -->
        <OTabPanel
          name="condition"
          layout="flex-col"
          stretch
          class="flex-1"
        >
          <div
            class="flex flex-col flex-1 overflow-hidden px-2 py-2"
          >
            <!-- Anomaly detection condition view — mirrors the alert SQL code block -->
            <template v-if="isAnomaly">
              <div
                class="rounded-default overflow-hidden border flex flex-col flex-1"
                :class="
                  'border-border-default bg-surface-panel'
                "
              >
                <div
                  class="flex items-center justify-between py-1.5 px-2.5 border-b shrink-0"
                  :class="
                    'bg-surface-subtle border-border-default'
                  "
                >
                  <div class="flex items-center gap-1.5">
                    <span
                      class="text-2xs font-medium"
                      :class="
                        'text-text-secondary'
                      "
                    >
                      SQL
                    </span>
                  </div>
                  <OButton
                    v-if="anomalySql"
                    @click="copyToClipboard(anomalySql, { successMessage: 'SQL Copied Successfully!', timeout: 3000 })"
                    variant="ghost-muted"
                    size="icon-xs-sq"
                    data-test="anomaly-details-copy-sql-btn"
                  >
                    <OIcon name="content-copy" size="sm" />
                    <OTooltip :content="t('alerts.alertDetails.copy')" />
                  </OButton>
                </div>
                <pre
                  class="p-[10px_14px] font-mono whitespace-pre-wrap overflow-x-auto text-compact m-0 leading-relaxed flex-1 overflow-y-auto"
                  >{{ anomalySql || t("alerts.alertDetails.noCondition") }}</pre
                >
              </div>
            </template>

            <!-- Regular alert condition view -->
            <template v-else>
              <div
                class="rounded-default overflow-hidden border flex flex-col flex-1"
                :class="
                  'border-border-default bg-surface-panel'
                "
              >
                <!-- Code block header bar — stays fixed -->
                <div
                  class="flex items-center justify-between py-1.5 px-2.5 border-b shrink-0"
                  :class="
                    'bg-surface-subtle border-border-default'
                  "
                >
                  <div class="flex items-center gap-1.5">
                    <span
                      class="text-2xs font-medium"
                      :class="
                        'text-text-secondary'
                      "
                    >
                      {{
                        alertDetails.type === "sql"
                          ? "SQL"
                          : alertDetails.type === "promql"
                            ? "PromQL"
                            : "Conditions"
                      }}
                    </span>
                  </div>
                  <OButton
                    v-if="
                      alertDetails.conditions &&
                      alertDetails.conditions !== '' &&
                      alertDetails.conditions !== '--'
                    "
                    @click="
                      copyToClipboard(
                        alertDetails.conditions,
                        {
                          successMessage: (alertDetails.type === 'sql'
                            ? t('alerts.alertDetails.sqlQuery')
                            : alertDetails.type === 'promql'
                              ? t('alerts.alertDetails.promqlQuery')
                              : t('alerts.alertDetails.conditions')) + ' Copied Successfully!',
                        },
                      )
                    "
                    variant="ghost-muted"
                    size="icon-xs-sq"
                    data-test="alert-details-copy-conditions-btn"
                  >
                    <OIcon name="content-copy" size="sm" />
                    <OTooltip :content="t('alerts.alertDetails.copy')" />
                  </OButton>
                </div>
                <!-- Code content — scrolls internally -->
                <pre
                  class="p-[10px_14px] font-mono whitespace-pre-wrap overflow-x-auto text-compact m-0 leading-relaxed flex-1 overflow-y-auto"
                  >{{
                    alertDetails.conditions !== "" &&
                    alertDetails.conditions !== "--"
                      ? alertDetails.type === "sql" ||
                        alertDetails.type === "promql"
                        ? alertDetails.conditions
                        : alertDetails.conditions.length !== 2
                          ? `if ${alertDetails.conditions}`
                          : t("alerts.alertDetails.noCondition")
                      : t("alerts.alertDetails.noCondition")
                  }}</pre
                >
              </div>
            </template>

            <!-- Description (only show if exists) -->
            <div v-if="alertDetails.description" class="mt-3 shrink-0">
              <div
                class="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-1"
                :class="
                  'text-text-secondary'
                "
              >
                <OIcon name="info-outline" size="xs" />
                {{ t("common.description") }}
              </div>
              <div
                class="text-compact px-3 py-2 rounded-default leading-relaxed"
                :class="
                  'bg-surface-panel text-text-body'
                "
              >
                {{ alertDetails.description }}
              </div>
            </div>
          </div>
        </OTabPanel>
      </OTabPanels>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import OTabPanels from "@/lib/navigation/Tabs/OTabPanels.vue";
import OTabPanel from "@/lib/navigation/Tabs/OTabPanel.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import { ref, watch, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { formatToTimeCompact, formatTimestamp } from "@/utils/date";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import DateTime from "@/components/DateTime.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import alertsService from "@/services/alerts";
import anomalyDetectionService from "@/services/anomaly_detection";
import { buildAnomalyPreviewSql } from "@/utils/alerts/anomalySqlBuilder";
import type { Ref } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import { copyToClipboard } from "@/utils/clipboard";
import AlertHistoryTimeline from "./AlertHistoryTimeline.vue";

// Composables
const { t } = useI18n();
const store = useStore();

// Props & Emits
interface Props {
  alertDetails: any;
  alertId: string;
  alertType?: string;
  open?: boolean;
}

const props = defineProps<Props>();

const isAnomaly = computed(() => props.alertType === "anomaly_detection");

// Full config fetched from the dedicated anomaly detection endpoint.
// The list API only returns summary fields; we need this for the Condition tab.
const fullAnomalyConfig = ref<any>(null);

const anomalySql = computed(() => {
  const d = fullAnomalyConfig.value || props.alertDetails;
  if (!d) return "";
  return buildAnomalyPreviewSql(d);
});

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const resultTotal = ref(0);

// Tabs
const activeTab = ref("history");

// Refs
const alertHistory: Ref<any[]> = ref([]);
const isLoadingHistory = ref(false);

// ── Flapping group helpers ──────────────────────────────────────────────────
const MIN_FLAP_TRANSITIONS = 3; // firing↔ok flips within a run to call it flapping
const MIN_FLAP_WINDOW = 4;      // minimum consecutive rows needed

function rowIsFiring(s: string) {
  const v = s?.toLowerCase();
  return v === "firing" || v === "error" || v === "anomaly" || v === "completed";
}
function rowIsOk(s: string) {
  const v = s?.toLowerCase();
  return v === "ok" || v === "success" || v === "normal" || v === "condition_not_satisfied";
}

// Build a boolean mask: true = row is inside a flapping run.
// Strategy:
//  1. Scan forward to find the first window of MIN_FLAP_WINDOW rows that
//     contains >= MIN_FLAP_TRANSITIONS firing↔ok flips — this is a zone start.
//  2. Once inside a zone, keep extending as long as each new row causes a
//     flip relative to the previous non-skipped state.
//  3. Stop extending when we see MAX_STABLE_TAIL consecutive rows with no
//     flip, then trim those trailing stable rows off the end of the zone.
function buildFlappingMask(rows: any[]): boolean[] {
  const n = rows.length;
  const mask = new Array(n).fill(false);
  const MAX_STABLE_TAIL = 2; // consecutive non-flipping rows that end a zone

  function stateOf(s: string): "firing" | "ok" | "other" {
    if (rowIsFiring(s)) return "firing";
    if (rowIsOk(s))    return "ok";
    return "other";
  }

  let i = 0;
  while (i < n) {
    // Count transitions in the next MIN_FLAP_WINDOW rows
    let transitions = 0;
    let prev = stateOf(rows[i].status);
    let windowEnd = -1;
    for (let j = i + 1; j < Math.min(i + MIN_FLAP_WINDOW + 10, n); j++) {
      const cur = stateOf(rows[j].status);
      if (cur !== "other" && prev !== "other" && cur !== prev) transitions++;
      if (cur !== "other") prev = cur;
      if (transitions >= MIN_FLAP_TRANSITIONS) { windowEnd = j; break; }
    }

    if (windowEnd === -1) { i++; continue; } // no flapping here

    // Found a flapping zone starting at i — now extend it forward
    let zoneEnd = windowEnd;
    let stableTail = 0;
    let lastState = stateOf(rows[zoneEnd].status);

    for (let j = zoneEnd + 1; j < n; j++) {
      const cur = stateOf(rows[j].status);
      if (cur === "other") { zoneEnd = j; stableTail = 0; continue; }
      if (cur !== lastState) {
        // flip — still flapping
        lastState = cur;
        zoneEnd = j;
        stableTail = 0;
      } else {
        // same state — stable tail growing
        stableTail++;
        if (stableTail >= MAX_STABLE_TAIL) break;
        zoneEnd = j;
      }
    }

    // Trim stable tail off the end
    while (zoneEnd > windowEnd && stateOf(rows[zoneEnd].status) === stateOf(rows[zoneEnd - 1].status)) {
      zoneEnd--;
    }

    for (let k = i; k <= zoneEnd; k++) mask[k] = true;
    i = zoneEnd + 1; // skip past this zone
  }
  return mask;
}

function durationLabel(startTs: number, endTs: number): string {
  // timestamps are in microseconds — convert to ms
  const startMs = startTs > 1e12 ? startTs / 1000 : startTs;
  const endMs   = endTs   > 1e12 ? endTs   / 1000 : endTs;
  const ms = Math.abs(endMs - startMs);
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Tracks which flapping group rows are expanded (key = group timestamp)
const expandedGroups = ref<Set<number>>(new Set());

function toggleFlappingGroup(ts: number) {
  const s = new Set(expandedGroups.value);
  s.has(ts) ? s.delete(ts) : s.add(ts);
  expandedGroups.value = s;
}

// Produce the display list: normal rows pass through, flapping runs become one
// header row (+ children shown when expanded)
const groupedHistory = computed(() => {
  const rows = [...alertHistory.value].sort((a, b) => b.timestamp - a.timestamp); // newest first for table
  if (!rows.length) return rows;

  // mask is on sorted-asc; re-sort for mask then flip back
  const asc = [...rows].sort((a, b) => a.timestamp - b.timestamp);
  const mask = buildFlappingMask(asc);
  // map back to desc order by timestamp
  const maskByTs = new Map(asc.map((r, i) => [r.timestamp, mask[i]]));

  const result: any[] = [];
  let i = 0;
  let displayNum = (currentPage.value - 1) * selectedPerPage.value + 1;
  while (i < rows.length) {
    const row = rows[i];
    if (!maskByTs.get(row.timestamp)) {
      result.push({ ...row, _displayIndex: displayNum++ });
      i++;
    } else {
      // collect all consecutive flapping rows
      const children: any[] = [];
      while (i < rows.length && maskByTs.get(rows[i].timestamp)) {
        children.push(rows[i]);
        i++;
      }
      const timestamps = children.map((r) => r.timestamp);
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      const groupTs = maxTs;
      result.push({
        timestamp: groupTs,
        status: "flapping",
        _flappingGroup: true,
        _children: children,
        _duration: durationLabel(minTs, maxTs),
        _displayIndex: null,
      });
      displayNum += children.length;
      if (expandedGroups.value.has(groupTs)) {
        children.forEach((c, ci) =>
          result.push({ ...c, _child: true, _displayIndex: displayNum - children.length + ci }),
        );
      }
    }
  }
  return result;
});

// Date time - default to last 15 minutes (relative)
const dateTimeRef = ref<any>(null);
const dateTimeType = ref("relative");
const relativeTime = ref("15m");
const _now = Date.now();
const _fifteenMinutesAgo = _now - 15 * 60 * 1000;
const absoluteTime = ref({
  startTime: _fifteenMinutesAgo * 1000, // microseconds
  endTime: _now * 1000, // microseconds
});
const dateTimeValues = ref({
  startTime: _fifteenMinutesAgo * 1000,
  endTime: _now * 1000,
  type: "relative",
  relativeTimePeriod: "15m",
});

// Pagination (server-side)
const selectedPerPage = ref<number>(50);
const currentPage = ref<number>(1);

const onPaginationChange = async (params: { page: number; size: number }) => {
  currentPage.value = params.page;
  selectedPerPage.value = params.size;
  isLoadingHistory.value = true;
  await fetchAlertHistory(props.alertId);
  isLoadingHistory.value = false;
};

// Columns
const alertHistoryColumns = [
  {
    id: "#",
    header: "#",
    accessorFn: () => null,
    sortable: false,
    size: 48,
    meta: { align: "left" as const },
  },
  {
    id: "timestamp",
    header: t("alerts.historyTable.timestamp"),
    accessorKey: "timestamp",
    sortable: true,
    size: 140,
    meta: { align: "left" as const },
  },
  {
    id: "status",
    header: t("alerts.historyTable.status"),
    accessorKey: "status",
    sortable: true,
    size: 280,
    meta: { align: "left" as const },
  },
  {
    id: "evaluation_time",
    header: t("alerts.historyTable.evaluationTime"),
    accessorKey: "evaluation_took_in_secs",
    sortable: true,
    size: 140,
    meta: { align: "left" as const },
  },
  {
    id: "query_time",
    header: t("alerts.historyTable.queryTime"),
    accessorKey: "query_took",
    sortable: true,
    size: 100,
    meta: { align: "left" as const },
  },
  {
    id: "error",
    header: t("alerts.historyTable.error"),
    accessorKey: "true",
    sortable: false,
    size: COL.description,
    meta: { align: "left" as const, autoWidth: true },
  },
];

const anomalyHistoryColumns = [
  {
    id: "#",
    header: "#",
    accessorFn: () => null,
    sortable: false,
    size: 48,
    meta: { align: "left" as const },
  },
  {
    id: "timestamp",
    header: t("alerts.historyTable.timestamp"),
    accessorKey: "timestamp",
    sortable: false,
    size: 140,
    meta: { align: "left" as const },
  },
  {
    id: "status",
    header: "Result",
    accessorKey: "status",
    sortable: false,
    size: 120,
    meta: { align: "left" as const },
  },
  {
    id: "evaluation_time",
    header: t("alerts.historyTable.evaluationTime"),
    accessorKey: "evaluation_took_in_secs",
    sortable: false,
    size: 130,
    meta: { align: "right" as const },
  },
  {
    id: "anomaly_count",
    header: "Anomalies",
    accessorKey: "anomaly_count",
    sortable: false,
    size: 120,
    meta: { align: "right" as const },
  },
];

const historyTableColumns = computed(() =>
  isAnomaly.value ? anomalyHistoryColumns : alertHistoryColumns,
);

// Helper Functions

const getRowClass = (row: any) => {
  if (row?._flappingGroup) {
    // Violet-tinted highlight for flapping-group rows; token carries the theme.
    return "!bg-[color-mix(in_srgb,var(--color-sql-accent)_8%,var(--color-surface-base))]";
  }
  if (row?._child) {
    return "!bg-surface-subtle";
  }
  const status = row?.status?.toLowerCase();
  const isFiringStatus = status === "firing" || status === "error" || status === "anomaly" || status === "completed";
  if (isFiringStatus) {
    return "!bg-status-error-bg";
  }
  return "";
};

const formatTimestamp = (timestamp: number) => {
  if (!timestamp) return "N/A";
  const now = Date.now() * 1000; // microseconds
  const diff = now - timestamp;

  if (diff < 3600000000) {
    const minutes = Math.floor(diff / 60000000);
    return `${minutes} min ago`;
  }
  if (diff < 86400000000) {
    const hours = Math.floor(diff / 3600000000);
    return `${hours}h ago`;
  }
  if (diff < 604800000000) {
    const days = Math.floor(diff / 86400000000);
    return `${days}d ago`;
  }
  return formatToTimeCompact(timestamp);
};

const formatTimestampFull = (timestamp: number) => {
  if (!timestamp) return "N/A";
  return formatTimestamp(timestamp, "MMM DD, YYYY HH:mm:ss");
};

// Main Functions
const fetchAlertHistory = async (alertId: string) => {
  if (!alertId) return;

  try {
    const startTime = dateTimeValues.value.startTime;
    const endTime = dateTimeValues.value.endTime;
    const from = (currentPage.value - 1) * selectedPerPage.value;

    const historyParams: Record<string, any> = {
      size: selectedPerPage.value,
      from: from,
      start_time: startTime,
      end_time: endTime,
    };
    if (isAnomaly.value) {
      historyParams.anomaly_id = alertId;
    } else {
      historyParams.alert_id = alertId;
    }
    const response = await alertsService.getHistory(
      store?.state?.selectedOrganization?.identifier,
      historyParams,
    );
    alertHistory.value = response.data?.hits || [];
    resultTotal.value = response.data?.total || 0;
  } catch (error: any) {
    alertHistory.value = [];
    resultTotal.value = 0;
    toast({
      variant: "error",
      message:
        error.response?.data?.message ||
        error.message ||
        t("alerts.failedToFetchHistory"),
      timeout: 5000,
    });
  }
};

const updateDateTime = (value: any) => {
  dateTimeValues.value = {
    startTime: value.startTime,
    endTime: value.endTime,
    type: value.relativeTimePeriod ? "relative" : "absolute",
    relativeTimePeriod: value.relativeTimePeriod || "",
  };

  if (value.relativeTimePeriod) {
    dateTimeType.value = "relative";
    relativeTime.value = value.relativeTimePeriod;
  } else {
    dateTimeType.value = "absolute";
    absoluteTime.value = {
      startTime: value.startTime,
      endTime: value.endTime,
    };
  }

  currentPage.value = 1;
  if (props.alertId) {
    isLoadingHistory.value = true;
    fetchAlertHistory(props.alertId).finally(() => {
      isLoadingHistory.value = false;
    });
  }
};

// Watchers
watch(
  () => props.alertId,
  async (newVal) => {
    if (newVal) {
      currentPage.value = 1;
      isLoadingHistory.value = true;
      await fetchAlertHistory(newVal);
      isLoadingHistory.value = false;
      // Fetch full config for the Condition tab when this is an anomaly detection alert.
      if (isAnomaly.value) {
        try {
          const org = store?.state?.selectedOrganization?.identifier;
          const res = await anomalyDetectionService.getConfig(org, newVal);
          fullAnomalyConfig.value = res.data;
        } catch {
          fullAnomalyConfig.value = null;
        }
      } else {
        fullAnomalyConfig.value = null;
      }
    }
  },
  { immediate: true },
);
</script>
