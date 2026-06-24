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

<!--
  LLMErrorTable — the "Recent errors" panel, rendered with the shared OTable
  (the same component the Dashboards list uses) rather than PanelSchemaRenderer.

  Why OTable and not the dashboard table: this panel is interactive and
  app-specific — a row click navigates to the trace-details page — and it must
  match the other AI Observability tables (Quality, Eval Jobs, Scorers), which
  are all OTable. Dashboard tables render plain cells and can't drive app
  navigation. The trend/chart panels use PanelSchemaRenderer; tables use OTable.

  Data is fetched directly (last 10 error spans) via useLLMStreamQuery — the
  same stream query the trend panels use — with the agent filter applied.
-->
<template>
  <div
    ref="rootEl"
    class="card-container llm-trend-panel tw:rounded-lg tw:flex tw:flex-col tw:overflow-hidden"
  >
    <!-- Padding lives on the header only, so the table spans edge-to-edge
         (no left/right/bottom inset) and sits flush within the card. -->
    <div
      class="tw:flex tw:items-baseline tw:justify-between tw:mb-[0.5rem] tw:px-[1rem] tw:pt-[1rem]"
    >
      <div>
        <div
          class="tw:text-[0.85rem] tw:font-semibold tw:text-[var(--o2-text-primary)]"
        >
          {{ panel.title }}
        </div>
        <div
          v-if="panel.subtitle"
          class="tw:text-[0.7rem] tw:text-[var(--o2-text-muted)] tw:mt-[0.1rem]"
        >
          {{ panel.subtitle }}
        </div>
      </div>
    </div>

    <OTable
      :data="rows"
      :columns="columns"
      row-key="id"
      :loading="loading"
      :show-global-filter="false"
      :fill-height="false"
      :enable-column-resize="true"
      :persist-columns="true"
      table-id="llm-recent-errors"
      show-index
      pagination="none"
      :empty-message="panel.emptyStateText || 'No data'"
      @row-click="onRowClick"
      data-test="llm-recent-errors-table"
      class="tw:w-full"
    >
      <template #cell-time="{ value }">
        <span class="tw:text-[var(--o2-text-secondary)]">{{
          timestampToTimezoneDate(value, timezone, "yyyy-MM-dd HH:mm:ss")
        }}</span>
      </template>

      <template #cell-service="{ value }">
        <span class="llm-err__chip">
          <span
            class="llm-err__chip-dot"
            :style="{ background: chipColor(value) }"
          />
          <span class="tw:truncate">{{ value }}</span>
        </span>
      </template>

      <template #cell-operation="{ value }">
        <span class="tw:text-[var(--o2-status-error-text)] tw:font-medium">
          <span class="tw:mr-[0.25rem]">×</span>{{ value }}
        </span>
      </template>

      <template #cell-trace_id="{ value }">
        <span class="llm-err__mono tw:truncate" :title="value">{{ value }}</span>
      </template>

      <template #cell-view="{ row }">
        <a
          href="#"
          class="tw:text-[var(--q-primary)] tw:font-medium tw:no-underline hover:tw:underline"
          @click.prevent.stop="emit('view-trace', String(row.trace_id || ''))"
        >
          View →
        </a>
      </template>
    </OTable>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useStore } from "vuex";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import {
  type LLMPanelDef,
  renderPanelSql,
} from "./config/llmInsightsPanels";
import { useLLMStreamQuery } from "./composables/useLLMStreamQuery";
import { chipColor } from "./llmTrendPanel.utils";
import { timestampToTimezoneDate } from "@/utils/timezone";

interface Props {
  panel: LLMPanelDef;
  streamName: string;
  // epoch microseconds (same units the trend panels receive)
  startTime: number;
  endTime: number;
  // Bare agent trace-id predicate (no leading AND); "" = All Agents.
  agentFilter?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "view-trace", traceId: string): void;
}>();

const store = useStore();
const { executeQuery } = useLLMStreamQuery();

const timezone = computed(() => store.state.timezone || "UTC");

const rows = ref<any[]>([]);
const loading = ref(false);

const columns = [
  {
    id: "time",
    header: "Time",
    accessorKey: "_timestamp",
    sortable: false,
    size: COL.createdAt,
    meta: { align: "left" },
  },
  {
    id: "service",
    header: "Service",
    accessorKey: "service_name",
    sortable: false,
    size: COL.streamName,
    meta: { align: "left" },
  },
  {
    id: "operation",
    header: "Operation",
    accessorKey: "operation",
    sortable: false,
    // Numeric size + flex: fills the leftover width and stays resizable.
    size: COL.description,
    meta: { align: "left", flex: true },
  },
  {
    id: "trace_id",
    header: "Trace ID",
    accessorKey: "trace_id",
    sortable: false,
    size: COL.url,
    meta: { align: "left" },
  },
  {
    id: "view",
    header: "",
    accessorKey: "trace_id",
    sortable: false,
    size: 80,
    meta: { align: "right" },
  },
];

function onRowClick(row: any) {
  emit("view-trace", String(row?.trace_id || ""));
}

async function loadErrors() {
  if (!props.streamName || !props.startTime || !props.endTime) return;
  // Mark the current inputs as loaded so re-entering the viewport (scrolling
  // away and back) doesn't refetch — only an input change sets this true again.
  needsReload.value = false;
  loading.value = true;
  // No histogram here, so the interval is unused; renderPanelSql still
  // substitutes the stream and splices the agent trace-id predicate.
  const sql = renderPanelSql(props.panel.query.sql, {
    stream: props.streamName,
    startTime: props.startTime,
    endTime: props.endTime,
    interval: "",
    agentFilter: props.agentFilter,
  });
  try {
    const hits = await executeQuery(sql, props.startTime, props.endTime);
    // OTable needs a stable row-key; error spans can repeat a trace_id, so key
    // by position instead.
    rows.value = (hits as any[]).map((h, i) => ({ ...h, id: i }));
  } catch (e: any) {
    rows.value = [];
    console.error(`[LLM panel ${props.panel.id}] fetch error`, e);
  } finally {
    loading.value = false;
  }
}

// Lazy-load: this panel sits below the fold (full-width, bottom of the grid).
// Defer the query until it scrolls into view, then refetch on input changes.
// `needsReload` guards against refetching every time the panel re-enters the
// viewport (scrolling back and forth) — only an input change re-arms it.
const rootEl = ref<HTMLElement | null>(null);
const isVisible = ref(false);
const needsReload = ref(true);
let observer: IntersectionObserver | null = null;

watch(
  () => [props.streamName, props.startTime, props.endTime, props.agentFilter],
  () => {
    needsReload.value = true;
    if (isVisible.value) loadErrors();
  },
);

watch(isVisible, (visible) => {
  if (visible && needsReload.value) loadErrors();
});

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      isVisible.value = entries[0].isIntersecting;
    },
    { root: null, rootMargin: "200px", threshold: 0 },
  );
  setTimeout(() => {
    if (rootEl.value) observer?.observe(rootEl.value);
  }, 0);
});

onUnmounted(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<style lang="scss" scoped>
.llm-trend-panel {
  border: 1px solid var(--o2-border-color);
}

.llm-err__mono {
  font-family: var(--o2-font-mono, monospace);
  font-size: 0.75rem;
  display: inline-block;
  max-width: 100%;
}

.llm-err__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  background: var(--o2-bg-3);
  font-size: 0.7rem;
  max-width: 100%;
}

.llm-err__chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}
</style>
