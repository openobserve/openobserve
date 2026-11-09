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
    bleed
    :title="t('alerts.header')"
    icon="shield-alert-outline"
    :subtitle="t('alerts.subtitle')"
    tabs-below
  >
    <template #header-tabs>
      <AlertSectionTabs />
    </template>

    <div class="flex min-h-0 flex-1 flex-col" data-test="alerts-firing-page">
      <OBanner
        v-if="refreshFailed || statusUnavailable"
        variant="warning"
        inline-actions
        dense
        role="alert"
        :content="bannerContent"
        data-test="alerts-firing-stale-banner"
      >
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            :loading="fetching"
            data-test="alerts-firing-retry"
            @click="refresh"
          >
            {{ t("alerts.firing.retry") }}
          </OButton>
        </template>
      </OBanner>

      <OTable
        class="min-h-0 flex-1"
        :frame="false"
        data-test="alerts-firing-table"
        table-id="alerts-firing-list"
        row-key="alert_id"
        :data="visibleRows"
        :columns="columns"
        :loading="loading"
        :loading-reset-key="state"
        :error="loadError"
        :forbidden="forbidden"
        forbidden-resource="alert_folders"
        selection="multiple"
        v-model:selected-ids="selectedIds"
        pagination="client"
        sorting="client"
        :show-global-filter="false"
        :enable-column-resize="true"
        :persist-columns="true"
        :row-rail-tone="rowRailTone"
        :row-class="rowClass"
        @row-click="openAlert"
      >
        <template #toolbar>
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-md:contents">
            <OToggleGroup
              mobile-dropdown
              :model-value="state"
              data-test="alerts-firing-chips"
              @update:model-value="selectState"
            >
              <OToggleGroupItem
                v-for="chip in chips"
                :key="chip.value"
                :value="chip.value"
                size="sm"
                :data-test="`alerts-firing-chip-${chip.value}`"
              >
                {{ chip.label }}
              </OToggleGroupItem>
            </OToggleGroup>
            <OSearchInput
              v-model="search"
              class="min-w-40 flex-1 basis-40 max-md:min-w-24 max-md:basis-24"
              clearable
              :placeholder="t('alerts.firing.searchPlaceholder')"
              data-test="alerts-firing-search"
            />
            <template v-if="!isMobile">
              <OSelect
                v-model="priority"
                :options="priorityOptions"
                :aria-label="t('alerts.firing.priorityLabel')"
                width="xs"
                data-test="alerts-firing-priority"
              />
              <OSelect
                v-model="folder"
                :options="folderOptions"
                :aria-label="t('alerts.firing.folderLabel')"
                width="xs"
                data-test="alerts-firing-folder"
              />
            </template>
          </div>
        </template>

        <template #toolbar-trailing>
          <OTag
            v-if="refreshFailed"
            variant="warning-soft"
            size="sm"
            :label="t('alerts.firing.stale')"
            data-test="alerts-firing-stale"
          />
          <ORefreshButton
            layout="inline"
            variant="outline"
            :last-run-at="updatedAt || null"
            :loading="fetching"
            shortcut-id="alertsRefresh"
            data-test="alerts-firing-refresh"
            @click="refresh"
          />
        </template>

        <template #cell-priority="{ row }">
          <OTag v-if="row.priority" type="alertPriority" :value="`p${row.priority}`" />
          <span v-else class="text-text-muted">—</span>
        </template>

        <template #cell-state="{ row }">
          <OTag
            v-if="stateTag(row, state) === 'muted'"
            variant="default-soft"
            icon="notifications-paused"
            size="sm"
            :label="t('alerts.firing.chipMuted')"
          />
          <OTag v-else type="alertState" :value="stateTag(row, state)" size="sm" />
        </template>

        <template #cell-name="{ row }">
          <div class="flex min-w-0 flex-col py-1">
            <div class="flex min-w-0 items-center gap-2">
              <OTruncatedText
                as="span"
                class="text-text-heading min-w-0 font-medium"
                :data-test="`alerts-firing-row-name-${row.alert_id}`"
              >
                {{ raw(row.name) }}
              </OTruncatedText>
              <AckChip
                v-if="row.ack"
                :ack="row.ack"
                :data-test="`alerts-firing-row-ack-${row.alert_id}`"
              />
            </div>
            <OTruncatedText
              as="span"
              class="text-text-secondary text-xs"
              :data-test="`alerts-firing-row-sub-${row.alert_id}`"
            >
              {{ raw(row.stream_name ?? "—") }}
            </OTruncatedText>
          </div>
        </template>

        <template #cell-firing_for="{ row }">
          <span class="tabular-nums">{{ raw(firingForLabel(row.firing_started_at, now)) }}</span>
        </template>

        <template #selection-actions>
          <OButton
            v-if="selectedRows.some(canAcknowledge)"
            variant="primary"
            size="sm"
            :loading="bulkAck.isPending.value"
            data-test="alerts-firing-bulk-ack"
            @click="acknowledgeSelected"
          >
            {{ t("alerts.firing.acknowledgeCount", { count: selectedIds.length }) }}
          </OButton>
          <OButton
            v-if="bulkMuteRow"
            variant="outline"
            size="sm"
            data-test="alerts-firing-bulk-mute"
            @click="openBulkMute"
          >
            {{ t("alerts.firing.mute") }}
          </OButton>
          <OButton
            variant="ghost"
            size="sm"
            data-test="alerts-firing-bulk-clear"
            @click="selectedIds = []"
          >
            {{ t("alerts.firing.clear") }}
          </OButton>
        </template>

        <template #empty>
          <div
            v-if="!loading && !statusUnavailable"
            class="contents"
            data-test="alerts-firing-empty"
          >
            <OEmptyState
              size="hero"
              icon="notifications-active"
              :title="filtered ? undefined : emptyTitle"
              :filtered="filtered"
              :hide-action="!filtered"
              @action="clearFilters"
            />
          </div>
        </template>

        <template #error="{ message }">
          <OEmptyState preset="load-error" :description="raw(message)" @action="refresh" />
        </template>
      </OTable>
    </div>

    <FiringAlertDrawer
      :alert-id="selectedAlertId"
      :row="selectedRow"
      :refreshed-at="updatedAt"
      @close="closeAlert"
      @changed="refresh"
    />
    <QuickMuteDialog
      v-if="downtimesEnabled"
      v-model:open="muteDialogOpen"
      :selection="muteSelection"
      :alert="muteAlert"
      @muted="refresh"
    />
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMutation } from "@tanstack/vue-query";

import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef, RowRailTone } from "@/lib/core/Table/OTable.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import AlertSectionTabs from "./AlertSectionTabs.vue";
import AckChip from "./AckChip.vue";
import FiringAlertDrawer from "./FiringAlertDrawer.vue";
import QuickMuteDialog from "./downtimes/QuickMuteDialog.vue";
import { useAlertActions } from "@/composables/alerts/useAlertActions";
import { useFiringAlerts, FIRING_CLOCK_MS } from "@/composables/alerts/useFiringAlerts";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { useRowMute } from "@/composables/downtimes/useRowMute";
import useBreakpoint from "@/composables/useBreakpoint";
import { useOrgId } from "@/composables/query";
import { ackAlertsMutation } from "@/services/alerts.queries";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import analytics from "@/services/product_analytics";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import { formatInZone } from "@/utils/oncall";
import {
  ackBody,
  canAcknowledge,
  filterRows,
  firingForLabel,
  stateTag,
  type FiringRow,
  type FiringState,
} from "@/utils/alerts/firingAlerts";

const CHIPS: { value: FiringState; labelKey: I18nKey; emptyKey: I18nKey }[] = [
  { value: "firing", labelKey: "alerts.firing.chipFiring", emptyKey: "alerts.firing.emptyFiring" },
  { value: "acked", labelKey: "alerts.firing.chipAcked", emptyKey: "alerts.firing.emptyAcked" },
  { value: "muted", labelKey: "alerts.firing.chipMuted", emptyKey: "alerts.firing.emptyMuted" },
  { value: "failed", labelKey: "alerts.firing.chipFailed", emptyKey: "alerts.firing.emptyFailed" },
];

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();
const viewerZone = useViewerTimezone();
const { isMobile } = useBreakpoint();

const state = ref<FiringState>("firing");
const search = ref("");
const priority = ref("all");
const folder = ref("all");
const selectedIds = ref<string[]>([]);
const selectedAlertId = computed(() =>
  typeof route.query.alert === "string" && route.query.alert ? route.query.alert : null,
);

const {
  rows,
  counts,
  statusUnavailable,
  loading,
  fetching,
  updatedAt,
  error,
  refreshFailed,
  forbidden,
  selectedRow,
  refresh,
} = useFiringAlerts(state, selectedAlertId);

// Rows only change on a refresh, so Firing for needs its own clock to keep moving.
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), FIRING_CLOCK_MS);
});
onBeforeUnmount(() => clearInterval(clock));

const { downtimesEnabled, muteDialogOpen, muteSelection, openMuteDialog } = useRowMute<FiringRow>(
  () => "alerts",
  (row) => row.alert_id,
);

const chips = computed(() =>
  CHIPS.filter((chip) => chip.value !== "muted" || downtimesEnabled.value).map((chip) => ({
    value: chip.value,
    label: counts.value
      ? t("alerts.firing.chipCount", {
          label: t(chip.labelKey),
          count: counts.value[chip.value],
        })
      : t(chip.labelKey),
  })),
);

const filtered = computed(
  () => !!search.value || priority.value !== "all" || folder.value !== "all",
);

const visibleRows = computed(() =>
  filterRows(rows.value, { search: search.value, priority: priority.value, folder: folder.value }),
);

// The table starts a numeric column descending, so these rank negatively to open most urgent and longest firing.
const columns = computed<OTableColumnDef<FiringRow>[]>(() => [
  {
    id: "priority",
    header: t("alerts.firing.columnPriority"),
    accessorFn: (row) => (row.priority ? -row.priority : undefined),
    size: 90,
    hideable: true,
    sortable: true,
    sortUndefined: "last",
  },
  { id: "state", header: t("alerts.firing.columnState"), size: 130, hideable: true },
  {
    id: "name",
    header: t("alerts.firing.columnAlert"),
    accessorKey: "name",
    meta: { isName: true },
    sortable: true,
  },
  {
    id: "folder_name",
    header: t("alerts.firing.columnFolder"),
    accessorKey: "folder_name",
    size: 160,
    hideable: true,
    sortable: true,
  },
  {
    id: "firing_for",
    header: t("alerts.firing.columnFiringFor"),
    accessorFn: (row) => (row.firing_started_at ? -row.firing_started_at : undefined),
    size: 110,
    hideable: true,
    sortable: true,
    sortUndefined: "last",
  },
]);

const priorityOptions = computed(() => [
  { label: t("alerts.firing.priorityAll"), value: "all" },
  ...[1, 2, 3, 4, 5].map((p) => ({ label: raw(`P${p}`), value: String(p) })),
  { label: t("alerts.firing.priorityUnset"), value: "unset" },
]);

const folderOptions = computed(() => {
  const names = new Set(rows.value.map((row) => row.folder_name));
  if (folder.value !== "all") names.add(folder.value);
  return [
    { label: t("alerts.firing.folderAll"), value: "all" },
    ...[...names].sort().map((name) => ({ label: raw(name), value: name })),
  ];
});

const rowRailTone = (row: FiringRow) => (row.priority ? (`p${row.priority}` as RowRailTone) : null);

const rowClass = (row: FiringRow) =>
  row.alert_id === selectedAlertId.value ? "bg-table-row-selected-bg" : "";

const openAlert = (row: FiringRow) => {
  analytics.track("alert_firing_detail_opened");
  void router.replace({ query: { ...route.query, alert: row.alert_id } });
};
const closeAlert = () => {
  const { alert: _alert, ...query } = route.query;
  void router.replace({ query });
};

useShortcuts([
  {
    id: "alertsRefresh",
    handler: () => {
      if (!isInputFocused()) void refresh();
    },
  },
]);

const updatedTime = computed(() =>
  raw(formatInZone(updatedAt.value * 1000, viewerZone.value, { timeStyle: "short" })),
);
const refreshFailedReason = computed(() =>
  error.value?.code === "ECONNABORTED"
    ? raw("timeout")
    : raw(error.value?.response?.data?.message ?? error.value?.message) ||
      t("alerts.firing.refreshFailedReason"),
);
const bannerContent = computed(() =>
  refreshFailed.value
    ? t("alerts.firing.refreshFailed", {
        reason: refreshFailedReason.value,
        time: updatedTime.value,
      })
    : t("alerts.firing.statusUnavailable"),
);
const loadError = computed(() =>
  error.value && !refreshFailed.value && !forbidden.value
    ? (error.value?.response?.data?.message ?? error.value?.message ?? "")
    : null,
);

const emptyTitle = computed(() => {
  const chip = CHIPS.find((candidate) => candidate.value === state.value);
  return chip ? t(chip.emptyKey) : undefined;
});

const clearFilters = () => {
  search.value = "";
  priority.value = "all";
  folder.value = "all";
};

const selectState = (value: unknown) => {
  if (!value) return;
  state.value = value as FiringState;
  analytics.track("alert_firing_state_filtered", { state: state.value });
};

watch(state, () => (selectedIds.value = []));
// A row a refresh or a filter took away must not stay in the batch.
watch(visibleRows, (next) => {
  const ids = new Set(next.map((row) => row.alert_id));
  if (selectedIds.value.some((id) => !ids.has(id))) {
    selectedIds.value = selectedIds.value.filter((id) => ids.has(id));
  }
});

const selectedRows = computed(() =>
  visibleRows.value.filter((row) => selectedIds.value.includes(row.alert_id)),
);

const bulkAck = useMutation(() => ackAlertsMutation(orgId.value));
const { reportAckFailure } = useAlertActions();

const acknowledgeSelected = async () => {
  // The ack refetches the list, which would shrink the selection under this count.
  const batch = selectedRows.value.length;
  const rows = selectedRows.value.filter(canAcknowledge);
  const targets = rows.map((row) => ({
    alertId: row.alert_id,
    folderId: row.folder_id,
    body: ackBody(row),
  }));
  const { acked, failures } = await bulkAck.mutateAsync(targets);
  const failed = failures.length;
  const skipped = batch - acked - failed;
  toast({
    variant: acked && !failed ? "success" : "warning",
    message: failed
      ? t("toastMessages.alerts.firing.bulkResultFailed", { acked, skipped, failed })
      : skipped
        ? t("toastMessages.alerts.firing.bulkResult", { acked, skipped })
        : t("toastMessages.alerts.firing.bulkAllAcked", { acked }),
  });
  const [first] = failures;
  if (first) {
    const name = rows.find((row) => row.alert_id === first.alertId)?.name ?? first.alertId;
    reportAckFailure(first.error, name);
  }
  selectedIds.value = [];
};

const bulkMuteRow = computed(() => {
  const [row] = selectedRows.value;
  return downtimesEnabled.value &&
    selectedRows.value.length === 1 &&
    row.alert_type !== "anomaly_detection" &&
    !row.active_downtime
    ? row
    : null;
});
const muteAlert = ref<{ alertId: string; name: string; folderId?: string } | null>(null);

const openBulkMute = () => {
  const row = bulkMuteRow.value;
  if (!row) return;
  muteAlert.value = { alertId: row.alert_id, name: row.name, folderId: row.folder_id };
  openMuteDialog([row]);
};
</script>
