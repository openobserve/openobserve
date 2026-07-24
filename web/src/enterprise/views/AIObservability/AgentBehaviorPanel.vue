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
    <!-- Summary strip: behaviour signals at a glance (loops, failures, agents). -->
    <div class="shrink-0" data-test="agent-behavior-summary">
      <OStatStrip :items="behaviorStats" :loading="loading" />
    </div>
    <!-- Looping agents. Same card/header/table shape as the sibling LLM Insights
         panels (LLMErrorTable) so the whole page reads as one surface. -->
    <div
      class="bg-card-glass-bg rounded-default flex flex-col flex-1 min-h-0 overflow-hidden border border-border-default"
      data-test="agent-behavior-loops-card"
    >
      <PanelSectionHeader
        :title="t('aiObservability.behavior.loopsTitle')"
        :hint="t('aiObservability.behavior.loopsHint')"
        icon="restart-alt"
        tone="warning"
      />
      <OTable
        data-test="agent-behavior-loops-table"
        :data="loopRows"
        :columns="loopColumns"
        :default-columns="false"
        :frame="false"
        :show-global-filter="false"
        :row-class="loopRowClass"
        :footer-title="t('aiObservability.behavior.footerLoops')"
        class="flex-1 min-h-0"
        show-index
        pagination="client"
        :empty-message="loopsEmptyMessage"
        @row-click="(r: any) => openDetail('loop', r)"
      />
    </div>

    <!-- Failure taxonomy -->
    <div
      class="bg-card-glass-bg rounded-default flex flex-col flex-1 min-h-0 overflow-hidden border border-border-default"
      data-test="agent-behavior-failures-card"
    >
      <PanelSectionHeader
        :title="t('aiObservability.behavior.failuresTitle')"
        :hint="t('aiObservability.behavior.failuresHint')"
        icon="error-outline"
        tone="error"
      />
      <OTable
        data-test="agent-behavior-failures-table"
        :data="failureRows"
        :columns="failureColumns"
        :default-columns="false"
        :frame="false"
        :show-global-filter="false"
        :row-class="failureRowClass"
        :footer-title="t('aiObservability.behavior.footerFailures')"
        class="flex-1 min-h-0"
        show-index
        pagination="client"
        :empty-message="failuresEmptyMessage"
        @row-click="(r: any) => openDetail('failure', r)"
      >
        <template #cell-failClass="{ row }">
          <OTag variant="warning-soft" size="sm">{{ row.failClass }}</OTag>
        </template>
      </OTable>
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
import OTag from "@/lib/core/Badge/OTag.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import AgentSignalDetailPanel from "./AgentSignalDetailPanel.vue";
import PanelSectionHeader from "./PanelSectionHeader.vue";
import agentSignalsService, {
  type AgentSignalRecord,
} from "@/services/agent_signals";

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
const openDetail = (
  signalType: "loop" | "failure" | "cost",
  row: Record<string, any>,
) => {
  detailRow.value = { signalType, ...row };
  detailOpen.value = true;
};

// Highlight the row whose drawer is currently open, so the relationship
// "this row → this drawer" is visible at a glance (rather than a drawer that
// seems disconnected from the table).
const isActiveRow = (type: "loop" | "failure", row: any): boolean => {
  const d = detailRow.value;
  if (!detailOpen.value || !d || d.signalType !== type) return false;
  if ((d.agentRaw ?? null) !== (row.agentRaw ?? null)) return false;
  return type === "loop"
    ? d.tool === row.tool
    : d.failClass === row.failClass;
};
const loopRowClass = (row: any) =>
  isActiveRow("loop", row) ? "bg-table-row-selected-bg" : "";
const failureRowClass = (row: any) =>
  isActiveRow("failure", row) ? "bg-table-row-selected-bg" : "";

const orgId = computed(
  () => store.state.selectedOrganization?.identifier as string,
);

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

// Scope-aware empty text — when a single agent is selected, say so (and how to
// widen) so an agent with no signals reads as "nothing for THIS agent", not
// "the page is broken / where's my data".
const loopsEmptyMessage = computed(() =>
  props.agentFilter
    ? t("aiObservability.behavior.noLoopsForAgent", { agent: props.agentFilter })
    : t("aiObservability.behavior.noLoops"),
);
const failuresEmptyMessage = computed(() =>
  props.agentFilter
    ? t("aiObservability.behavior.noFailuresForAgent", {
        agent: props.agentFilter,
      })
    : t("aiObservability.behavior.noFailures"),
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

// Summary strip — at-a-glance behaviour signals. Loops draw attention (warning),
// failures are the exception (error), agents-affected is the scope (primary).
const behaviorStats = computed<StatItem[]>(() => {
  const loops = loopRows.value;
  const failures = failureRows.value;
  const agents = new Set(
    [...loops, ...failures].map((r) => r.agentRaw).filter(Boolean),
  );
  const totalFailures = failures.reduce((sum, f) => sum + (f.count || 0), 0);
  const has = loops.length + failures.length > 0;
  const v = (n: number): string | number => (has ? n : "—");
  return [
    {
      key: "loops",
      label: t("aiObservability.behavior.summaryLoops"),
      value: v(loops.length),
      icon: "restart-alt",
      tone: "warning",
      dataTest: "agent-behavior-summary-loops",
    },
    {
      key: "failures",
      label: t("aiObservability.behavior.summaryFailures"),
      value: v(totalFailures),
      icon: "error-outline",
      tone: "error",
      dataTest: "agent-behavior-summary-failures",
    },
    {
      key: "agents",
      label: t("aiObservability.behavior.summaryAgents"),
      value: v(agents.size),
      icon: "smart-toy",
      tone: "primary",
      dataTest: "agent-behavior-summary-agents",
    },
  ];
});

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
watch(
  () => [props.startTime, props.endTime, props.sourceStream, orgId.value],
  fetchSignals,
);

defineExpose({ refresh: fetchSignals, lastRunAt, loading });
</script>
