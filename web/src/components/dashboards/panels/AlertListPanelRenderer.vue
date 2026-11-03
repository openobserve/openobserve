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
  <div class="flex h-full min-h-0 w-full flex-col" data-test="dashboard-alert-list-panel">
    <OEmptyState
      v-if="query.data.value?.forbidden"
      preset="no-access"
      size="inline"
      :backdrop="false"
      data-test="dashboard-alert-list-panel-forbidden"
    />
    <OEmptyState
      v-else-if="query.isError.value"
      size="inline"
      icon="warning"
      :title="t('common.errorLoadingData')"
      :backdrop="false"
      data-test="dashboard-alert-list-panel-error"
    />
    <OTable
      v-else
      class="min-h-0 flex-1"
      :data="rows"
      :columns="columns"
      row-key="id"
      pagination="none"
      sorting="none"
      :frame="false"
      :show-global-filter="false"
      dense
      fill-height
      :loading="query.isPending.value"
      :row-class="alertRowClass"
      :get-row-style="alertRowStyle"
      data-test="dashboard-alert-list-panel-table"
      @row-click="openAlert"
    >
      <template #cell-name="{ row }">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden">
          <span class="rounded-default bg-surface-subtle grid h-6 w-6 shrink-0 place-items-center">
            <OIcon :name="typeIconName(row)" size="sm" :class="typeIconClass(row)" />
          </span>
          <OTruncatedText>{{ row.name || emDash }}</OTruncatedText>
          <AckChip v-if="row.ack" :ack="row.ack" />
          <MutedChip v-if="row.activeDowntime" :downtime="row.activeDowntime" />
          <template v-if="row.alertType === 'Composite'">
            <OTag variant="warning-soft" size="sm" :label="t('alerts.compositeAlert')" />
            <span class="text-text-secondary text-xs whitespace-nowrap">
              {{ t("alerts.composite.childrenCount", { count: row.childCount }) }}
            </span>
          </template>
          <OTag v-if="row.isSlo" variant="indigo-soft" size="sm" :label="t('alerts.sloBadge')" />
        </div>
        <OTruncatedText
          v-if="row.alertType === 'Composite' && row.expression"
          class="text-text-secondary block text-xs"
        >
          {{ row.expression }}
        </OTruncatedText>
      </template>
      <template #cell-last_outcome="{ row }">
        <OTooltip
          v-if="showRunOutcome(row) && isMutedFiring(row)"
          :content="
            t('alerts.downtimes.mute.firingMutedTooltip', { name: row.activeDowntime.name })
          "
        >
          <OTag
            variant="default-soft"
            icon="notifications-paused"
            size="sm"
            :label="t('alerts.downtimes.mute.firingMuted')"
            :data-test="`dashboard-alert-list-panel-state-${row.id}`"
          />
        </OTooltip>
        <OTooltip v-else-if="isAckedFiring(row)" :content="runOutcomeTooltip(row)">
          <OTag
            variant="default-soft"
            icon="person"
            size="sm"
            :label="t('alerts.ack.firingAcknowledged')"
            :data-test="`dashboard-alert-list-panel-state-${row.id}`"
          />
        </OTooltip>
        <OTooltip v-else-if="showRunOutcome(row)" :content="runOutcomeTooltip(row)">
          <OTag
            type="alertState"
            :value="row.lastOutcome"
            size="sm"
            :data-test="`dashboard-alert-list-panel-state-${row.id}`"
          />
        </OTooltip>
        <span
          v-else
          class="text-text-body"
          :data-test="`dashboard-alert-list-panel-state-${row.id}`"
          >{{ emDash }}</span
        >
      </template>
      <template #cell-priority="{ row }">
        <OTag v-if="row.priority" type="alertPriority" :value="`p${row.priority}`" />
        <span v-else class="text-text-secondary">{{ emDash }}</span>
      </template>
      <template #cell-owner="{ row }">
        <OUserCell :value="row.owner" />
      </template>
      <template #cell-last_triggered_at="{ row }">
        <OTimeCell
          :value="row.lastTriggeredAt"
          unit="us"
          mode="relative"
          :timezone="store.state.timezone"
          :empty-label="t('alerts.anomaly.retrainNever')"
        />
      </template>
      <template #cell-last_satisfied_at="{ row }">
        <span class="inline-flex min-w-0 items-center gap-1.5">
          <span
            v-if="['hot', 'warm'].includes(recencyLevel(row.lastSatisfiedAt))"
            class="h-1.5 w-1.5 shrink-0 rounded-full"
            :class="
              recencyLevel(row.lastSatisfiedAt) === 'hot'
                ? 'bg-warning-500 motion-safe:animate-pulse'
                : 'bg-text-muted'
            "
          />
          <OTimeCell
            :value="row.lastSatisfiedAt"
            unit="us"
            mode="absolute"
            :timezone="store.state.timezone"
            :empty-label="t('alerts.anomaly.retrainNever')"
            :data-test="`dashboard-alert-list-panel-satisfied-${row.id}`"
          />
        </span>
      </template>
      <template #empty>
        <OEmptyState
          size="inline"
          icon="notifications"
          :title="t('dashboard.alertListEmpty')"
          :backdrop="false"
          data-test="dashboard-alert-list-panel-empty"
        />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import AckChip from "@/components/alerts/AckChip.vue";
import MutedChip from "@/components/alerts/downtimes/MutedChip.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { COL } from "@/lib/core/Table/OTable.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { alertListPanelQuery } from "@/utils/dashboard/alertListPanelQuery";
import { isFiringOutcome, outcomeLabel, shouldShowRunOutcome } from "@/utils/alerts/runOutcome";
import { convertUnixToDateFormat } from "@/utils/date";
import { raw, useI18nTyped } from "@/types/i18n";
import { buildAlertListRows, type AlertListRow } from "@/utils/dashboard/alertListPanel";

const props = defineProps<{
  config?: Record<string, any> | null;
  /** Changes on every dashboard, panel, auto or kiosk refresh. */
  refreshSignal?: unknown;
}>();

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const route = useRoute();
const emDash = raw("—");

const org = computed<string>(() => store.state.selectedOrganization?.identifier ?? "");
const folder = computed<string>(() =>
  typeof props.config?.alert_list_folder === "string" ? props.config.alert_list_folder : "",
);
const query = useQuery(() =>
  Object.assign(alertListPanelQuery(org.value, folder.value), { enabled: !!org.value }),
);
// The panel has no search query, so a dashboard refresh reaches it only through this signal.
watch(
  () => props.refreshSignal,
  (now, before) => {
    if (now !== before && org.value) query.refetch();
  },
);

const rows = computed<AlertListRow[]>(() =>
  buildAlertListRows(query.data.value?.alerts ?? [], props.config),
);

// Columns, labels and widths follow the Alerts page list (read-only: no selection, sorting or actions).
const columns = computed<OTableColumnDef<AlertListRow>[]>(() => [
  {
    id: "name",
    accessorKey: "name",
    header: t("alerts.name"),
    meta: { align: "left", autoWidth: true, fillRemaining: true, isName: true },
  },
  {
    id: "last_outcome",
    accessorKey: "lastOutcome",
    header: t("alerts.lastOutcome"),
    size: 176,
    meta: { align: "left" },
  },
  {
    id: "priority",
    accessorKey: "priority",
    header: t("alerts.priority"),
    size: COL.status,
    meta: { align: "left" },
  },
  {
    id: "owner",
    accessorKey: "owner",
    header: t("alerts.owner"),
    size: COL.owner,
    meta: { align: "left" },
  },
  {
    id: "last_triggered_at",
    accessorKey: "lastTriggeredAt",
    header: t("alerts.lastTriggered"),
    size: COL.dateAbsolute,
    meta: { align: "left" },
  },
  {
    id: "last_satisfied_at",
    accessorKey: "lastSatisfiedAt",
    header: t("alerts.lastSatisfied"),
    size: COL.dateAbsolute,
    meta: { align: "left" },
  },
  {
    id: "folderName",
    accessorKey: "folderName",
    header: t("alerts.folder"),
    size: 130,
    meta: { align: "left" },
  },
]);

const showRunOutcome = (row: AlertListRow): boolean =>
  shouldShowRunOutcome(row.enabled, row.lastOutcome);
const isMutedFiring = (row: AlertListRow): boolean =>
  !!row.activeDowntime && isFiringOutcome(row.lastOutcome);
const isAckedFiring = (row: AlertListRow): boolean =>
  showRunOutcome(row) && isFiringOutcome(row.lastOutcome) && !!row.ack;
// The outcome is the result of the last evaluation, so it is always qualified with when that ran.
const runOutcomeTooltip = (row: AlertListRow) => {
  const at = row.lastOutcomeAt
    ? convertUnixToDateFormat(row.lastOutcomeAt, "YYYY-MM-DD HH:mm:ss")
    : null;
  const label = outcomeLabel(
    row.lastOutcome,
    t("alerts.historyTimeline.firing"),
    t("alerts.historyTimeline.ok"),
    t("alerts.historyTimeline.error"),
    t("alerts.historyTimeline.skipped"),
    t("alerts.historyTimeline.unknown"),
    t("alerts.historyTimeline.pending"),
  );
  return raw(at ? `${label} ${t("alerts.asOf")} ${at}` : label);
};

const RECENT_TRIGGER_MS = 15 * 60 * 1000;
const RECENT_TRIGGER_DAY_MS = 24 * 60 * 60 * 1000;
const recencyLevel = (micros: number | null): "hot" | "warm" | "cold" | "none" => {
  if (!micros) return "none";
  const age = Date.now() - micros / 1000;
  if (age <= RECENT_TRIGGER_MS) return "hot";
  if (age <= RECENT_TRIGGER_DAY_MS) return "warm";
  return "cold";
};

// Same type glyph and neutral tones as the Alerts page; colour carries state, not type.
const typeIconName = (row: AlertListRow): IconName =>
  row.isSlo
    ? "track-changes"
    : row.alertType === "Composite"
      ? "account-tree"
      : row.isRealTime === "anomaly"
        ? "query-stats"
        : row.isRealTime
          ? "bolt"
          : "schedule";
const typeIconClass = (row: AlertListRow): string =>
  row.isSlo
    ? "text-text-secondary"
    : row.alertType === "Composite"
      ? "text-status-warning-text"
      : row.isRealTime === "anomaly"
        ? "text-status-info-text"
        : row.isRealTime
          ? "text-status-warning-text"
          : "text-text-secondary";

// The page's row state: a paused alert gets a muted wash and a grey rail, an active one a green rail.
const alertRowClass = (row: AlertListRow): string => (row.enabled ? "" : "!bg-surface-panel");
const alertRowStyle = (row: AlertListRow): Record<string, string> => ({
  boxShadow: `var(--shadow-rail-geom) ${row.enabled ? "var(--color-success-500)" : "var(--color-grey-400)"}`,
});

const openAlert = (row: AlertListRow) => {
  if (store.state.kioskMode || store.state.printMode || !row?.id) return;
  const target = {
    name: "alertDetail",
    params: { alert_id: row.id },
    query: { org_identifier: org.value, folder: row.folderId || "default" },
  };
  // Leaving the panel editor would drop the unsaved panel, so the alert opens in a new tab there.
  if (route.name === "addPanel") window.open(router.resolve(target).href, "_blank", "noopener");
  else router.push(target);
};
</script>
