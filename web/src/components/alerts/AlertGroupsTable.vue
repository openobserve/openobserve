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
  Per-group state table for a multi-alert (alerts_2.md §5.4).

  One row per tracked group, most severe first — the ordering comes from the
  API, which sorts by severity rank and then by group key so equal levels keep
  a stable order between polls instead of reshuffling on every refresh.

  The rows are POST-cap by construction: when the M-6 cap truncates an
  evaluation, the groups beyond it have no state row to show. That is why the
  count summary above this table reads from the rollup row's pre-cap counters
  rather than from `rows.length` — see AlertDetail.vue.
-->
<template>
  <OTable
    :data="rows"
    :columns="columns"
    row-key="group_key"
    :loading="loading"
    :frame="false"
    :page-size="25"
    :page-size-options="[25, 50, 100]"
    :show-global-filter="false"
    :persist-columns="true"
    table-id="alert-groups"
    :column-visibility="defaultColumnVisibility"
    :enable-column-resize="true"
    data-test="alerts-alertgroupstable-table"
  >
    <template #toolbar>
      <div class="flex w-full min-w-0 items-center gap-2 max-md:contents">
        <OSearchInput
          v-model="search"
          class="flex-1"
          :placeholder="t('alerts.groups.searchPlaceholder')"
          clearable
          data-test="alerts-alertgroupstable-search"
        />
      </div>
    </template>

    <template #toolbar-trailing>
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="refresh"
        :loading="loading"
        data-test="alerts-alertgroupstable-refresh"
        @click="emit('refresh')"
      >
        <OTooltip side="bottom" :content="t('alerts.groups.refresh')" />
      </OButton>
    </template>

    <template #cell-level="{ row }">
      <OTag v-if="row.level" type="alertLevel" :value="row.level" size="sm" />
      <span v-else class="text-text-secondary">—</span>
    </template>

    <!-- Each label is its own name/value pair rather than one `k=v,k=v` string:
         a multi-column group_by is the common case, and the rendered string is
         ambiguous the moment a value contains a separator. -->
    <template #cell-group="{ row }">
      <OTruncatedText
        v-if="row.labels?.length"
        as="div"
        class="flex flex-wrap items-center gap-2"
        :tooltip="labelsText(row.labels)"
      >
        <span v-for="label in row.labels" :key="label.name" class="inline-flex items-center gap-1">
          <span class="text-2xs text-text-tertiary">{{ label.name }}</span>
          <span class="text-compact text-text-heading font-mono">{{ label.value }}</span>
        </span>
      </OTruncatedText>
      <span v-else class="text-text-secondary">—</span>
    </template>

    <template #cell-level_since="{ row }">
      <OTimeCell
        :value="row.level_since"
        unit="us"
        mode="relative"
        :timezone="store.state.timezone"
      />
    </template>

    <template #cell-last_outcome="{ row }">
      <div
        class="flex min-w-0 items-center gap-2"
        :data-test="`alerts-alertgroupstable-outcome-${row.group_key}`"
      >
        <template v-if="row.ack">
          <OTag type="alertState" value="acknowledged" size="sm" />
          <span class="text-text-secondary text-xs whitespace-nowrap">
            {{ t("alerts.ack.byAt", { who: ackWho(row), time: ackTime(row) }) }}
          </span>
        </template>
        <OTag v-else-if="row.last_outcome" type="alertState" :value="row.last_outcome" size="sm" />
        <span v-else class="text-text-secondary">—</span>
        <MutedChip
          v-if="groupMute(row)"
          :downtime="groupMute(row)!"
          :data-test="`alerts-alertgroupstable-muted-${row.group_key}`"
        />
      </div>
    </template>

    <!-- The level of this group's last SUCCESSFUL delivery. An em dash on a
         firing group is meaningful, not missing data: it has never paged. -->
    <template #cell-last_notified_level="{ row }">
      <OTag
        v-if="row.last_notified_level"
        type="alertLevel"
        :value="row.last_notified_level"
        size="sm"
      />
      <span v-else class="text-text-secondary">—</span>
    </template>

    <template #cell-silenced_until="{ row }">
      <OTimeCell
        :value="row.silenced_until"
        unit="us"
        mode="absolute"
        :timezone="store.state.timezone"
      />
    </template>

    <template #cell-last_seen="{ row }">
      <OTimeCell
        :value="row.last_seen"
        unit="us"
        mode="relative"
        :timezone="store.state.timezone"
      />
    </template>

    <template #cell-actions="{ row }">
      <div class="flex items-center">
        <template v-if="assistantV2 && alert && row.level">
          <AiEntryButton v-bind="firingDoor(row, 'troubleshoot')" appearance="toolbar-icon" />
          <AiEntryButton v-bind="firingDoor(row, 'add_to_chat')" appearance="toolbar-icon" />
        </template>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="history"
          :data-test="`alerts-alertgroupstable-history-${row.group_key}`"
          @click.stop="emit('show-history', row)"
        >
          <OTooltip side="left" :content="t('alerts.groups.viewHistory')" />
        </OButton>
        <ODropdown align="end">
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon-sm"
              icon-left="more-vert"
              :aria-label="t('alerts.groupActions.menu')"
              :data-test="`alerts-alertgroupstable-menu-${row.group_key}`"
              @click.stop
            />
          </template>
          <ODropdownItem
            v-if="canAcknowledge(row)"
            icon-left="check"
            :data-test="`alerts-alertgroupstable-ack-${row.group_key}`"
            @select="onAcknowledge(row)"
          >
            {{ t("alerts.ack.acknowledge") }}
          </ODropdownItem>
          <template v-if="row.ack">
            <ODropdownItem
              icon-left="person"
              :data-test="`alerts-alertgroupstable-unack-${row.group_key}`"
              @select="onUnack(row)"
            >
              {{ t("alerts.ack.unacknowledge") }}
            </ODropdownItem>
            <ODropdownItem
              v-if="row.ack.acked_by !== actions.me.value"
              icon-left="person"
              :data-test="`alerts-alertgroupstable-take-over-${row.group_key}`"
              @select="onTakeOver(row)"
            >
              {{ t("alerts.ack.takeOver") }}
            </ODropdownItem>
          </template>
          <template v-if="muteEnabled">
            <ODropdownSeparator v-if="canAcknowledge(row) || row.ack" />
            <template v-if="groupMute(row)">
              <MuteMenuItems
                labels="extend"
                until-clear
                :data-test-prefix="`alerts-alertgroupstable-extend-${row.group_key}`"
                @preset="(secs) => onExtend(row, { minutes: secs / 60 })"
                @until-clear="onExtend(row, { untilClear: true })"
                @until="openExtendUntil(row)"
              />
              <ODropdownItem
                variant="destructive"
                icon-left="notifications-active"
                :data-test="`alerts-alertgroupstable-end-mute-${row.group_key}`"
                @select="onEndMute(row)"
              >
                {{ t("alerts.downtimes.mute.endNow") }}
              </ODropdownItem>
            </template>
            <MuteMenuItems
              v-else
              labels="group"
              until-clear
              :data-test-prefix="`alerts-alertgroupstable-mute-${row.group_key}`"
              @preset="(secs) => onMute(row, { minutes: secs / 60 })"
              @until-clear="onMute(row, { untilClear: true })"
              @until="openMuteDialog(row)"
            />
          </template>
          <ODropdownSeparator />
          <ODropdownItem
            icon-left="history"
            :data-test="`alerts-alertgroupstable-menu-history-${row.group_key}`"
            @select="emit('show-history', row)"
          >
            {{ t("alerts.groupActions.viewHistory") }}
          </ODropdownItem>
        </ODropdown>
      </div>
    </template>

    <template #empty>
      <OEmptyState
        v-if="!loading"
        size="hero"
        :title="t('alerts.groups.emptyTitle')"
        :description="t('alerts.groups.emptyDescription')"
        :filtered="!!search"
        data-test="alerts-alertgroupstable-empty"
        @action="onEmptyAction"
      />
    </template>
  </OTable>
  <AlertMuteUntilDialog
    v-if="muteEnabled"
    v-model:open="extendUntilOpen"
    :target="target"
    :downtime="untilGroup ? muteRef(untilGroup) : null"
    @done="emit('changed')"
  />
  <QuickMuteDialog
    v-if="muteEnabled"
    v-model:open="muteDialogOpen"
    :selection="[{ module: 'alerts', ids: [alertId] }]"
    :alert="muteAlertContext"
    @muted="emit('changed')"
  />
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from "vue";
import { isAssistantV2 } from "@/composables/assistant/flags";
import { useLoadedOrg } from "@/utils/assistant/doorBinding";
import { alertFiringBuild } from "@/components/alerts/alertDoors";
import type { AlertRecord } from "@/utils/assistant/prompts";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";

import type { ActiveDowntime } from "@/services/downtimes";
import { useAlertActions, type AlertMuteRef } from "@/composables/alerts/useAlertActions";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { ackShortName, downtimeForGroup } from "@/utils/alerts/ackState";
import { isFiringOutcome } from "@/utils/alerts/runOutcome";
import {
  groupOptionOf,
  type AlertMuteEnd,
  type QuickMuteAlertContext,
} from "@/utils/downtimes/quickMute";
import { formatInZone } from "@/utils/oncall";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import MuteMenuItems from "./downtimes/MuteMenuItems.vue";
import MutedChip from "./downtimes/MutedChip.vue";
import AlertMuteUntilDialog from "./AlertMuteUntilDialog.vue";
import QuickMuteDialog from "./downtimes/QuickMuteDialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { AlertGroup, AlertGroupLabel } from "@/ts/interfaces/alert";

const props = withDefaults(
  defineProps<{
    groups: AlertGroup[];
    loading?: boolean;
    /** The alert these groups belong to; firing rows get Troubleshoot and Add to chat with it. */
    alert?: AlertRecord;
    alertId?: string;
    alertName?: string;
    folderId?: string;
    /** The alert's live quick mute; a group mute lists the groups it covers. */
    downtime?: (ActiveDowntime & { version?: number }) | null;
    muteEnabled?: boolean;
  }>(),
  {
    loading: false,
    alert: undefined,
    alertId: "",
    alertName: "",
    folderId: undefined,
    downtime: null,
    muteEnabled: false,
  },
);

const emit = defineEmits<{
  refresh: [];
  "show-history": [group: AlertGroup];
  changed: [];
}>();

const { t } = useI18nTyped();
const store = useStore();
const search = ref("");
const actions = useAlertActions();
const viewerZone = useViewerTimezone();

const target = computed(() => ({
  alertId: props.alertId,
  name: props.alertName,
  folderId: props.folderId,
}));

const extendUntilOpen = ref(false);
const muteDialogOpen = ref(false);
const untilGroup = ref<AlertGroup | null>(null);

const muteAlertContext = computed<QuickMuteAlertContext>(() => ({
  ...target.value,
  groupKey: untilGroup.value?.group_key,
  groups: props.groups
    .filter((g) => isFiringOutcome(g.last_outcome) || g.group_key === untilGroup.value?.group_key)
    .map(groupOptionOf),
}));

const canAcknowledge = (row: AlertGroup) => isFiringOutcome(row.last_outcome) && !row.ack;

// The table shows the mute per group, so a group mute reads as this group's own countdown.
const groupMute = (row: AlertGroup): ActiveDowntime | null => {
  const covering = downtimeForGroup(props.downtime, row.group_key);
  return covering ? { ...covering, alert_groups: null } : null;
};

const muteRef = (row: AlertGroup): AlertMuteRef | null => {
  const covering = downtimeForGroup(props.downtime, row.group_key);
  return covering && props.downtime
    ? { id: covering.id, ends_at: covering.ends_at, version: props.downtime.version }
    : null;
};

const ackWho = (row: AlertGroup) => raw(row.ack ? ackShortName(row.ack.acked_by) : "");
const ackTime = (row: AlertGroup) =>
  raw(row.ack ? formatInZone(row.ack.acked_at, viewerZone.value, { timeStyle: "short" }) : "");

const after = (ok: boolean) => {
  if (ok) emit("changed");
};

const onAcknowledge = async (row: AlertGroup) =>
  after(
    await actions.acknowledge(target.value, {
      groupKey: row.group_key,
      firingStartedAt: row.firing_started_at,
    }),
  );

const onUnack = async (row: AlertGroup) =>
  after(
    await actions.unacknowledge(target.value, {
      groupKey: row.group_key,
      firingStartedAt: row.ack?.firing_started_at,
    }),
  );

const onTakeOver = async (row: AlertGroup) =>
  after(
    await actions.takeOver(target.value, {
      groupKey: row.group_key,
      firingStartedAt: row.ack?.firing_started_at ?? row.firing_started_at,
    }),
  );

const onMute = async (row: AlertGroup, end: AlertMuteEnd) =>
  after(
    await actions.mute(target.value, end, {
      groups: [row.group_key],
      firingStartedAt: row.firing_started_at,
    }),
  );

const onExtend = async (row: AlertGroup, end: AlertMuteEnd) => {
  const downtime = muteRef(row);
  if (downtime) after(await actions.extend(target.value, downtime, end));
};

const onEndMute = async (row: AlertGroup) => {
  const downtime = muteRef(row);
  if (downtime) after(await actions.endMute(target.value, downtime.id));
};

const openExtendUntil = (row: AlertGroup) => {
  untilGroup.value = row;
  extendUntilOpen.value = true;
};

const openMuteDialog = (row: AlertGroup) => {
  untilGroup.value = row;
  muteDialogOpen.value = true;
};

const assistantV2 = isAssistantV2();
const loadedOrg = assistantV2
  ? useLoadedOrg(
      () => props.groups,
      () => store.state.selectedOrganization?.identifier ?? "",
    )
  : null;
const AiEntryButton = defineAsyncComponent(
  () => import("@/components/ai-assistant/entry/AiEntryButton.vue"),
);
const firingDoor = (row: AlertGroup, verb: "troubleshoot" | "add_to_chat") => ({
  verb,
  entryKind: "object_verb" as const,
  boundOrg: loadedOrg?.value,
  objectKind: "alert_firing" as const,
  label: t(
    verb === "troubleshoot" ? "assistant.entry.troubleshootAlert" : "assistant.entry.addFiring",
  ),
  tooltip: t(
    verb === "troubleshoot"
      ? "assistant.entry.tooltip.troubleshootAlert"
      : "assistant.entry.tooltip.add",
  ),
  dataTest:
    verb === "troubleshoot"
      ? ("ai-entry-alert-firing-troubleshoot" as const)
      : ("ai-entry-alert-firing-add" as const),
  objectKey: `${String(props.alert?.id ?? "")}:${row.group_key}:${String(row.level_since ?? "")}`,
  build: alertFiringBuild(
    () => ({
      alert: props.alert ?? {},
      firedAt: Math.round(Number(row.level_since ?? row.last_seen ?? Date.now() * 1000) / 1000),
    }),
    store.state,
  ),
});

// Filtering is client-side because the whole group set is already bounded by
// the M-6 cap — there is no page to fetch beyond it.
const rows = computed<AlertGroup[]>(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return props.groups;
  return props.groups.filter((g) => (g.group_labels || "").toLowerCase().includes(term));
});

const onEmptyAction = (id?: string) => {
  if (id === "clear-filters") search.value = "";
};

// The label pairs hold no separators in their text, so the cut-cell tooltip spells them out.
const labelsText = (labels: AlertGroupLabel[]) =>
  raw(labels.map((label) => `${label.name}=${label.value}`).join(", "));

const defaultColumnVisibility = { last_seen: false, silenced_until: false };

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "level",
    accessorKey: "level",
    header: t("alerts.groups.level"),
    cell: " ",
    size: 120,
    resizable: true,
    meta: { align: "left" },
  },
  {
    id: "group",
    accessorKey: "group_labels",
    header: t("alerts.groups.group"),
    cell: " ",
    resizable: true,
    meta: { align: "left", flex: true },
  },
  {
    id: "level_since",
    accessorKey: "level_since",
    header: t("alerts.groups.since"),
    cell: " ",
    size: 140,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "last_outcome",
    accessorKey: "last_outcome",
    header: t("alerts.groups.lastOutcome"),
    cell: " ",
    size: 150,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "last_notified_level",
    accessorKey: "last_notified_level",
    header: t("alerts.groups.lastNotified"),
    cell: " ",
    size: 150,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "silenced_until",
    accessorKey: "silenced_until",
    header: t("alerts.groups.silencedUntil"),
    cell: " ",
    size: 170,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "last_seen",
    accessorKey: "last_seen",
    header: t("alerts.groups.lastSeen"),
    cell: " ",
    size: 150,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "actions",
    header: raw(""),
    cell: " ",
    isAction: true,
    size: assistantV2 ? 158 : 88,
    meta: { align: "center" },
  },
]);
</script>
