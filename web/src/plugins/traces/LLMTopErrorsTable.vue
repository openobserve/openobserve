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
    data-test="llm-top-errors"
  >
    <OTable
      :data="rows"
      :columns="columns"
      row-key="message"
      :loading="loading"
      :show-global-filter="false"
      :fill-height="false"
      :default-columns="false"
      pagination="none"
      :empty-message="
        failed
          ? t('aiObservability.panels.topErrors.loadFailed')
          : t('aiObservability.panels.topErrors.empty')
      "
      data-test="llm-top-errors-table"
      @row-click="onRowClick"
    >
      <template #cell-message="{ value }">
        <span v-if="value" class="text-error-600 truncate" :title="value">{{ value }}</span>
        <span v-else class="text-text-secondary italic">{{
          t("aiObservability.panels.topErrors.noMessage")
        }}</span>
      </template>
      <template #cell-operation="{ row }">
        <span class="truncate" :title="row.operation">{{ where(row) }}</span>
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
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
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
    id: "message",
    header: t("aiObservability.panels.topErrors.columns.message"),
    accessorKey: "message",
    size: 100,
    minSize: 100,
    meta: { align: "left", flex: true, autoWidth: true },
  },
  {
    id: "operation",
    header: t("aiObservability.panels.topErrors.columns.where"),
    accessorKey: "operation",
    size: 150,
    meta: { align: "left" },
  },
  {
    id: "traces",
    header: t("aiObservability.panels.topErrors.columns.traces"),
    accessorKey: "traces",
    size: 64,
    meta: { align: "right" },
  },
  {
    id: "last",
    header: t("aiObservability.panels.topErrors.columns.last"),
    accessorKey: "last_seen",
    size: 136,
    meta: { align: "left" },
  },
];

/** One of the operations the message came from, and how many others: "chat gpt-4o +2". */
function where(row: { operation?: string | null; operations?: number }): string {
  const others = Number(row.operations) - 1;
  const op = row.operation || "—";
  return others > 0 ? `${op} +${others}` : op;
}

function onRowClick(row: any) {
  emit("drill", { panel: props.panel, series: String(row.message ?? ""), atMicros: null });
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
</script>
