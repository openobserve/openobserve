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
  <OTable
    :data="rows"
    :columns="columns"
    :frame="false"
    row-key="id"
    pagination="client"
    :page-size="20"
    :show-global-filter="false"
    class="min-h-0 flex-1"
    data-test="autoobserve-issues-table"
    :row-rail-tone="(row: Issue) => (row.status === 'resolved' ? null : row.severity)"
    @row-click="(row: Issue) => emit('open-issue', row)"
  >
    <template #toolbar>
      <OToggleGroup
        mobile-dropdown
        :model-value="filter"
        data-test="autoobserve-issues-filter"
        @update:model-value="(v) => (filter = v as typeof filter)"
      >
        <OToggleGroupItem value="open" size="sm">{{
          t("autoobserve.issues.open")
        }}</OToggleGroupItem>
        <OToggleGroupItem value="resolved" size="sm">{{
          t("autoobserve.issues.recent")
        }}</OToggleGroupItem>
        <OToggleGroupItem value="all" size="sm">{{ t("autoobserve.issues.all") }}</OToggleGroupItem>
      </OToggleGroup>
    </template>
    <template #subheader>
      <div
        class="px-page-edge border-table-row-divider flex flex-col gap-1.5 border-b py-1.5"
        data-test="autoobserve-issues-summary"
      >
        <div class="flex items-center gap-2">
          <OIcon name="notifications-active" size="sm" class="text-text-secondary" />
          <span class="text-text-secondary text-xs">{{ t("autoobserve.issues.subtitle") }}</span>
        </div>
        <OStatStrip :items="severityStats" compact />
      </div>
    </template>
    <template #cell-title="{ row }">
      <span class="text-text-heading font-medium">{{ row.title }}</span>
    </template>
    <template #cell-severity="{ row }">
      <OTag type="severity" :value="row.severity" size="sm" />
    </template>
    <template #cell-services="{ row }">
      <div class="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
        <OTag
          v-for="svc in row.services"
          :key="svc"
          variant="default-soft"
          shape="rounded"
          size="xs"
          :label="raw(svc)"
        />
      </div>
    </template>
    <template #cell-status="{ row }">
      <OTag
        v-if="row.deferred"
        variant="default-soft"
        size="sm"
        icon="schedule"
        :label="t('autoobserve.issues.heldForDigest')"
      />
      <OTag v-else type="incidentStatus" :value="row.status" size="sm" />
    </template>
    <template #cell-cause="{ row }">
      <span class="text-text-secondary truncate text-xs">{{ row.cause }}</span>
    </template>
    <template v-if="FUNNEL[scenario].incidents > issues.length" #footer-note>
      <span class="text-text-secondary text-xs" data-test="autoobserve-issues-subset-note">
        {{
          t("autoobserve.issues.subsetNote", {
            shown: rows.length,
            total: FUNNEL[scenario].incidents,
          })
        }}
      </span>
    </template>
    <template #empty>
      <OEmptyState
        size="block"
        illustration="check"
        :title="t('autoobserve.issues.emptyTitle')"
        :description="t('autoobserve.issues.emptyDescription')"
      />
    </template>
  </OTable>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { FUNNEL, type Issue, type Scenario } from "./fixtures";

const props = defineProps<{ issues: Issue[]; scenario: Scenario }>();
const emit = defineEmits<{ "open-issue": [issue: Issue] }>();

const { t } = useI18nTyped();

const filter = ref<"open" | "resolved" | "all">("open");

const rows = computed(() =>
  props.issues.filter((i) => {
    if (filter.value === "open") return i.status !== "resolved";
    if (filter.value === "resolved") return i.status === "resolved";
    return true;
  }),
);

const severityStats = computed<StatItem[]>(() => {
  const count = (s: string) => rows.value.filter((i) => i.severity === s).length;
  return [
    { key: "total", label: t("alerts.incidents.filterAll"), value: rows.value.length },
    { key: "p1", label: t("alerts.incidents.severityP1"), value: count("p1"), tone: "error" },
    { key: "p2", label: t("alerts.incidents.severityP2"), value: count("p2"), tone: "orange" },
    { key: "p3", label: t("alerts.incidents.severityP3"), value: count("p3"), tone: "warning" },
    { key: "p4", label: t("alerts.incidents.severityP4"), value: count("p4"), tone: "info" },
  ];
});

const columns: OTableColumnDef<Issue>[] = [
  {
    id: "title",
    header: t("autoobserve.issues.colTitle"),
    accessorKey: "title",
    size: 360,
    meta: { flex: true },
  },
  {
    id: "severity",
    header: t("autoobserve.issues.colSeverity"),
    accessorKey: "severity",
    size: 100,
  },
  {
    id: "services",
    header: t("autoobserve.issues.colServices"),
    accessorKey: "services",
    size: 300,
  },
  {
    id: "started",
    header: t("autoobserve.issues.colStarted"),
    accessorKey: "started",
    size: COL.dateAbsolute,
  },
  { id: "status", header: t("autoobserve.issues.colStatus"), accessorKey: "status", size: 150 },
  { id: "cause", header: t("autoobserve.issues.colCause"), accessorKey: "cause", size: 420 },
];
</script>
