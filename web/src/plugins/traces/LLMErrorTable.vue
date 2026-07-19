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
    class="bg-card-glass-bg llm-trend-panel rounded-default flex flex-col overflow-hidden border border-border-default"
  >
    <!-- Padding lives on the header only, so the table spans edge-to-edge
         (no left/right/bottom inset) and sits flush within the card. -->
    <div
      class="flex items-baseline justify-between mb-2 px-4 pt-4"
    >
      <div>
        <div
          class="text-sm font-semibold text-text-heading"
        >
          {{ displayTitle }}
        </div>
        <div
          v-if="displaySubtitle"
          class="text-2xs leading-normal mt-[0.1rem]"
        >
          {{ displaySubtitle }}
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
      :empty-message="panel.emptyStateText || t('traces.lLMErrorTable.noData')"
      @row-click="onRowClick"
      data-test="llm-recent-errors-table"
      class="w-full"
    >
      <!-- Time needs timezone formatting, so it keeps a cell template — but no
           text styling: it inherits OTable's default cell text like every other
           table. -->
      <template #cell-time="{ value }">
        {{ timestampToTimezoneDate(value, timezone, "yyyy-MM-dd HH:mm:ss") }}
      </template>

      <!-- Operation is the one cell we colour — it names the failed span, so it
           reads in the error colour. -->
      <template #cell-operation="{ value }">
        <span class="text-error-600">{{ value }}</span>
      </template>

      <!-- Trace id: only a title for the full value on hover; default text. -->
      <template #cell-trace_id="{ value }">
        <span :title="value">{{ value }}</span>
      </template>
    </OTable>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import {
  type LLMPanelDef,
  renderPanelSql,
  panelI18nKey,
} from "./config/llmInsightsPanels";
import { useLLMStreamQuery } from "./composables/useLLMStreamQuery";
import { timestampToTimezoneDate } from "@/utils/timezone";
// Shared in-memory cache (module singleton) — survives this table's remount on
// every tab toggle, so returning to a selection restores instantly. See
// llmInsightsCache.ts for why it lives there and not in component state.
import { errorRowsCache } from "./llmInsightsCache";

interface Props {
  panel: LLMPanelDef;
  streamName: string;
  // epoch microseconds (same units the trend panels receive)
  startTime: number;
  endTime: number;
  // Bare agent predicate (no leading AND); "" = All Agents. Used to
  // build the SQL — NOT the cache key (that's `cacheKey`).
  agentFilter?: string;
  // The page's canonical selection id (`stream::agent::window`, built once in
  // the dashboard from the agent NAME). We key the row cache on this so the
  // table agrees with the KPI strip + chart panels on one identity, instead of
  // deriving its own from the SQL filter.
  cacheKey?: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "view-trace", traceId: string): void;
}>();

const { t } = useI18n();

// Title/subtitle come from the en.json `aiObservability.panels.<id>` copy.
const displayTitle = computed(() => t(`${panelI18nKey(props.panel.id)}.title`));
const displaySubtitle = computed(() =>
  t(`${panelI18nKey(props.panel.id)}.subtitle`),
);

const store = useStore();
const { executeQuery } = useLLMStreamQuery();

const timezone = computed(() => store.state.timezone || "UTC");

const rows = ref<any[]>([]);
const loading = ref(false);

const columns = [
  {
    id: "time",
    header: t("traces.lLMErrorTable.time"),
    accessorKey: "_timestamp",
    sortable: false,
    size: COL.createdAt,
    meta: { align: "left" },
  },
  {
    id: "service",
    header: t("traces.lLMErrorTable.service"),
    accessorKey: "service_name",
    sortable: false,
    // Half the usual stream-name width — service names here are short.
    size: COL.streamName / 2,
    meta: { align: "left" },
  },
  {
    id: "operation",
    header: t("traces.lLMErrorTable.operation"),
    accessorKey: "operation",
    sortable: false,
    // Numeric size + flex: fills the leftover width and stays resizable.
    size: COL.description,
    meta: { align: "left", flex: true },
  },
  {
    id: "trace_id",
    header: t("traces.lLMErrorTable.traceId"),
    accessorKey: "trace_id",
    sortable: false,
    size: COL.url,
    meta: { align: "left" },
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
  // Serve this exact selection+window from the in-memory cache if we have it —
  // a tab toggle back here skips the query entirely. Keyed on the dashboard's
  // canonical selection id (`cacheKey`); skip caching only if it wasn't passed.
  const key = props.cacheKey;
  if (key) {
    const cached = errorRowsCache.get(key);
    if (cached) {
      rows.value = cached;
      return;
    }
  }
  loading.value = true;
  // No histogram here, so the interval is unused; renderPanelSql still
  // substitutes the stream and splices the agent predicate.
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
    // Snapshot for this selection+window so a return visit restores instantly.
    if (key) errorRowsCache.set(key, rows.value);
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
