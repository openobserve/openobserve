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
  <div class="flex flex-col gap-6" data-test="agent-behavior-panel">
    <!-- Looping agents -->
    <div class="card-container flex flex-col">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-border-normal">
        <span class="text-sm font-semibold text-text-primary">
          {{ t("aiObservability.behavior.loopsTitle") }}
        </span>
        <span class="text-xs text-text-secondary">
          {{ t("aiObservability.behavior.loopsHint") }}
        </span>
      </div>
      <OTable
        data-test="agent-behavior-loops-table"
        :data="loopRows"
        :columns="loopColumns"
        :default-columns="false"
        :frame="false"
      />
      <OEmptyState
        v-if="!loading && loopRows.length === 0"
        preset="no-data"
        :title="t('aiObservability.behavior.noLoops')"
      />
    </div>

    <!-- Failure taxonomy -->
    <div class="card-container flex flex-col">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-border-normal">
        <span class="text-sm font-semibold text-text-primary">
          {{ t("aiObservability.behavior.failuresTitle") }}
        </span>
        <span class="text-xs text-text-secondary">
          {{ t("aiObservability.behavior.failuresHint") }}
        </span>
      </div>
      <OTable
        data-test="agent-behavior-failures-table"
        :data="failureRows"
        :columns="failureColumns"
        :default-columns="false"
        :frame="false"
      />
      <OEmptyState
        v-if="!loading && failureRows.length === 0"
        preset="no-data"
        :title="t('aiObservability.behavior.noFailures')"
      />
    </div>

    <!-- Cost & failure per agent -->
    <div class="card-container flex flex-col">
      <div class="flex items-center gap-2 px-4 py-3 border-b border-border-normal">
        <span class="text-sm font-semibold text-text-primary">
          {{ t("aiObservability.behavior.costTitle") }}
        </span>
        <span class="text-xs text-text-secondary">
          {{ t("aiObservability.behavior.costHint") }}
        </span>
      </div>
      <OTable
        data-test="agent-behavior-cost-table"
        :data="costRows"
        :columns="costColumns"
        :default-columns="false"
        :frame="false"
      />
      <OEmptyState
        v-if="!loading && costRows.length === 0"
        preset="no-data"
        :title="t('aiObservability.behavior.noCost')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import agentSignalsService, {
  type AgentSignalRecord,
} from "@/services/agent_signals";

const props = defineProps<{
  startTime?: number;
  endTime?: number;
  sourceStream?: string;
}>();

const { t } = useI18n();
const store = useStore();

const signals = ref<AgentSignalRecord[]>([]);
const loading = ref(false);

const orgId = computed(
  () => store.state.selectedOrganization?.identifier as string,
);

/** Loop rows: rank (agent, tool) by calls-per-trace ratio. */
const loopRows = computed(() =>
  signals.value
    .filter((s) => s.signal_type === "loop")
    .map((s) => ({
      agent: s.agent_name ?? t("aiObservability.behavior.unknownAgent"),
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
  signals.value
    .filter((s) => s.signal_type === "failure")
    .map((s) => ({
      agent: s.agent_name ?? t("aiObservability.behavior.unknownAgent"),
      failClass: s.fail_class ?? "unclassified",
      count: s.count ?? 0,
    }))
    .sort((a, b) => b.count - a.count),
);

/** Cost rows: per agent, cost + tokens + errors. */
const costRows = computed(() =>
  signals.value
    .filter((s) => s.signal_type === "cost")
    .map((s) => ({
      agent: s.agent_name ?? t("aiObservability.behavior.unknownAgent"),
      cost: s.cost ?? 0,
      tokens: s.tokens ?? 0,
      errors: s.errors ?? 0,
    }))
    .sort((a, b) => b.cost - a.cost),
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

const costColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "agent",
    header: t("aiObservability.behavior.colAgent"),
    accessorKey: "agent",
    meta: { align: "left", autoWidth: true },
    sortable: true,
  },
  {
    id: "cost",
    header: t("aiObservability.behavior.colCost"),
    accessorKey: "cost",
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "tokens",
    header: t("aiObservability.behavior.colTokens"),
    accessorKey: "tokens",
    meta: { align: "right" },
    sortable: true,
  },
  {
    id: "errors",
    header: t("aiObservability.behavior.colErrors"),
    accessorKey: "errors",
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
  }
};

onMounted(fetchSignals);
watch(
  () => [props.startTime, props.endTime, props.sourceStream, orgId.value],
  fetchSignals,
);

defineExpose({ refresh: fetchSignals });
</script>
