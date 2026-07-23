<!--
  Copyright 2026 OpenObserve Inc.

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
  <div class="flex flex-col gap-2.5" data-test="agent-behavior-panel">
    <!-- Looping agents. Same card/header/table shape as the sibling LLM Insights
         panels (LLMErrorTable) so the whole page reads as one surface. -->
    <div
      class="bg-card-glass-bg llm-trend-panel rounded-default border-border-default flex min-h-0 flex-1 flex-col overflow-hidden border"
      data-test="agent-behavior-loops-card"
    >
      <div class="mb-2 flex flex-col px-4 pt-4">
        <div class="text-text-heading text-sm font-semibold">
          {{ t("aiObservability.behavior.loopsTitle") }}
        </div>
        <div class="text-2xs text-text-secondary mt-0.5 leading-normal">
          {{ t("aiObservability.behavior.loopsHint") }}
        </div>
      </div>
      <OTable
        data-test="agent-behavior-loops-table"
        :data="loopRows"
        :columns="loopColumns"
        :default-columns="false"
        :frame="false"
        :show-global-filter="false"
        class="min-h-0 flex-1"
        show-index
        pagination="client"
        :empty-message="t('aiObservability.behavior.noLoops')"
        @row-click="(r: any) => openDetail('loop', r)"
      />
    </div>

    <!-- Failure taxonomy -->
    <div
      class="bg-card-glass-bg llm-trend-panel rounded-default border-border-default flex min-h-0 flex-1 flex-col overflow-hidden border"
      data-test="agent-behavior-failures-card"
    >
      <div class="mb-2 flex flex-col px-4 pt-4">
        <div class="text-text-heading text-sm font-semibold">
          {{ t("aiObservability.behavior.failuresTitle") }}
        </div>
        <div class="text-2xs text-text-secondary mt-0.5 leading-normal">
          {{ t("aiObservability.behavior.failuresHint") }}
        </div>
      </div>
      <OTable
        data-test="agent-behavior-failures-table"
        :data="failureRows"
        :columns="failureColumns"
        :default-columns="false"
        :frame="false"
        :show-global-filter="false"
        class="min-h-0 flex-1"
        show-index
        pagination="client"
        :empty-message="t('aiObservability.behavior.noFailures')"
        @row-click="(r: any) => openDetail('failure', r)"
      />
    </div>

    <!-- Cost is intentionally NOT a table here — LLM Insights already owns the
         cost story (KPIs + trend panels). Per-agent cost drill-down is reachable
         from a failure/loop row's detail panel instead of a duplicate table. -->

    <!-- Details side panel — opens on row click, shows the underlying traces. -->
    <AgentSignalDetailPanel
      v-model:open="detailOpen"
      :row="detailRow"
      :source-stream="sourceStream"
      :start-time="startTime"
      :end-time="endTime"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import AgentSignalDetailPanel from "./AgentSignalDetailPanel.vue";
import agentSignalsService, { type AgentSignalRecord } from "@/services/agent_signals";

const props = defineProps<{
  startTime?: number;
  endTime?: number;
  sourceStream?: string;
  /** When set (Agent mode), show only this agent's signals; empty = all agents. */
  agentFilter?: string;
}>();

const { t } = useI18n();
const store = useStore();

const signals = ref<AgentSignalRecord[]>([]);
const loading = ref(false);
// When the last fetch settled — stamped for the page header's refresh control.
const lastRunAt = ref<number | null>(null);

// Details side panel state.
const detailOpen = ref(false);
const detailRow = ref<any>(null);

/** Open the details panel for a clicked Behavior row (maps the table row to a signal). */
const openDetail = (signalType: "loop" | "failure" | "cost", row: Record<string, any>) => {
  detailRow.value = { signalType, ...row };
  detailOpen.value = true;
};

const orgId = computed(() => store.state.selectedOrganization?.identifier as string);

/** Signals scoped to the selected agent (Agent mode) or all agents (Stream mode). */
const scopedSignals = computed(() => {
  const a = props.agentFilter?.trim();
  if (!a) return signals.value;
  return signals.value.filter((s) => (s.agent_name ?? "") === a);
});

/** Loop rows: rank (agent, tool) by calls-per-trace ratio. */
const loopRows = computed(() =>
  scopedSignals.value
    .filter((s) => s.signal_type === "loop")
    .map((s) => ({
      // `agent` is the DISPLAY string (may be the "(unknown agent)" fallback);
      // `agentRaw` is the real value the drill-down must query on (null when the
      // rollup couldn't resolve an agent — the drawer then drops the agent
      // filter rather than searching for the literal fallback string).
      agent: s.agent_name ?? t("aiObservability.behavior.unknownAgent"),
      agentRaw: s.agent_name ?? null,
      tool: s.tool_name ?? "",
      calls: s.calls ?? 0,
      traces: s.distinct_traces ?? 0,
      ratio:
        s.distinct_traces && s.distinct_traces > 0
          ? Math.round(((s.calls ?? 0) / s.distinct_traces) * 100) / 100
          : 0,
    }))
    .sort((a, b) => b.ratio - a.ratio),
);

/** Failure rows: per (agent, class) with count. */
const failureRows = computed(() =>
  scopedSignals.value
    .filter((s) => s.signal_type === "failure")
    .map((s) => ({
      agent: s.agent_name ?? t("aiObservability.behavior.unknownAgent"),
      agentRaw: s.agent_name ?? null,
      failClass: s.fail_class ?? "unclassified",
      count: s.count ?? 0,
    }))
    .sort((a, b) => b.count - a.count),
);

const loopColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "agent",
    header: t("aiObservability.behavior.colAgent"),
    accessorKey: "agent",
    meta: { align: "left", autoWidth: true },
    sortable: true,
  },
  {
    id: "tool",
    header: t("aiObservability.behavior.colTool"),
    accessorKey: "tool",
    meta: { align: "left", autoWidth: true },
    sortable: true,
  },
  {
    id: "ratio",
    header: t("aiObservability.behavior.colRatio"),
    accessorKey: "ratio",
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "calls",
    header: t("aiObservability.behavior.colCalls"),
    accessorKey: "calls",
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "traces",
    header: t("aiObservability.behavior.colTraces"),
    accessorKey: "traces",
    meta: { align: "right" },
    sortable: true,
  },
]);

const failureColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "agent",
    header: t("aiObservability.behavior.colAgent"),
    accessorKey: "agent",
    meta: { align: "left", autoWidth: true },
    sortable: true,
  },
  {
    id: "failClass",
    header: t("aiObservability.behavior.colFailClass"),
    accessorKey: "failClass",
    meta: { align: "left", autoWidth: true },
    sortable: true,
  },
  {
    id: "count",
    header: t("aiObservability.behavior.colCount"),
    accessorKey: "count",
    meta: { align: "right" },
    sortable: true,
  },
]);

const fetchSignals = async () => {
  if (!orgId.value) return;
  loading.value = true;
  try {
    const res = await agentSignalsService.getAgentSignals(orgId.value, {
      start_time: props.startTime,
      end_time: props.endTime,
      source_stream: props.sourceStream,
    });
    signals.value = res.data?.signals ?? [];
  } catch {
    // Feature may be disabled (403) or stream not present yet — show empty state.
    signals.value = [];
  } finally {
    loading.value = false;
    lastRunAt.value = Date.now();
  }
};

onMounted(fetchSignals);
watch(() => [props.startTime, props.endTime, props.sourceStream, orgId.value], fetchSignals);

defineExpose({ refresh: fetchSignals, lastRunAt, loading });
</script>
