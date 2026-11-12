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
      <OStatStrip :items="behaviorStats" :loading="tableLoading" />
    </div>
    <div
      class="bg-card-glass-bg rounded-default border-border-default flex min-h-0 flex-1 flex-col overflow-hidden border"
      data-test="agent-behavior-loops-card"
    >
      <PanelSectionHeader
        :title="t('aiObservability.behavior.loopsTitle')"
        :hint="t('aiObservability.behavior.loopsHint')"
        icon="restart-alt"
        tone="warning"
      >
        <!-- The ai-agents alert pack, in one screen. -->
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            icon-left="notifications-active"
            data-test="agent-behavior-install-ai-alerts"
            @click="packOpen = true"
          >
            {{ t("aiAlertPack.open") }}
          </OButton>
        </template>
      </PanelSectionHeader>
      <OTable
        data-test="agent-behavior-loops-table"
        :data="loopRows"
        :columns="loopColumns"
        :loading="tableLoading"
        :default-columns="false"
        :frame="false"
        :show-global-filter="false"
        :row-class="loopRowClass"
        class="min-h-0 flex-1"
        show-index
        pagination="client"
        row-key="id"
        expansion="multiple"
        :get-row-expansion-enabled="(r: LoopRow) => r.variants.length > 1"
        :empty-message="loopsEmptyMessage"
        @row-click="(r: any) => openDetail('loop', r)"
      >
        <!-- An (agent, tool) in several env/versions: each variant opens the drawer alone. -->
        <template #expansion="{ row }">
          <OTable
            :data="row.variants"
            :columns="variantColumns"
            :default-columns="false"
            :frame="false"
            :fill-height="false"
            :show-global-filter="false"
            :row-class="loopRowClass"
            row-key="id"
            pagination="none"
            :data-test="`agent-behavior-loop-variants-${row.agent}-${row.tool}`"
            @row-click="(v: any) => openDetail('loop', v)"
          />
        </template>
        <!-- Repeated tool calls for this agent and tool, prefilled. -->
        <template #cell-alert="{ row }">
          <span @click.stop>
            <CreateAlertAction
              variant="icon"
              source="ai"
              :build="() => loopAlert(row)"
              :data-test="`agent-behavior-loop-create-alert-${row.agent}-${row.tool}`"
            />
          </span>
        </template>
      </OTable>
    </div>

    <!-- Failure taxonomy -->
    <div
      class="bg-card-glass-bg rounded-default border-border-default flex min-h-0 flex-1 flex-col overflow-hidden border"
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
        :loading="tableLoading"
        :default-columns="false"
        :frame="false"
        :show-global-filter="false"
        :row-class="failureRowClass"
        class="min-h-0 flex-1"
        show-index
        pagination="client"
        row-key="id"
        expansion="multiple"
        :get-row-expansion-enabled="(r: FailureRow) => r.variants.length > 1"
        :empty-message="failuresEmptyMessage"
        @row-click="(r: any) => openDetail('failure', r)"
      >
        <!-- An (agent, class) in several env/versions: each variant opens the drawer alone. -->
        <template #expansion="{ row }">
          <OTable
            :data="row.variants"
            :columns="failureVariantColumns"
            :default-columns="false"
            :frame="false"
            :fill-height="false"
            :show-global-filter="false"
            :row-class="failureRowClass"
            row-key="id"
            pagination="none"
            :data-test="`agent-behavior-failure-variants-${row.agent}-${row.failClass}`"
            @row-click="(v: any) => openDetail('failure', v)"
          />
        </template>
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
      :agent-env="detailScope.env"
      :agent-version="detailScope.version"
      explainable
      @send-to-ai-chat="(value: unknown, append?: boolean) => emit('sendToAiChat', value, append)"
    />
    <AiAlertPackDialog v-model:open="packOpen" :default-stream="sourceStream" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OTag from "@/lib/core/Badge/OTag.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import AgentSignalDetailPanel from "./AgentSignalDetailPanel.vue";
import PanelSectionHeader from "./PanelSectionHeader.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import CreateAlertAction from "@/components/alerts/CreateAlertAction.vue";
import AiAlertPackDialog from "@/components/alerts/AiAlertPackDialog.vue";
import { buildAiPrefill } from "@/utils/alerts/prefill/fromAi";
import agentSignalsService, { type AgentSignalRecord } from "@/services/agent_signals";
import {
  buildFailureRows,
  buildLoopRows,
  countAgents,
  matchesAgentScope,
  type DrillScope,
  type FailureRow,
  type LoopRow,
} from "./agentScope";

const props = defineProps<{
  startTime?: number;
  endTime?: number;
  sourceStream?: string;
  /** When set (Agent mode), show only this agent's signals; empty = all agents. */
  agentFilter?: string;
  /** Selected agent's env/version (Agent mode) — surfaced in the detail drawer. */
  agentEnv?: string | null;
  agentVersion?: string | null;
  scopeReady?: boolean;
}>();
const emit = defineEmits<{ (e: "sendToAiChat", value: unknown, append?: boolean): void }>();

const { t } = useI18nTyped();
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

// The drawer's env/version: a variant row's own; otherwise the page's agent scope.
const detailScope = computed<DrillScope>(
  () =>
    detailRow.value?.scope ?? {
      env: props.agentEnv ?? null,
      version: props.agentVersion ?? null,
    },
);

// Each row variant has its own id, so only the row whose drawer is open highlights.
const isActiveRow = (type: "loop" | "failure", row: any): boolean => {
  const d = detailRow.value;
  return !!detailOpen.value && !!d && d.signalType === type && d.id === row.id;
};
const loopRowClass = (row: any) => (isActiveRow("loop", row) ? "bg-table-row-selected-bg" : "");
const failureRowClass = (row: any) =>
  isActiveRow("failure", row) ? "bg-table-row-selected-bg" : "";

const orgId = computed(() => store.state.selectedOrganization?.identifier as string);

/** Signals scoped to the selected agent (Agent mode) or all agents (Stream mode). */
const scopedSignals = computed(() => {
  const a = props.agentFilter?.trim();
  if (!a) return signals.value;
  return signals.value.filter((s) =>
    matchesAgentScope(s, { name: a, env: props.agentEnv, version: props.agentVersion }),
  );
});

/** Loop rows: one per (agent, tool) over the range, ranked by calls per trace. */
const loopRows = computed<LoopRow[]>(() =>
  buildLoopRows(scopedSignals.value, t("aiObservability.behavior.unknownAgent")),
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

/** Failure rows: one per (agent, class) over the range, most frequent first. */
const failureRows = computed<FailureRow[]>(() =>
  buildFailureRows(scopedSignals.value, t("aiObservability.behavior.unknownAgent")),
);

// Summary strip — at-a-glance behaviour signals. Loops draw attention (warning),
// failures are the exception (error), agents-affected is the scope (primary).
const behaviorStats = computed<StatItem[]>(() => {
  const loops = loopRows.value;
  const failures = failureRows.value;
  const totalFailures = failures.reduce((sum, f) => sum + (f.count || 0), 0);
  const has = loops.length + failures.length > 0;
  const v = (n: number): string | number => (has ? n : "—");
  return [
    {
      key: "loops",
      label: t("aiObservability.behavior.summaryLoops"),
      value: v(countAgents(loops)),
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
      value: v(countAgents([...loops, ...failures])),
      icon: "smart-toy",
      tone: "primary",
      dataTest: "agent-behavior-summary-agents",
    },
  ];
});

// Identity columns share the leftover width and scroll below `minSize` rather than crush.
const identityColumn = { size: 136, minSize: 136 } as const;
const identityMeta = { align: "left", flex: true, autoWidth: true } as const;

const loopMetricColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "ratio",
    header: t("aiObservability.behavior.colRatio"),
    accessorKey: "ratio",
    // Fits the "Calls / trace" header beside its sort icon.
    size: 108,
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "calls",
    header: t("aiObservability.behavior.colCalls"),
    accessorKey: "calls",
    size: 76,
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "traces",
    header: t("aiObservability.behavior.colTraces"),
    accessorKey: "traces",
    size: 76,
    meta: { align: "right" },
    sortable: true,
  },
]);

const loopColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "agent",
    header: t("aiObservability.behavior.colAgent"),
    accessorKey: "agent",
    ...identityColumn,
    meta: identityMeta,
    sortable: true,
  },
  {
    id: "tool",
    header: t("aiObservability.behavior.colTool"),
    accessorKey: "tool",
    ...identityColumn,
    meta: identityMeta,
    sortable: true,
  },
  ...loopMetricColumns.value,
  // Not `actions`: that id reserves room for an "Actions" header this icon column does without.
  { id: "alert", header: raw(""), size: 52, meta: { align: "right" }, sortable: false },
]);

// Env and version of a variant row, shared by the loop and failure variants.
const variantScopeColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "env",
    header: t("aiObservability.scope.env"),
    accessorKey: "env",
    ...identityColumn,
    meta: {
      ...identityMeta,
      format: (v: string | null) => v ?? t("traces.agentNoEnv"),
    },
  },
  {
    id: "version",
    header: t("aiObservability.scope.version"),
    accessorKey: "version",
    ...identityColumn,
    meta: {
      ...identityMeta,
      format: (v: string | null) => v ?? t("traces.agentNoVersion"),
    },
  },
]);

const variantColumns = computed<OTableColumnDef[]>(() => [
  ...variantScopeColumns.value,
  ...loopMetricColumns.value,
]);

const packOpen = ref(false);
const loopAlert = (row: { agentRaw: string | null; tool: string }) =>
  buildAiPrefill({
    kind: "repeated_tool_calls",
    stream: props.sourceStream ?? "",
    agent: row.agentRaw,
    tool: row.tool || null,
  });

const failureColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "agent",
    header: t("aiObservability.behavior.colAgent"),
    accessorKey: "agent",
    ...identityColumn,
    meta: identityMeta,
    sortable: true,
  },
  {
    id: "failClass",
    header: t("aiObservability.behavior.colFailClass"),
    accessorKey: "failClass",
    ...identityColumn,
    meta: identityMeta,
    sortable: true,
  },
  failureCountColumn.value,
]);

const failureCountColumn = computed<OTableColumnDef>(() => ({
  id: "count",
  header: t("aiObservability.behavior.colCount"),
  accessorKey: "count",
  size: 76,
  meta: { align: "right" },
  sortable: true,
}));

const failureVariantColumns = computed<OTableColumnDef[]>(() => [
  ...variantScopeColumns.value,
  failureCountColumn.value,
]);

const tableLoading = computed(() => loading.value || props.scopeReady === false);

// A stream, org or range change refetches; only the latest call's answer lands.
let seq = 0;
const fetchSignals = async () => {
  if (!orgId.value || !props.sourceStream) return;
  const mine = ++seq;
  loading.value = true;
  try {
    const res = await agentSignalsService.getAgentSignals(orgId.value, {
      start_time: props.startTime,
      end_time: props.endTime,
      source_stream: props.sourceStream,
    });
    if (mine === seq) signals.value = res.data?.signals ?? [];
  } catch {
    // Feature may be disabled (403) or stream not present yet — show empty state.
    if (mine === seq) signals.value = [];
  } finally {
    if (mine === seq) {
      loading.value = false;
      lastRunAt.value = Date.now();
    }
  }
};

onMounted(fetchSignals);
watch(() => [props.startTime, props.endTime, props.sourceStream, orgId.value], fetchSignals);

defineExpose({ refresh: fetchSignals, lastRunAt, loading });
</script>
