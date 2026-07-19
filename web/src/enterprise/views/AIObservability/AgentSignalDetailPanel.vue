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
  <ODrawer
    :open="open"
    side="right"
    size="lg"
    :title="title"
    data-test="agent-signal-detail-panel"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-6 p-4">
      <!-- Headline: the finding, stated plainly -->
      <div class="flex flex-col gap-1.5">
        <div class="text-sm text-text-primary" data-test="agent-signal-detail-headline">
          {{ headline }}
        </div>
        <div class="text-xs text-text-secondary">{{ explanation }}</div>
      </div>

      <!-- FAILURE: the real error messages (the "read it, know the fix" section) -->
      <div v-if="signalType === 'failure'" class="flex flex-col gap-2">
        <div class="text-sm font-semibold text-text-primary">
          {{ t("aiObservability.behavior.detail.errorsTitle") }}
        </div>
        <OTable
          data-test="agent-signal-detail-errors"
          :data="errorRows"
          :columns="errorColumns"
          :default-columns="false"
          :frame="false"
        />
        <OEmptyState
          v-if="!loading && errorRows.length === 0"
          preset="no-data"
          :title="t('aiObservability.behavior.detail.noErrors')"
        />
      </div>

      <!-- LOOP / COST: the worst traces, ranked by what makes them bad -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold text-text-primary">
            {{ tracesTitle }}
          </span>
          <span class="text-xs text-text-secondary">
            {{ t("aiObservability.behavior.detail.tracesHint") }}
          </span>
        </div>
        <OTable
          data-test="agent-signal-detail-traces"
          :data="traceRows"
          :columns="traceColumns"
          :default-columns="false"
          :frame="false"
          @row-click="openTrace"
        />
        <OEmptyState
          v-if="!loading && traceRows.length === 0"
          preset="no-data"
          :title="t('aiObservability.behavior.detail.noTraces')"
        />
      </div>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import searchService from "@/services/search";

interface SignalRow {
  signalType: "loop" | "failure" | "cost";
  agent?: string;
  tool?: string;
  failClass?: string;
  calls?: number;
  traces?: number;
  ratio?: number;
  count?: number;
  cost?: number;
  tokens?: number;
  errors?: number;
}

const props = defineProps<{
  open: boolean;
  row: SignalRow | null;
  sourceStream?: string;
  startTime?: number;
  endTime?: number;
}>();

const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();

const { t } = useI18n();
const store = useStore();
const router = useRouter();

const errorRows = ref<
  Array<{ message: string; occurrences: number; traces: number }>
>([]);
const traceRows = ref<Array<Record<string, any>>>([]);
const loading = ref(false);

const orgId = computed(
  () => store.state.selectedOrganization?.identifier as string,
);
const signalType = computed(() => props.row?.signalType);

const title = computed(() => {
  const r = props.row;
  if (!r) return t("aiObservability.behavior.detail.title");
  const agent = r.agent || t("aiObservability.behavior.unknownAgent");
  if (r.signalType === "loop") return `${agent} · ${r.tool ?? ""}`;
  if (r.signalType === "failure") return `${agent} · ${r.failClass ?? ""}`;
  return agent;
});

/** The finding, stated as a plain sentence a user can act on. */
const headline = computed(() => {
  const r = props.row;
  if (!r) return "";
  const agent = r.agent || t("aiObservability.behavior.unknownAgent");
  if (r.signalType === "loop") {
    return t("aiObservability.behavior.detail.loopHeadline", {
      agent,
      tool: r.tool ?? "",
      ratio: r.ratio ?? "?",
      calls: r.calls ?? "?",
      traces: r.traces ?? "?",
    });
  }
  if (r.signalType === "failure") {
    return t("aiObservability.behavior.detail.failHeadline", {
      agent,
      count: r.count ?? "?",
      cls: r.failClass ?? "",
    });
  }
  return t("aiObservability.behavior.detail.costHeadline", {
    agent,
    cost: r.cost ?? 0,
    tokens: r.tokens ?? 0,
    errors: r.errors ?? 0,
  });
});

const explanation = computed(() => {
  const r = props.row;
  if (!r) return "";
  if (r.signalType === "loop")
    return t("aiObservability.behavior.detail.loopExplain");
  if (r.signalType === "failure")
    return t("aiObservability.behavior.detail.failExplain");
  return t("aiObservability.behavior.detail.costExplain");
});

const tracesTitle = computed(() => {
  const r = props.row;
  if (r?.signalType === "loop")
    return t("aiObservability.behavior.detail.worstLoopTraces");
  if (r?.signalType === "cost")
    return t("aiObservability.behavior.detail.topCostTraces");
  return t("aiObservability.behavior.detail.tracesTitle");
});

// ── Error-message table (failure signals) ──────────────────────────────
const errorColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "message",
    header: t("aiObservability.behavior.detail.colError"),
    accessorKey: "message",
    meta: { align: "left", autoWidth: true },
  },
  {
    id: "occurrences",
    header: t("aiObservability.behavior.detail.colOccurrences"),
    accessorKey: "occurrences",
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

// ── Trace table — columns adapt to signal type so the value is visible ──
const traceColumns = computed<OTableColumnDef[]>(() => {
  const idCol: OTableColumnDef = {
    id: "trace_id",
    header: t("aiObservability.behavior.detail.colTraceId"),
    accessorKey: "trace_id",
    meta: { align: "left", autoWidth: true },
  };
  if (props.row?.signalType === "loop") {
    return [
      idCol,
      {
        id: "repeats",
        header: t("aiObservability.behavior.detail.colRepeats"),
        accessorKey: "repeats",
        meta: { align: "right" },
        sortable: true,
      },
    ];
  }
  if (props.row?.signalType === "cost") {
    return [
      idCol,
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
    ];
  }
  return [
    idCol,
    {
      id: "spans",
      header: t("aiObservability.behavior.detail.colSpans"),
      accessorKey: "spans",
      meta: { align: "right" },
      sortable: true,
    },
  ];
});

const agentFilter = (agent?: string) =>
  agent
    ? `(gen_ai_agent_name = '${agent}' OR service_name = '${agent}')`
    : "1=1";

const runQuery = async (sql: string): Promise<any[]> => {
  if (!orgId.value) return [];
  const now = Date.now() * 1000;
  const start = props.startTime ?? now - 24 * 60 * 60 * 1_000_000;
  const end = props.endTime ?? now;
  try {
    const res = await searchService.search({
      org_identifier: orgId.value,
      query: {
        query: { sql, start_time: start, end_time: end, from: 0, size: 50 },
      },
      page_type: "traces",
    });
    return res.data?.hits ?? [];
  } catch {
    return [];
  }
};

const fetchDetails = async () => {
  const r = props.row;
  if (!r || !props.sourceStream || !orgId.value) {
    errorRows.value = [];
    traceRows.value = [];
    return;
  }
  loading.value = true;
  const s = props.sourceStream;
  const af = agentFilter(r.agent);
  try {
    if (r.signalType === "failure") {
      // The real, grouped error messages behind this class — the actionable content.
      errorRows.value = (
        await runQuery(
          `SELECT status_message AS message, COUNT(*) AS occurrences, approx_distinct(trace_id) AS traces FROM "${s}" WHERE span_status = 'ERROR' AND ${af} AND status_message IS NOT NULL AND status_message != '' GROUP BY status_message ORDER BY occurrences DESC LIMIT 20`,
        )
      ).map((h: any) => ({
        message: h.message,
        occurrences: h.occurrences,
        traces: h.traces,
      }));
      traceRows.value = (
        await runQuery(
          `SELECT trace_id, COUNT(*) AS spans FROM "${s}" WHERE span_status = 'ERROR' AND ${af} GROUP BY trace_id ORDER BY spans DESC LIMIT 50`,
        )
      ).map((h: any) => ({ trace_id: h.trace_id, spans: h.spans }));
    } else if (r.signalType === "loop") {
      // Worst traces first — ranked by how many times the tool repeated.
      traceRows.value = (
        await runQuery(
          `SELECT trace_id, COUNT(*) AS repeats FROM "${s}" WHERE gen_ai_tool_name = '${r.tool}' AND gen_ai_operation_name = 'execute_tool' AND ${af} GROUP BY trace_id ORDER BY repeats DESC LIMIT 50`,
        )
      ).map((h: any) => ({ trace_id: h.trace_id, repeats: h.repeats }));
    } else {
      // Cost outliers — the traces driving this agent's spend.
      traceRows.value = (
        await runQuery(
          `SELECT trace_id, ROUND(SUM(gen_ai_usage_cost), 4) AS cost, SUM(gen_ai_usage_total_tokens) AS tokens FROM "${s}" WHERE ${af} AND gen_ai_usage_cost IS NOT NULL GROUP BY trace_id ORDER BY cost DESC LIMIT 50`,
        )
      ).map((h: any) => ({
        trace_id: h.trace_id,
        cost: h.cost,
        tokens: h.tokens,
      }));
    }
  } finally {
    loading.value = false;
  }
};

const openTrace = (row: { trace_id: string }) => {
  if (!row?.trace_id) return;
  router.push({
    name: "traceDetails",
    query: {
      stream: props.sourceStream,
      trace_id: row.trace_id,
      from: props.startTime,
      to: props.endTime,
      org_identifier: orgId.value,
    },
  });
};

watch(
  () => [props.open, props.row],
  () => {
    if (props.open && props.row) fetchDetails();
  },
);
</script>
