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
      <div class="flex w-full items-center gap-2">
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
      <div v-if="row.labels?.length" class="flex flex-wrap items-center gap-2">
        <span v-for="label in row.labels" :key="label.name" class="inline-flex items-center gap-1">
          <span class="text-2xs text-text-tertiary uppercase">{{ label.name }}</span>
          <span class="text-compact text-text-heading font-mono">{{ label.value }}</span>
        </span>
      </div>
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
      <OTag v-if="row.last_outcome" type="alertState" :value="row.last_outcome" size="sm" />
      <span v-else class="text-text-secondary">—</span>
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
      <OButton
        variant="ghost"
        size="icon-sm"
        icon-left="history"
        :data-test="`alerts-alertgroupstable-history-${row.group_key}`"
        @click.stop="emit('show-history', row)"
      >
        <OTooltip side="left" :content="t('alerts.groups.viewHistory')" />
      </OButton>
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
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";

import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { AlertGroup } from "@/ts/interfaces/alert";

const props = withDefaults(
  defineProps<{
    groups: AlertGroup[];
    loading?: boolean;
  }>(),
  { loading: false },
);

const emit = defineEmits<{
  refresh: [];
  "show-history": [group: AlertGroup];
}>();

const { t } = useI18n();
const store = useStore();
const search = ref("");

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
    header: "",
    cell: " ",
    isAction: true,
    size: 70,
    meta: { align: "center" },
  },
]);
</script>
