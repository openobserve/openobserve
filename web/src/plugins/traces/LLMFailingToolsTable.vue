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
  <LLMPanelCard
    :title="t(panel.titleKey)"
    :subtitle="panel.subtitleKey ? t(panel.subtitleKey) : undefined"
    data-test="llm-failing-tools"
  >
    <OTable
      :data="rows"
      :columns="columns"
      row-key="tool"
      :loading="loading"
      :show-global-filter="false"
      :fill-height="false"
      pagination="none"
      :empty-message="
        failed
          ? t('aiObservability.panels.failingTools.loadFailed')
          : t('aiObservability.panels.failingTools.empty')
      "
      data-test="llm-failing-tools-table"
      @row-click="onRowClick"
    >
      <template #cell-tool="{ value }">
        <span class="text-error-600 truncate">{{ value }}</span>
      </template>
      <template #cell-rate="{ row }">
        {{ row.calls ? `${((100 * row.failures) / row.calls).toFixed(0)}%` : "—" }}
      </template>
      <template #cell-last="{ value }">
        {{ value ? timestampToTimezoneDate(Number(value), timezone, "yyyy-MM-dd HH:mm") : "—" }}
      </template>
    </OTable>
  </LLMPanelCard>
</template>

<script lang="ts" setup>
import { computed, onUnmounted, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import LLMPanelCard from "./LLMPanelCard.vue";
import { renderPanelSql, type LLMPanelDef } from "./config/llmInsightsPanels";
import { useLLMStreamQuery } from "./composables/useLLMStreamQuery";
import type { LLMPanelDrill } from "./llmInsightsDrill";
import { timestampToTimezoneDate } from "@/utils/timezone";

const props = defineProps<{
  panel: LLMPanelDef;
  streamName: string;
  startTime: number;
  endTime: number;
  /** Bare scope predicate (agent + search); "" for all. */
  agentFilter?: string;
}>();
const emit = defineEmits<{ (e: "drill", drill: LLMPanelDrill): void }>();

const { t } = useI18nTyped();
const store = useStore();
const timezone = computed(() => store.state.timezone || "UTC");
const { executeQuery, cancelAll } = useLLMStreamQuery();

const rows = ref<any[]>([]);
const loading = ref(false);
const failed = ref(false);
let seq = 0;

const columns: OTableColumnDef[] = [
  {
    id: "tool",
    header: t("aiObservability.panels.failingTools.columns.tool"),
    accessorKey: "tool",
    meta: { align: "left", flex: true },
  },
  {
    id: "failures",
    header: t("aiObservability.panels.failingTools.columns.failures"),
    accessorKey: "failures",
    size: COL.count,
    meta: { align: "right" },
  },
  {
    id: "rate",
    header: t("aiObservability.panels.failingTools.columns.rate"),
    size: COL.count,
    meta: { align: "right" },
  },
  {
    id: "traces",
    header: t("aiObservability.panels.failingTools.columns.traces"),
    accessorKey: "traces",
    size: COL.count,
    meta: { align: "right" },
  },
  {
    id: "last",
    header: t("aiObservability.panels.failingTools.columns.last"),
    accessorKey: "last_failed",
    size: COL.createdAt,
    meta: { align: "left" },
  },
];

function onRowClick(row: any) {
  emit("drill", { panel: props.panel, series: String(row.tool ?? ""), atMicros: null });
}

async function load() {
  const mine = ++seq;
  if (!props.streamName || !props.startTime || !props.endTime) return;
  loading.value = true;
  failed.value = false;
  try {
    const sql = renderPanelSql(props.panel.query.sql, {
      stream: props.streamName,
      startTime: props.startTime,
      endTime: props.endTime,
      interval: "",
      agentFilter: props.agentFilter,
    });
    const hits = (await executeQuery(sql, props.startTime, props.endTime)) as any[];
    if (mine === seq) rows.value = hits;
  } catch (e) {
    if (mine !== seq) return;
    rows.value = [];
    failed.value = true;
    console.error(`[LLM panel ${props.panel.id}] fetch error`, e);
  } finally {
    if (mine === seq) loading.value = false;
  }
}

watch(() => [props.streamName, props.startTime, props.endTime, props.agentFilter], load, {
  immediate: true,
});
onUnmounted(cancelAll);

defineExpose({ load });
</script>
