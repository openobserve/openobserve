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
    data-test="alert-history-page"
    :title="t('alerts.history')"
    title-data-test="alerts-history-title"
    :back="{ label: t('alerts.header'), onClick: goBack, dataTest: 'alert-history-back-btn' }"
    bleed
  >
    <template #actions>
      <DateTime
        ref="dateTimeRef"
        auto-apply
        :default-type="dateTimeType"
        :default-absolute-time="{
          startTime: absoluteTime.startTime,
          endTime: absoluteTime.endTime,
        }"
        :default-relative-time="relativeTime"
        data-test="alert-history-date-picker"
        @on:date-change="updateDateTime"
      />
      <OSelect
        v-model="selectedAlert"
        :options="filteredAlertOptions"
        labelKey="label"
        valueKey="value"
        @update:model-value="onAlertSelected"
        :placeholder="t('alerts.searcHistory')"
        data-test="alert-history-search-select"
        class="o2-search-input max-w-62.5 min-w-62.5 max-lg:hidden"
        clearable
        @clear="clearSearch"
      >
        <template #icon-left>
          <OIcon class="o2-search-input-icon" name="search" size="sm" />
        </template>
        <template #empty>
          <div class="text-muted-foreground px-3 py-2">
            {{ t("alerts.noAlertsFound") }}
          </div>
        </template>
      </OSelect>
      <OButton
        variant="ghost"
        icon-left="search"
        size="icon-sm"
        class="max-lg:hidden"
        @click="manualSearch"
        data-test="alert-history-manual-search-btn"
        :disabled="loading"
      >
        <OTooltip :content="t('common.search')" />
      </OButton>
      <ORefreshButton
        layout="inline"
        variant="outline"
        class="shrink-0"
        :last-run-at="shownAt"
        :failed-at="refreshFailure?.failedAt"
        :data-from="refreshFailure?.dataFrom"
        :loading="fetching"
        data-test="alert-history-refresh-btn"
        @click="onRefreshClick"
      />
    </template>
    <div
      class="border-border-default flex shrink-0 items-center gap-1 border-b px-3 py-1.5 lg:hidden"
    >
      <OSelect
        v-model="selectedAlert"
        :options="filteredAlertOptions"
        labelKey="label"
        valueKey="value"
        @update:model-value="onAlertSelected"
        :placeholder="t('alerts.searcHistory')"
        data-test="alert-history-search-select-mobile"
        class="o2-search-input min-w-0 flex-1"
        clearable
        @clear="clearSearch"
      >
        <template #icon-left>
          <OIcon class="o2-search-input-icon" name="search" size="sm" />
        </template>
        <template #empty>
          <div class="text-muted-foreground px-3 py-2">
            {{ t("alerts.noAlertsFound") }}
          </div>
        </template>
      </OSelect>
      <OButton
        variant="ghost"
        icon-left="search"
        size="icon-sm"
        @click="manualSearch"
        data-test="alert-history-manual-search-btn-mobile"
        :disabled="loading"
      >
        <OTooltip :content="t('common.search')" />
      </OButton>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden">
      <div class="bg-card-glass-bg h-full">
        <!-- eslint-disable local/no-hardcoded-px -- mixed with vh/vw — vh tracks the window while rem tracks font-size; keep the expression unit-consistent -->
        <OTable
          data-test="alert-history-table"
          :data="rows"
          :columns="columns"
          row-key="id"
          pagination="server"
          :current-page="currentPage"
          :page-size="pageSize"
          :page-size-options="pageSizeOptions"
          :total-count="totalCount"
          sorting="server"
          :sort-by="sortBy"
          :sort-order="sortOrder"
          :loading="loading"
          :error="refreshFailure ? null : historyError"
          show-index
          :show-global-filter="false"
          :default-columns="false"
          width="100%"
          max-height="calc(100vh - 130px)"
          @pagination-change="onPaginationChange"
          @sort-change="onSortChange"
        >
          <!-- eslint-enable local/no-hardcoded-px -->
          <template #empty>
            <div class="h-screen w-full">
              <NoData />
            </div>
          </template>

          <template #cell-timestamp="{ value }">
            <OTimeCell
              :value="value"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
              :empty-label="raw('—')"
            />
          </template>

          <template #cell-start_time="{ value }">
            <OTimeCell
              :value="value"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
              :empty-label="raw('—')"
            />
          </template>

          <template #cell-end_time="{ value }">
            <OTimeCell
              :value="value"
              unit="us"
              mode="absolute"
              :timezone="store.state.timezone"
              :empty-label="raw('—')"
            />
          </template>

          <template #cell-status="{ row }">
            <OTag
              type="alertState"
              :value="historyStatusOf(row)"
              data-test="alert-history-status-badge"
            />
          </template>

          <!-- T-10: what was observed, against what, and the level it
               classified to. Pre-change rows (no actual_value) render "—". -->
          <template #cell-condition="{ row }">
            <OTruncatedText
              v-if="isAckEventRow(row)"
              class="text-compact"
              data-test="alert-history-ack-event-text"
            >
              {{ ackEventText(row, t) }}
            </OTruncatedText>
            <div v-else class="flex min-w-0 items-center gap-1.5">
              <span class="text-compact whitespace-nowrap tabular-nums">
                {{ conditionSummary(row) }}
              </span>
              <template v-if="row.level">
                <span class="text-text-secondary text-2xs shrink-0">→</span>
                <OTag type="alertLevel" :value="row.level" class="shrink-0" />
              </template>
              <OTruncatedText
                v-if="row.group_label"
                class="text-2xs text-text-secondary"
                data-test="alert-history-group-label"
              >
                {{ t("alerts.historyTable.forGroup", { group: row.group_label }) }}
              </OTruncatedText>
            </div>
          </template>

          <template #cell-is_realtime="{ row, value }">
            <span v-if="isAckEventRow(row)" class="text-text-secondary">—</span>
            <OIcon
              v-else
              :name="value ? 'check-circle' : 'schedule'"
              :class="value ? 'text-status-positive' : 'text-text-body'"
              size="xs"
            >
              <OTooltip :content="value ? t('common.realTime') : t('alerts.scheduled')" />
            </OIcon>
          </template>

          <template #cell-is_silenced="{ row, value }">
            <span v-if="isAckEventRow(row)" class="text-text-secondary">—</span>
            <OIcon
              v-else
              :name="value ? 'volume-off' : 'volume-up'"
              :class="value ? 'text-text-body' : 'text-status-positive'"
              size="md"
            >
              <OTooltip
                :content="value ? t('alerts.insights.filters.silenced') : t('common.notSilenced')"
              />
            </OIcon>
          </template>

          <template #cell-duration="{ row }">
            <span v-if="isAckEventRow(row)" class="text-text-secondary">—</span>
            <template v-else>{{ formatDuration(row.end_time - row.start_time) }}</template>
          </template>

          <template #cell-retries="{ row }">
            <span v-if="isAckEventRow(row)" class="text-text-secondary">—</span>
            <template v-else>{{ row.retries }}</template>
          </template>

          <template #cell-suppression="{ row }">
            <span v-if="isAckEventRow(row)" class="text-text-secondary">—</span>
            <OTruncatedText
              v-else-if="ackSuppressedBy(row)"
              class="text-text-secondary text-xs"
              data-test="alert-history-ack-dedup"
            >
              {{ t("alerts.ack.history.dedupSuppressed", { who: raw(ackSuppressedBy(row)) }) }}
            </OTruncatedText>
            <OTruncatedText
              v-else-if="row.repeat_suppressed === true"
              class="text-text-secondary text-xs"
              data-test="alert-history-repeat-suppressed"
            >
              {{ t("alerts.suppressedAsRepeat") }}
            </OTruncatedText>
            <div v-else-if="row.grouped" class="text-primary flex items-center justify-center">
              <OIcon name="group-work" size="md">
                <OTooltip>
                  <template #content>
                    {{ t("alerts.groupedNotification") }}
                    <div>{{ row.group_size }} {{ t("alerts.alertsBatchedTogether") }}</div>
                  </template>
                </OTooltip>
              </OIcon>
              <span class="ms-1 text-xs">×{{ row.group_size || 1 }}</span>
            </div>
            <span v-else class="text-text-secondary">—</span>
          </template>

          <template #cell-actions="{ row }">
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="visibility"
              class="max-md:hidden"
              @click="showDetailsDialog(row)"
              data-test="alert-history-view-details"
            >
              <OTooltip :content="t('alerts.viewDetails')" />
            </OButton>
            <OButton
              v-if="row.error"
              :data-test="`pipeline-list-${row.name}-error-indicator`"
              variant="ghost-destructive"
              size="icon-sm"
              icon-left="error"
              class="max-md:hidden"
              @click.stop="showErrorDialog(row)"
            >
              <OTooltip
                :content="
                  t('common.lastErrorAt', { time: new Date(row.timestamp / 1000).toLocaleString() })
                "
              />
            </OButton>
            <!-- Keyed by row, so a read that replaces the row under an open menu closes it instead of retargeting it. -->
            <ODropdown :key="row.id" side="bottom" align="end">
              <template #trigger>
                <OButton
                  :aria-label="t('common.moreActions')"
                  icon-left="more-vert"
                  variant="ghost"
                  size="icon-xs-sq"
                  class="md:hidden"
                  data-test="alert-history-row-more-actions"
                  @click.stop
                />
              </template>
              <ODropdownItem
                icon-left="visibility"
                class="md:hidden"
                data-test="alert-history-view-details-menu"
                @select="showDetailsDialog(row)"
              >
                <span>{{ t("alerts.viewDetails") }}</span>
              </ODropdownItem>
              <ODropdownItem
                v-if="row.error"
                icon-left="error"
                variant="destructive"
                class="md:hidden"
                :data-test="`pipeline-list-${row.name}-error-indicator-menu`"
                @select="showErrorDialog(row)"
              >
                <span>{{
                  t("common.lastErrorAt", { time: new Date(row.timestamp / 1000).toLocaleString() })
                }}</span>
              </ODropdownItem>
            </ODropdown>
          </template>
        </OTable>
      </div>
    </div>

    <!-- Details Dialog -->
    <ODialog
      data-test="alert-history-details-dialog"
      v-model:open="detailsDialog"
      :width="55"
      :title="t('alerts.alertExecutionDetails')"
      :primary-button-label="t('common.close')"
      @click:primary="detailsDialog = false"
    >
      <div v-if="selectedRow" class="gap-2">
        <!-- Basic Information -->
        <div class="px-0 py-1">
          <div class="flex gap-3">
            <div class="w-1/2">
              <div class="text-text-secondary mb-1 text-xs">{{ t("alerts.alertName") }}</div>
              <div class="text-sm font-medium">
                {{ selectedRow.alert_name }}
              </div>
            </div>
            <div class="w-1/2">
              <div class="text-text-secondary mb-1 text-xs">{{ t("common.status") }}</div>
              <OTag type="alertState" :value="historyStatusOf(selectedRow)" />
            </div>
          </div>
        </div>

        <OSeparator class="my-2" />

        <!-- Time Information -->
        <div class="px-0 py-1">
          <div class="flex gap-3">
            <div class="w-1/2">
              <div class="text-text-secondary mb-1 text-xs">{{ t("alerts.timestamp") }}</div>
              <div class="text-sm">
                {{ formatHistoryDate(selectedRow.timestamp) }}
              </div>
            </div>
            <div class="w-1/2">
              <div class="text-text-secondary mb-1 text-xs">{{ t("common.duration") }}</div>
              <div class="text-sm">
                {{ formatDuration(selectedRow.end_time - selectedRow.start_time) }}
              </div>
            </div>
          </div>
        </div>

        <OSeparator class="my-2" />

        <!-- Alert Configuration -->
        <div class="px-0 py-1">
          <div class="flex gap-3">
            <div class="w-1/2">
              <div class="text-text-secondary mb-1 text-xs">{{ t("common.type") }}</div>
              <div class="text-sm">
                <OIcon
                  :name="selectedRow.is_realtime ? 'speed' : 'schedule'"
                  class="me-1"
                  size="xs"
                />
                {{ selectedRow.is_realtime ? t("common.realTime") : t("alerts.scheduled") }}
              </div>
            </div>
            <div class="w-1/2">
              <div class="text-text-secondary mb-1 text-xs">
                {{ t("alerts.insights.filters.silenced") }}
              </div>
              <div class="text-sm">
                <OIcon v-if="selectedRow.is_silenced" name="volume-off" size="xs" class="me-1" />
                <OIcon v-else name="volume-up" size="xs" class="me-1" />
                {{ selectedRow.is_silenced ? t("common.yes") : t("common.no") }}
              </div>
            </div>
          </div>
        </div>

        <!-- Performance Metrics (if available) -->
        <template
          v-if="
            selectedRow.evaluation_took_in_secs || selectedRow.query_took || selectedRow.retries > 0
          "
        >
          <OSeparator class="my-2" />
          <div class="px-0 py-1">
            <div class="flex gap-3">
              <div v-if="selectedRow.evaluation_took_in_secs" class="w-1/3">
                <div class="text-text-secondary mb-1 text-xs">
                  {{ t("alerts.evaluationTime") }}
                </div>
                <div class="text-sm">{{ selectedRow.evaluation_took_in_secs.toFixed(2) }}s</div>
              </div>
              <div v-if="selectedRow.query_took" class="w-1/3">
                <div class="text-text-secondary mb-1 text-xs">
                  {{ t("alerts.queryTime") }}
                </div>
                <div class="text-sm">{{ (selectedRow.query_took / 1000).toFixed(2) }}ms</div>
              </div>
              <div v-if="selectedRow.retries > 0" class="w-1/3">
                <div class="text-text-secondary mb-1 text-xs">{{ t("alerts.retries") }}</div>
                <div class="text-sm">{{ selectedRow.retries }}</div>
              </div>
            </div>
          </div>
        </template>

        <!-- Source Node (if available) -->
        <template v-if="selectedRow.source_node">
          <OSeparator class="my-2" />
          <div class="px-0 py-1">
            <div class="text-text-secondary mb-1 text-xs">{{ t("alerts.sourceNode") }}</div>
            <div class="font-mono text-sm">
              {{ selectedRow.source_node }}
            </div>
          </div>
        </template>

        <!-- Error Details (if available) -->
        <template v-if="selectedRow.error">
          <OSeparator class="my-2" />
          <div class="px-0 py-1">
            <div class="text-text-secondary mb-1 text-xs">
              <OIcon name="error" size="xs" class="me-1" />
              {{ t("alerts.errorDetails") }}
            </div>
            <div
              class="rounded-default border-negative/30 bg-status-error-bg mt-2 border border-solid p-2"
            >
              <pre
                class="text-sm"
                style="
                  white-space: pre-wrap;
                  word-break: break-word;
                  margin: 0;
                  font-family: var(--font-mono);
                  font-size: var(--text-xs);
                "
                >{{ selectedRow.error }}</pre>
            </div>
          </div>
        </template>

        <!-- Success Response (if available) -->
        <template v-if="selectedRow.success_response">
          <OSeparator class="my-2" />
          <div class="px-0 py-1">
            <div class="text-text-secondary mb-1 text-xs">
              <OIcon name="check-circle" size="xs" class="me-1" />
              {{ t("alerts.response") }}
            </div>
            <div
              class="rounded-default border-positive/30 bg-status-success-bg mt-2 border border-solid p-2"
            >
              <pre
                class="text-sm"
                style="
                  white-space: pre-wrap;
                  word-break: break-word;
                  margin: 0;
                  font-family: var(--font-mono);
                  font-size: var(--text-xs);
                "
                >{{ selectedRow.success_response }}</pre>
            </div>
          </div>
        </template>
      </div>
    </ODialog>

    <!-- Error Dialog -->
    <ODialog
      data-test="alert-history-error-dialog"
      v-model:open="errorDialog"
      size="md"
      :title="errorMessage.alert_name"
      :primary-button-label="t('common.close')"
      @click:primary="closeErrorDialog"
    >
      <template #header-left>
        <OIcon name="error" size="sm" class="text-status-error-text" />
      </template>
      <template #header-right>
        <div class="text-compact text-text-secondary ms-9 flex items-center text-xs">
          <span class="me-1">{{ t("alerts.lastError") }}</span>
          <OIcon name="schedule" size="xs" class="me-1" />
          {{
            errorMessage.last_error_timestamp &&
            new Date(errorMessage.last_error_timestamp / 1000).toLocaleString()
          }}
        </div>
      </template>

      <div class="mb-4">
        <div class="text-text-secondary mb-2 text-sm font-semibold tracking-[0.02em]">
          {{ t("alerts.errorSummary") }}
        </div>
        <div
          class="rounded-default text-compact bg-status-error-bg border-status-negative text-status-error-text border border-solid p-4 font-mono leading-[1.6] wrap-break-word whitespace-pre-wrap"
        >
          {{ errorMessage.error }}
        </div>
      </div>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import type { AlertHistoryQuery } from "@/services/alerts";
import { useOrgId } from "@/composables/query/useOrgId";
import { useQuery } from "@tanstack/vue-query";
import { alertHistoryQuery, alertsListQuery } from "@/services/alerts.queries";
import { queryClient } from "@/composables/query/queryClient";
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { formatDate } from "@/utils/date";
import DateTime from "@/components/DateTime.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import NoData from "@/components/shared/grid/NoData.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { conditionSummary } from "@/utils/alerts/runOutcome";
import {
  ackEventText,
  ackSuppressedBy,
  historyStatusOf,
  isAckEventRow,
} from "@/utils/alerts/ackState";
import OButton from "@/lib/core/Button/OButton.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import { announceAlert } from "@/lib/feedback/RegionStatus/announcer";
import { formatRefreshFailed } from "@/utils/formatters";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import { COL } from "@/lib/core/Table/OTable.types";

type HistoryView = { page: number; size: number; sortBy: string; sortOrder: "asc" | "desc" };

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const route = useRoute();

// Data
// The query shape this page is currently reading (range + page + sort +
// filter). Held reactively so the key forks per shape — paging back to a page
// already seen renders from cache instead of blanking the table.
const orgIdForHistory = useOrgId();
const readQuery = ref<AlertHistoryQuery | null>(null);
const hasRequestedHistory = ref(false);

// `enabled: false` does not stop the options factory from running, and the key
// builder reads fields off the query — so a placeholder stands in until the page
// has actually asked for a page of history.
const EMPTY_HISTORY_QUERY = {
  start_time: 0,
  end_time: 0,
  from: 0,
  size: 0,
} as unknown as AlertHistoryQuery;

const historyList = useQuery(() =>
  Object.assign(alertHistoryQuery(orgIdForHistory.value, readQuery.value ?? EMPTY_HISTORY_QUERY), {
    enabled: hasRequestedHistory.value && !!readQuery.value && !!orgIdForHistory.value,
  }),
);

const loading = historyList.isLoading;
// A request in flight while rows stay on screen — the refresh button's
// spinner. `loading` is the skeleton, which only a cold read wants.
const fetching = historyList.isFetching;
const rows = ref<any[]>([]);
// A failed read shows in the table, so the previous sort's or page's rows never pass for its result.
const historyError = ref<string | null>(null);
// Epoch ms the rows on screen were fetched, which a failed read reports as the data still shown.
const shownAt = ref<number | null>(null);
// A failed read of the shown alert and range keeps its rows under the notice, and Retry re-runs exactly that read.
type FailedRead = HistoryView & { filter: string; range: typeof dateTimeValues.value };
const refreshFailure = ref<{ failedAt: number; dataFrom: number; retry: FailedRead } | null>(null);
// The view the rows on screen were read with, so a failed read puts the header and range back on it.
let shownView: HistoryView | null = null;
// The alert and time range the rows on screen answer; a failed read for another one must not keep them.
let shownSource: string | null = null;
let withdrawFailure: (() => void) | null = null;
// A read that settles after the page is left must not announce on the page the user went to.
let unmounted = false;
const searchQuery = ref("");
const selectedAlert = ref<any>(null);
const allAlerts = ref<any[]>([]);
const filteredAlertOptions = ref<any[]>([]);
const currentPage = ref(1);
const pageSize = ref(20);
const totalCount = ref(0);
const sortBy = ref("timestamp");
const sortOrder = ref<"asc" | "desc">("desc");

const pageSizeOptions = [10, 20, 50, 100];

// Date time - default to last 15 minutes (relative)
const dateTimeRef = ref<any>(null);
const dateTimeType = ref("relative");
const relativeTime = ref("15m");
const now = Date.now();
const fifteenMinutesAgo = now - 15 * 60 * 1000;
const absoluteTime = ref({
  startTime: fifteenMinutesAgo * 1000, // Convert to microseconds
  endTime: now * 1000, // Convert to microseconds
});

// Internal datetime values for API calls
const dateTimeValues = ref({
  startTime: fifteenMinutesAgo * 1000,
  endTime: now * 1000,
  type: "relative",
  relativeTimePeriod: "15m",
});

// Dialogs
const detailsDialog = ref(false);
const errorDialog = ref(false);
const selectedRow = ref<any>(null);
// Holds the clicked history row (or ""/null when cleared) — see showErrorDialog.
const errorMessage = ref<any>("");

// Table columns
const columns = ref<OTableColumnDef[]>([
  {
    id: "alert_name",
    header: t("alerts.alertName"),
    accessorKey: "alert_name",
    sortable: true,
    size: COL.name,
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "is_realtime",
    header: t("alerts.type"),
    accessorKey: "is_realtime",
    sortable: true,
    size: 37,
    minSize: 37,
    maxSize: 37,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "is_silenced",
    header: t("alerts.isSilenced"),
    accessorKey: "is_silenced",
    sortable: true,
    size: 37,
    minSize: 37,
    maxSize: 37,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "timestamp",
    header: t("alerts.timestamp"),
    accessorKey: "timestamp",
    sortable: true,
    size: COL.dateAbsolute,
    maxSize: COL.dateAbsolute,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "start_time",
    header: t("alerts.startTime"),
    accessorKey: "start_time",
    sortable: true,
    size: COL.dateAbsolute,
    maxSize: COL.dateAbsolute,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "end_time",
    header: t("alerts.endTime"),
    accessorKey: "end_time",
    sortable: true,
    size: COL.dateAbsolute,
    maxSize: COL.dateAbsolute,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "duration",
    header: t("alerts.duration"),
    accessorFn: (row: any) => row.end_time - row.start_time,
    sortable: false,
    size: COL.duration,
    maxSize: COL.duration,
    cell: " ",
    meta: { align: "right" },
  },
  {
    id: "status",
    header: t("alerts.status"),
    accessorKey: "status",
    sortable: true,
    size: 128,
    maxSize: 128,
    cell: " ",
    meta: { align: "left" },
  },
  {
    // T-10 value context: "actual operator threshold → level" per run.
    id: "condition",
    header: t("alerts.historyTable.condition"),
    accessorKey: "actual_value",
    sortable: false,
    size: 220,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "retries",
    header: t("alerts.retries"),
    accessorKey: "retries",
    sortable: true,
    size: 64,
    maxSize: 64,
    cell: " ",
    meta: { align: "right" },
  },
  {
    id: "suppression",
    header: t("alerts.suppression"),
    sortable: false,
    size: 112,
    maxSize: 112,
    cell: " ",
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: t("common.actions"),
    isAction: true,
    pinned: "right",
    size: 80,
    minSize: 64,
    maxSize: 100,
    sortable: false,
    meta: { align: "center", actionCount: 2 },
  },
]);

// Computed
// Methods
const fetchAlertsList = async () => {
  try {
    const org = store.state.selectedOrganization.identifier;

    // All folders ("") — through the cached list read, so revisits share the
    // entry instead of re-downloading every alert for the name filter.
    const list = await queryClient.fetchQuery(alertsListQuery(org, ""));

    // Store complete alert objects and sort by name
    allAlerts.value = (list ?? [])
      .map((alert: any) => ({
        label: alert.name,
        value: alert.alert_id,
      }))
      .sort((a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label));
    filteredAlertOptions.value = [...allAlerts.value];
  } catch (error: any) {
    console.error("Error fetching alerts list:", error);
    // Silently fail - user can still type alert names manually
  }
};

const onAlertSelected = (val: any) => {
  if (val) {
    // Extract the alert_id from the selected object
    if (typeof val === "object" && val.value) {
      searchQuery.value = val.value;
    } else if (typeof val === "string") {
      searchQuery.value = val;
    }
  }
};

const clearSearch = () => {
  searchQuery.value = "";
  selectedAlert.value = null;
};

const manualSearch = () => {
  analytics.track("alert_history_searched", { alert_filtered: !!searchQuery.value });
  currentPage.value = 1;
  // The user explicitly asked for results, so this always hits the server even
  // when the filter shape is unchanged.
  fetchAlertHistory(true);
};

// Only the latest read may set the rows or the failure, so an earlier read settling late never relabels the view.
let historyReadSeq = 0;
const fetchAlertHistory = async (force = false) => {
  const seq = ++historyReadSeq;
  const requested = currentView();
  const retry: FailedRead = {
    ...requested,
    filter: searchQuery.value,
    range: { ...dateTimeValues.value },
  };
  const source = readSource(retry);
  historyError.value = null;
  try {
    const org = store.state.selectedOrganization.identifier;

    const startTime = dateTimeValues.value.startTime;
    const endTime = dateTimeValues.value.endTime;

    const query: any = {
      start_time: startTime.toString(),
      end_time: endTime.toString(),
      from: ((currentPage.value - 1) * pageSize.value).toString(),
      size: pageSize.value.toString(),
    };

    if (searchQuery.value && searchQuery.value.trim()) {
      query.alert_id = searchQuery.value.trim();
    }

    if (sortBy.value) {
      query.sort_by = sortBy.value;
      query.sort_order = sortOrder.value;
    }

    const applyHistory = (data: any) => {
      rows.value = (data.hits || []).map((hit: any, index: number) => ({
        ...hit,
        id: `${hit.timestamp}_${index}`,
      }));
      totalCount.value = data.total || 0;
      shownAt.value = historyList.dataUpdatedAt.value || Date.now();
      shownView = requested;
      shownSource = source;
      clearRefreshFailure();
    };

    // Cached per query shape (range + page + sort + filter), so paging back to
    // a page already seen renders from cache instead of blanking the table.
    // Stale-while-revalidate otherwise: the page keeps its rows while the
    // refetch runs.
    readQuery.value = query;
    // Let the key pick up the new query shape before asking for the data.
    await nextTick();

    let result;
    if (!hasRequestedHistory.value) {
      hasRequestedHistory.value = true;
      await nextTick();
      result = await historyList.suspense();
    } else if (force) {
      result = await historyList.refetch();
    } else {
      result = await historyList.suspense();
    }
    if (seq !== historyReadSeq) return;
    // Both resolve with the failure instead of rejecting.
    if (result?.error) throw result.error;
    await nextTick();

    {
      if (historyList.data.value) applyHistory(historyList.data.value);

      const nextFrom = currentPage.value * pageSize.value;
      if (nextFrom < totalCount.value) {
        queryClient.prefetchQuery(alertHistoryQuery(org, { ...query, from: nextFrom.toString() }));
      }

      if (rows.value.length === 0) {
        console.warn("No alert history found for the selected time range");
      }
    }
  } catch (error: any) {
    if (seq !== historyReadSeq) return;
    console.error("Error fetching alert history:", error);
    historyError.value =
      error?.response?.data?.message || error?.message || t("alerts.failedToFetchHistory");
    if (rows.value.length && shownAt.value && source === shownSource)
      keepRowsAfterFailure(shownAt.value, retry);
    else dropShownRows();
  }
};

// A relative range is named by its period, since its start and end move on every refresh.
const readSource = (read: FailedRead) =>
  JSON.stringify([
    read.filter.trim(),
    read.range.type === "relative"
      ? read.range.relativeTimePeriod
      : [read.range.startTime, read.range.endTime],
  ]);

const dropShownRows = () => {
  rows.value = [];
  totalCount.value = 0;
  shownAt.value = null;
  shownView = null;
  shownSource = null;
  clearRefreshFailure();
};

const currentView = (): HistoryView => ({
  page: currentPage.value,
  size: pageSize.value,
  sortBy: sortBy.value,
  sortOrder: sortOrder.value,
});

const applyView = (view: HistoryView) => {
  currentPage.value = view.page;
  pageSize.value = view.size;
  sortBy.value = view.sortBy;
  sortOrder.value = view.sortOrder;
};

const clearRefreshFailure = () => {
  if (!refreshFailure.value) return;
  refreshFailure.value = null;
  withdrawFailure?.();
  withdrawFailure = null;
};

const keepRowsAfterFailure = (dataFrom: number, retry: FailedRead) => {
  if (unmounted || !shownView) return;
  applyView(shownView);
  refreshFailure.value = { failedAt: Date.now(), dataFrom, retry };
  withdrawFailure?.();
  withdrawFailure = announceAlert(formatRefreshFailed(t, refreshFailure.value));
};

const retryFailedRead = () => {
  const retry = refreshFailure.value?.retry;
  if (retry) {
    applyView(retry);
    searchQuery.value = retry.filter;
    dateTimeValues.value = retry.range;
  }
  fetchAlertHistory(true);
};

const onRefreshClick = () => (refreshFailure.value ? retryFailedRead() : refreshData());

const updateDateTime = (value: any) => {
  dateTimeValues.value = {
    startTime: value.startTime,
    endTime: value.endTime,
    type: value.relativeTimePeriod ? "relative" : "absolute",
    relativeTimePeriod: value.relativeTimePeriod || "",
  };
  if (value.userChangedValue) {
    analytics.track("alert_history_time_range_changed", {
      type: value.relativeTimePeriod ? "relative" : "absolute",
    });
  }

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
  fetchAlertHistory();
};

const onPaginationChange = (params: { page: number; size: number }) => {
  currentPage.value = params.page;
  pageSize.value = params.size;
  fetchAlertHistory();
};

const onSortChange = (params: { column: string; order: "asc" | "desc" }) => {
  sortBy.value = params.column;
  sortOrder.value = params.order;
  fetchAlertHistory();
};

const refreshData = () => {
  fetchAlertHistory(true);
};

const formatHistoryDate = (timestamp: number) => {
  if (!timestamp) return "-";
  // Convert microseconds to milliseconds
  const dateObj = new Date(timestamp / 1000);
  return formatDate(dateObj, "YYYY-MM-DD HH:mm:ss");
};

const formatDuration = (microseconds: number) => {
  if (!microseconds || microseconds <= 0) return "0s";
  const ms = microseconds / 1000;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
};

const showDetailsDialog = (row: any) => {
  analytics.track("alert_history_detail_opened");
  selectedRow.value = row;
  detailsDialog.value = true;
};

const showErrorDialog = (error: string) => {
  errorMessage.value = error;
  errorDialog.value = true;
};

const closeErrorDialog = () => {
  errorDialog.value = false;
  errorMessage.value = null;
};

const goBack = () => {
  const { folder, tab } = route.query;
  router.push({
    name: "alertList",
    query: { org_identifier: store.state.selectedOrganization.identifier, folder, tab },
  });
};

onBeforeUnmount(() => {
  unmounted = true;
  withdrawFailure?.();
  withdrawFailure = null;
});

// Lifecycle
onMounted(async () => {
  // Fetch alerts list for dropdown
  await fetchAlertsList();
  // Fetch initial alert history
  fetchAlertHistory();
});

// Watch for organization change
watch(
  () => store.state.selectedOrganization.identifier,
  async () => {
    // Re-fetch alerts list when organization changes
    await fetchAlertsList();
    // Reset search
    clearSearch();
    // Fetch history for new organization
    fetchAlertHistory();
  },
);
</script>
