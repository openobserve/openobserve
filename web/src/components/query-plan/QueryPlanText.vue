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
  <div class="flex h-full min-h-0 flex-col" data-test="query-plan-text">
    <div
      class="border-border-default flex shrink-0 items-center gap-3 border-b pe-4 max-md:flex-wrap max-md:ps-4 max-md:pb-2"
    >
      <OTabs v-model="tab" dense class="min-w-0 flex-1 max-md:basis-full">
        <OTab
          name="physical"
          :label="t('search.queryProfile.textPhysical')"
          data-test="query-plan-text-tab-physical"
        />
        <OTab
          name="logical"
          :label="t('search.queryProfile.textLogical')"
          data-test="query-plan-text-tab-logical"
        />
        <OTab
          v-if="analyzeRows"
          name="analyze"
          :label="t('search.queryProfile.textAnalyze', { command: raw('EXPLAIN ANALYZE') })"
          data-test="query-plan-text-tab-analyze"
        />
      </OTabs>
      <OSwitch
        v-model="wrap"
        size="sm"
        :label="t('search.queryProfile.wrapLines')"
        data-test="query-plan-text-wrap"
      />
      <OButton
        variant="outline"
        size="sm"
        icon-left="content-copy"
        :disabled="!text"
        data-test="query-plan-text-copy"
        @click="copy"
        >{{ t("common.copy") }}</OButton
      >
    </div>

    <div
      class="bg-surface-panel min-h-0 flex-1 overflow-auto py-3"
      data-test="query-plan-text-body"
    >
      <OTable
        v-if="tab === 'analyze' && analyzeRows?.length"
        :data="analyzeRows"
        :columns="analyzeColumns"
        row-key="id"
        pagination="none"
        :show-global-filter="false"
        :fill-height="false"
        :horizontal-scroll="!wrap"
        dense
        class="-mt-3"
        data-test="query-plan-text-analyze-table"
      >
        <template #cell-plan="{ row }">
          <PlanTextLines :text="row.plan" :wrap="wrap" class="py-1" />
        </template>
      </OTable>
      <PlanTextLines
        v-else-if="tab !== 'analyze' && text.trim()"
        :text="text"
        :wrap="wrap"
        numbered
      />
      <div
        v-else
        class="text-text-secondary px-4 py-6 text-center text-sm"
        data-test="query-plan-text-empty"
      >
        {{ emptyText }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { copyToClipboard } from "@/utils/clipboard";
import type { AnalyzeRow } from "@/utils/queryProfile";
import PlanTextLines from "./PlanTextLines.vue";

const props = defineProps<{
  physicalPlan: string;
  logicalPlan: string;
  analyzeRows: AnalyzeRow[] | null;
  initialTab?: "physical" | "logical" | "analyze";
}>();

const { t } = useI18nTyped();

const TOP = { cellClass: "align-top" };

const tab = ref<string | number>(props.initialTab ?? "physical");
const wrap = ref(true);

const text = computed(() => {
  if (tab.value === "logical") return props.logicalPlan;
  if (tab.value === "analyze") return analyzeJson(props.analyzeRows);
  return props.physicalPlan;
});

const analyzeColumns = computed<OTableColumnDef<AnalyzeRow>[]>(() => [
  {
    id: "phase",
    header: t("search.queryProfile.phase"),
    accessorKey: "phase",
    size: 64,
    meta: TOP,
  },
  { id: "node", header: t("search.queryProfile.node"), accessorKey: "node", size: 140, meta: TOP },
  {
    id: "address",
    header: t("search.queryProfile.nodeAddress"),
    accessorKey: "address",
    size: 200,
    meta: TOP,
  },
  {
    id: "plan",
    header: t("search.queryProfile.plan"),
    accessorKey: "plan",
    meta: { ...TOP, autoWidth: true, cellOverflowTooltip: false },
  },
]);

const emptyText = computed<I18nText>(() => {
  if (tab.value === "logical") return t("search.noLogicalPlan");
  if (tab.value === "analyze") return t("search.noAnalyzePlanFound");
  return t("search.noPhysicalPlan");
});

watch(
  () => props.analyzeRows,
  (rows) => {
    if (rows === null && tab.value === "analyze") tab.value = "physical";
  },
);

function copy() {
  copyToClipboard(text.value, t);
}

function analyzeJson(rows: AnalyzeRow[] | null): string {
  if (!rows?.length) return "";
  // the same fields, in the same order, as a row of EXPLAIN ANALYZE on the logs page
  const hits = rows.map((r) => ({
    phase: r.phase,
    node_address: r.address,
    node_name: r.node,
    plan: r.plan,
  }));
  return JSON.stringify(hits, null, 2);
}
</script>
