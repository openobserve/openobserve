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
<!--
  Agent-scoped behavior signals shown INSIDE the Agent Graph node drawer.

  This is the §4b cross-link from the Agent Signals functional design: clicking
  an agent node in Agent Graph surfaces that one agent's loop + failure health
  (and a cost headline — a KPI, not a table), reusing the same _agent_signals
  rollup and the same AgentSignalDetailPanel drill-down the Agent Behavior page
  uses. It is a per-node health lens, never topology.

  Scope: this component queries all signals for the org/stream/window (bounded —
  a few agents × classes/tools) and filters to the one clicked agent. Row click
  opens the existing detail drawer scoped to that signal.
-->
<template>
  <div class="flex flex-col gap-4 p-1" data-test="agent-node-behavior-tab">
    <!-- Cost headline: a KPI line, not a table (design §2 keeps cost out of the
         behavior tables — it stays a summary stat). -->
    <div
      v-if="costSummary"
      class="text-text-secondary flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
      data-test="agent-node-behavior-cost"
    >
      <span>
        {{ t("aiObservability.behavior.node.cost") }}:
        <span class="text-text-heading font-semibold">{{ costSummary.cost }}</span>
      </span>
      <span>
        {{ t("aiObservability.behavior.colTokens") }}:
        <span class="text-text-heading font-semibold">{{ costSummary.tokens }}</span>
      </span>
      <span v-if="costSummary.errors">
        {{ t("aiObservability.behavior.colErrors") }}:
        <span class="text-text-heading font-semibold">{{ costSummary.errors }}</span>
      </span>
    </div>

    <!-- Looping tools for this agent -->
    <div class="flex flex-col gap-1.5">
      <div class="text-text-heading text-xs font-semibold">
        {{ t("aiObservability.behavior.loopsTitle") }}
      </div>
      <OTable
        data-test="agent-node-behavior-loops"
        :data="loopRows"
        :columns="loopColumns"
        :default-columns="false"
        :frame="false"
        :show-global-filter="false"
        :fill-height="false"
        pagination="client"
        :page-size="5"
        :empty-message="t('aiObservability.behavior.noLoops')"
        @row-click="(r: any) => openDetail('loop', r)"
      />
    </div>

    <!-- Failure classes for this agent -->
    <div class="flex flex-col gap-1.5">
      <div class="text-text-heading text-xs font-semibold">
        {{ t("aiObservability.behavior.failuresTitle") }}
      </div>
      <OTable
        data-test="agent-node-behavior-failures"
        :data="failureRows"
        :columns="failureColumns"
        :default-columns="false"
        :frame="false"
        :show-global-filter="false"
        :fill-height="false"
        pagination="client"
        :page-size="5"
        :empty-message="t('aiObservability.behavior.noFailures')"
        @row-click="(r: any) => openDetail('failure', r)"
      >
        <template #cell-failClass="{ row }">
          <OTag variant="warning-soft" size="sm">{{ row.failClass }}</OTag>
        </template>
      </OTable>
    </div>

    <div
      v-if="disabledHint"
      class="text-text-secondary text-xs italic"
      data-test="agent-node-behavior-disabled"
    >
      {{ disabledHint }}
    </div>

    <!-- Reuses the same drill-down drawer as the Agent Behavior page. -->
    <AgentSignalDetailPanel
      v-model:open="detailOpen"
      :row="detailRow"
      :source-stream="sourceStream"
      :start-time="startTime"
      :end-time="endTime"
      :agent-env="nodeScope.env"
      :agent-version="nodeScope.version"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import AgentSignalDetailPanel from "./AgentSignalDetailPanel.vue";
import { formatTokens } from "@/utils/llmUtils";
import agentSignalsService, { type AgentSignalRecord } from "@/services/agent_signals";
import { buildFailureRows, buildLoopRows, matchesAgentScope } from "./agentScope";

const props = defineProps<{
  /** The clicked agent's resolved name (from the graph node identity). */
  agentName: string;
  sourceStream?: string;
  startTime?: number;
  endTime?: number;
  /** Agent Graph's Agent-mode selection; applies when it is this node's agent. */
  agentScope?: { name: string; env: string | null; version: string | null } | null;
}>();

const { t } = useI18nTyped();
const store = useStore();

const signals = ref<AgentSignalRecord[]>([]);
const disabledHint = ref("");

const detailOpen = ref(false);
const detailRow = ref<any>(null);

const orgId = computed(() => store.state.selectedOrganization?.identifier as string);

/** The page's env/version when the clicked node is that agent, else null. */
const nodeScope = computed(() =>
  props.agentScope && props.agentScope.name === props.agentName
    ? { env: props.agentScope.env, version: props.agentScope.version }
    : { env: null, version: null },
);

/** This agent's signals at the page's env/version; names are the scoping key since drawer and page resolve them alike. */
const mySignals = computed(() =>
  signals.value.filter((s) => matchesAgentScope(s, { name: props.agentName, ...nodeScope.value })),
);

// One row per tool / failure class over the range, as on the Agent Behavior page.
const loopRows = computed(() =>
  buildLoopRows(mySignals.value, t("aiObservability.behavior.unknownAgent")),
);

const failureRows = computed(() =>
  buildFailureRows(mySignals.value, t("aiObservability.behavior.unknownAgent")),
);

/** Cost is a headline summary, not a table (design §2). */
const costSummary = computed(() => {
  // One cost row per hourly window × env × version: total them over the range.
  const rows = mySignals.value.filter((s) => s.signal_type === "cost");
  if (!rows.length) return null;
  const hasCost = rows.some((s) => s.cost != null);
  const sum = (key: "cost" | "tokens" | "errors") =>
    rows.reduce((acc, s) => acc + Number(s[key] ?? 0), 0);
  return {
    cost: hasCost ? `$${sum("cost").toFixed(2)}` : "—",
    tokens: formatTokens(sum("tokens")),
    errors: sum("errors"),
  };
});

const openDetail = (signalType: "loop" | "failure", row: Record<string, any>) => {
  detailRow.value = { signalType, ...row };
  detailOpen.value = true;
};

const loopColumns = computed<OTableColumnDef[]>(() => [
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
    id: "traces",
    header: t("aiObservability.behavior.colTraces"),
    accessorKey: "traces",
    meta: { align: "right" },
    sortable: true,
  },
]);

const failureColumns = computed<OTableColumnDef[]>(() => [
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

// Picking another node or range refetches; only the latest call's answer lands.
let seq = 0;
const fetchSignals = async () => {
  const mine = ++seq;
  if (!orgId.value || !props.sourceStream || !props.agentName) {
    signals.value = [];
    return;
  }
  try {
    const res = await agentSignalsService.getAgentSignals(orgId.value, {
      start_time: props.startTime,
      end_time: props.endTime,
      source_stream: props.sourceStream,
    });
    if (mine !== seq) return;
    signals.value = res.data?.signals ?? [];
    disabledHint.value = "";
  } catch {
    if (mine !== seq) return;
    // 403 = feature/flag off for this deployment, or stream absent — name the
    // config choice rather than showing a blank tab (design FR-6.5).
    signals.value = [];
    disabledHint.value = t("aiObservability.behavior.node.disabled");
  }
};

watch(
  () => [props.agentName, props.sourceStream, props.startTime, props.endTime, orgId.value],
  fetchSignals,
  { immediate: true },
);
</script>
