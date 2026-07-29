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
  Per-group level history for a multi-alert (alerts_2.md M-8).

  Sourced from the durable `alert_state_transitions` table rather than the
  triggers stream, which is why a group's history survives the group itself:
  the reaper deletes a resolved group's state row after the grace period, but
  its transitions are retained, and they carry their own labels precisely so
  the history can still say which host it was about.

  A `—` in the Value column is information, not a gap: a group that stopped
  being returned has no reading to report, and printing 0 there would render
  a disappearance as a healthy measurement.
-->
<template>
  <div class="flex h-full min-h-0 flex-col">
    <OContent
      v-if="groupFilter"
      class="flex shrink-0 items-center gap-2 py-2"
      data-test="alerts-alertgrouphistory-filter"
    >
      <span class="text-compact text-text-secondary">
        {{ t("alerts.groups.filteredBy") }}
      </span>
      <OTag
        variant="primary-soft"
        size="sm"
        :label="groupFilter.group_labels || groupFilter.group_key"
      />
      <OButton
        variant="ghost"
        size="sm"
        icon-left="close"
        data-test="alerts-alertgrouphistory-clear-filter"
        @click="emit('clear-filter')"
      >
        {{ t("alerts.groups.clearFilter") }}
      </OButton>
    </OContent>

    <OTable
      :data="rows"
      :columns="columns"
      row-key="rowKey"
      :loading="loading"
      :frame="false"
      :page-size="25"
      :page-size-options="[25, 50, 100]"
      :show-global-filter="false"
      :persist-columns="true"
      table-id="alert-group-history"
      :enable-column-resize="true"
      class="flex-1 min-h-0"
      data-test="alerts-alertgrouphistory-table"
    >
      <template #toolbar-trailing>
        <OButton
          variant="outline"
          size="icon-sm"
          icon-left="refresh"
          :loading="loading"
          data-test="alerts-alertgrouphistory-refresh"
          @click="emit('refresh')"
        >
          <OTooltip side="bottom" :content="t('alerts.groups.refresh')" />
        </OButton>
      </template>

      <template #cell-at="{ row }">
        <OTimeCell
          :value="row.at"
          unit="us"
          mode="relative"
          :timezone="store.state.timezone"
        />
      </template>

      <template #cell-group="{ row }">
        <span class="font-mono text-compact text-text-heading">
          {{ row.group_labels || t("alerts.groups.rollupRow") }}
        </span>
      </template>

      <template #cell-change="{ row }">
        <div class="flex items-center gap-1">
          <OTag
            v-if="row.from_level"
            type="alertLevel"
            :value="row.from_level"
            size="sm"
          />
          <span v-else class="text-text-secondary">—</span>
          <span class="text-text-secondary">→</span>
          <OTag
            v-if="row.to_level"
            type="alertLevel"
            :value="row.to_level"
            size="sm"
          />
          <span v-else class="text-text-secondary">—</span>
        </div>
      </template>

      <template #cell-to_outcome="{ row }">
        <OTag type="alertState" :value="row.to_outcome" size="sm" />
      </template>

      <template #cell-value="{ row }">
        <span class="font-mono text-compact text-text-secondary">
          {{ formatValue(row.value) }}
        </span>
      </template>

      <template #empty>
        <OEmptyState
          v-if="!loading"
          size="hero"
          :title="t('alerts.groups.noHistoryTitle')"
          :description="t('alerts.groups.noHistoryDescription')"
          data-test="alerts-alertgrouphistory-empty"
        />
      </template>
    </OTable>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { AlertGroup, AlertGroupTransition } from "@/ts/interfaces/alert";

type TransitionRow = AlertGroupTransition & { rowKey: string };

const props = withDefaults(
  defineProps<{
    transitions: AlertGroupTransition[];
    loading?: boolean;
    groupFilter?: AlertGroup | null;
  }>(),
  { loading: false, groupFilter: null },
);

const emit = defineEmits<{
  refresh: [];
  "clear-filter": [];
}>();

const { t } = useI18n();
const store = useStore();

// The transitions table has no surrogate key, and (group_key, at) can repeat
// within the same microsecond in principle, so the index disambiguates.
const rows = computed<TransitionRow[]>(() =>
  props.transitions.map((tr, index) => ({
    ...tr,
    rowKey: `${tr.group_key}-${tr.at}-${index}`,
  })),
);

/** `—` for an absent reading — a vanished group observed nothing, and 0 would
 *  read as a real measurement. */
const formatValue = (value?: number | null) =>
  value === undefined || value === null
    ? "—"
    : String(Math.round(value * 100) / 100);

const columns = computed<OTableColumnDef[]>(() => [
  {
    id: "at",
    accessorKey: "at",
    header: t("alerts.groups.when"),
    cell: " ",
    size: 150,
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
    id: "change",
    accessorKey: "to_level",
    header: t("alerts.groups.change"),
    cell: " ",
    size: 200,
    resizable: true,
    meta: { align: "left" },
  },
  {
    id: "to_outcome",
    accessorKey: "to_outcome",
    header: t("alerts.groups.outcome"),
    cell: " ",
    size: 140,
    resizable: true,
    hideable: true,
    meta: { align: "left" },
  },
  {
    id: "value",
    accessorKey: "value",
    header: t("alerts.groups.value"),
    cell: " ",
    size: 140,
    resizable: true,
    meta: { align: "left" },
  },
]);
</script>
