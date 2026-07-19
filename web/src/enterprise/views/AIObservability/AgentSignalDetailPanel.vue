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
      <!-- What this row represents -->
      <div class="flex flex-col gap-2">
        <div class="text-sm font-semibold text-text-primary">
          {{ t("aiObservability.behavior.detail.summary") }}
        </div>
        <div class="flex flex-col gap-1.5 text-sm">
          <div
            v-for="field in summaryFields"
            :key="field.label"
            class="flex justify-between gap-4"
          >
            <span class="text-text-secondary">{{ field.label }}</span>
            <span class="text-text-primary font-medium text-right break-all">
              {{ field.value }}
            </span>
          </div>
        </div>
        <div class="text-xs text-text-secondary mt-1">
          {{ explanation }}
        </div>
      </div>

      <!-- The underlying traces -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-sm font-semibold text-text-primary">
            {{ t("aiObservability.behavior.detail.tracesTitle") }}
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

/** The clicked Behavior row + which signal kind it came from. */
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

const traceRows = ref<Array<{ trace_id: string; spans: number; when: number }>>(
  [],
);
const loading = ref(false);

const orgId = computed(
  () => store.state.selectedOrganization?.identifier as string,
);

const title = computed(() => {
  const r = props.row;
  if (!r) return t("aiObservability.behavior.detail.title");
  if (r.signalType === "loop")
    return `${r.agent ?? ""} · ${r.tool ?? ""}`;
  if (r.signalType === "failure")
    return `${r.agent ?? ""} · ${r.failClass ?? ""}`;
  return r.agent ?? t("aiObservability.behavior.detail.title");
});

const summaryFields = computed(() => {
  const r = props.row;
  if (!r) return [];
  const f: Array<{ label: string; value: string }> = [
    { label: t("aiObservability.behavior.colAgent"), value: r.agent ?? "—" },
  ];
  if (r.signalType === "loop") {
    f.push({ label: t("aiObservability.behavior.colTool"), value: r.tool ?? "—" });
    f.push({
      label: t("aiObservability.behavior.colRatio"),
      value: String(r.ratio ?? "—"),
    });
    f.push({
      label: t("aiObservability.behavior.colCalls"),
      value: String(r.calls ?? "—"),
    });
    f.push({
      label: t("aiObservability.behavior.colTraces"),
      value: String(r.traces ?? "—"),
    });
  } else if (r.signalType === "failure") {
    f.push({
      label: t("aiObservability.behavior.colFailClass"),
      value: r.failClass ?? "—",
    });
    f.push({
      label: t("aiObservability.behavior.colCount"),
      value: String(r.count ?? "—"),
    });
  } else {
    f.push({
      label: t("aiObservability.behavior.colCost"),
      value: String(r.cost ?? "—"),
    });
    f.push({
      label: t("aiObservability.behavior.colTokens"),
      value: String(r.tokens ?? "—"),
    });
    f.push({
      label: t("aiObservability.behavior.colErrors"),
      value: String(r.errors ?? "—"),
    });
  }
  return f;
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

const traceColumns = computed<OTableColumnDef[]>(() => [
  {
    id: "trace_id",
    header: t("aiObservability.behavior.detail.colTraceId"),
    accessorKey: "trace_id",
    meta: { align: "left", autoWidth: true },
    sortable: true,
  },
  {
    id: "spans",
    header: t("aiObservability.behavior.detail.colSpans"),
    accessorKey: "spans",
    meta: { align: "right" },
    sortable: true,
  },
]);

/** WHERE clause that isolates the spans behind this signal row. */
const buildWhere = (r: SignalRow): string => {
  const clauses: string[] = [];
  if (r.agent)
    clauses.push(
      `(gen_ai_agent_name = '${r.agent}' OR service_name = '${r.agent}')`,
    );
  if (r.signalType === "loop" && r.tool)
    clauses.push(
      `gen_ai_tool_name = '${r.tool}' AND gen_ai_operation_name = 'execute_tool'`,
    );
  if (r.signalType === "failure") clauses.push(`span_status = 'ERROR'`);
  return clauses.length ? clauses.join(" AND ") : "1=1";
};

const fetchTraces = async () => {
  const r = props.row;
  if (!r || !props.sourceStream || !orgId.value) {
    traceRows.value = [];
    return;
  }
  loading.value = true;
  const where = buildWhere(r);
  const sql = `SELECT trace_id, COUNT(*) AS spans, MIN(_timestamp) AS when FROM "${props.sourceStream}" WHERE ${where} GROUP BY trace_id ORDER BY spans DESC LIMIT 50`;
  const now = Date.now() * 1000;
  const start = props.startTime ?? now - 24 * 60 * 60 * 1_000_000;
  const end = props.endTime ?? now;
  try {
    const res = await searchService.search({
      org_identifier: orgId.value,
      query: {
        query: {
          sql,
          start_time: start,
          end_time: end,
          from: 0,
          size: 50,
        },
      },
      page_type: "traces",
    });
    traceRows.value = (res.data?.hits ?? []).map((h: any) => ({
      trace_id: h.trace_id,
      spans: h.spans,
      when: h.when,
    }));
  } catch {
    traceRows.value = [];
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
    if (props.open && props.row) fetchTraces();
  },
);
</script>
