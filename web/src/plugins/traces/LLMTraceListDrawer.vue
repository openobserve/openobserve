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
  <ODrawer
    :open="open"
    side="right"
    size="xl"
    :title="title"
    :sub-title="subtitle"
    :primary-button-label="canFilter ? t('llmInsightsDrill.filterToThis') : undefined"
    primary-button-data-test="llm-trace-list-filter"
    :secondary-button-label="t('traces.openInTraces')"
    data-test="llm-trace-list-drawer"
    @update:open="(v: boolean) => emit('update:open', v)"
    @click:primary="emit('filter', selection?.seriesValue ?? '')"
    @click:secondary="emit('open-in-traces')"
  >
    <div class="flex flex-col gap-2 p-3">
      <OTable
        :data="rows"
        :columns="columns"
        row-key="trace_id"
        :loading="loading"
        :show-global-filter="false"
        :fill-height="false"
        pagination="none"
        :empty-message="failed ? t('llmInsightsDrill.loadFailed') : t('llmInsightsDrill.empty')"
        data-test="llm-trace-list-table"
        @row-click="(row: any) => emit('view-trace', String(row.trace_id))"
      >
        <template #cell-trace="{ row }">
          <div class="flex min-w-0 flex-col">
            <OTruncatedText class="text-text-body text-compact">
              {{ row.question || row.trace_id }}
            </OTruncatedText>
            <span class="text-2xs text-text-secondary">
              {{ timestampToTimezoneDate(row.ts, timezone, rowTimeFormat) }}
              <template v-if="row.model"> · {{ row.model }}</template>
            </span>
          </div>
        </template>
        <template #cell-status="{ row }">
          <OTag type="sessionStatus" :value="row.status" />
        </template>
        <template #cell-cost="{ row }">
          {{ row.cost > 0 ? `$${Number(row.cost).toFixed(4)}` : "—" }}
        </template>
        <template #cell-duration="{ row }">
          {{ formatTimeWithSuffix(Number(row.duration_ns) / 1000) }}
        </template>
      </OTable>
      <span
        v-if="rows.length >= TRACE_LIST_LIMIT"
        class="text-2xs text-text-secondary"
        data-test="llm-trace-list-capped"
      >
        {{ t("llmInsightsDrill.capped", { n: TRACE_LIST_LIMIT }) }}
      </span>
    </div>
  </ODrawer>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { COL, type OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { timestampToTimezoneDate } from "@/utils/timezone";
import { formatTimeWithSuffix } from "@/utils/zincutils";
import { useLLMStreamQuery } from "./composables/useLLMStreamQuery";
import { messagesFromInput } from "./threadView.utils";
import { traceStatus } from "./llmTraceOutcome";
import { MODEL_SERIES_SQL } from "./config/llmInsightsPanels";
import {
  TRACE_LIST_LIMIT,
  traceListSql,
  traceRowTimeFormat,
  type TraceListSelection,
} from "./llmInsightsDrill";
import { streamHasParentSpan } from "./llmStreamColumns";

const props = defineProps<{
  open: boolean;
  stream: string;
  /** The page's bare scope predicate (agent + filters). */
  scope: string;
  selection: TraceListSelection | null;
  title: I18nText;
  subtitle?: I18nText;
}>();
const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
  (e: "view-trace", traceId: string): void;
  (e: "filter", model: string): void;
  (e: "open-in-traces"): void;
}>();

const { t } = useI18nTyped();
const store = useStore();
const timezone = computed(() => store.state.timezone || "UTC");
const rowTimeFormat = computed(() => traceRowTimeFormat(props.selection, timezone.value));
const { executeQuery, cancelAll } = useLLMStreamQuery();

const rows = ref<any[]>([]);
const loading = ref(false);
const failed = ref(false);
let seq = 0;

const canFilter = computed(
  () => props.selection?.seriesSql === MODEL_SERIES_SQL && !!props.selection?.seriesValue,
);

const columns: OTableColumnDef[] = [
  { id: "trace", header: t("llmInsightsDrill.trace"), meta: { align: "left", flex: true } },
  {
    id: "status",
    header: t("common.status"),
    accessorKey: "status",
    size: COL.status,
    meta: { align: "left" },
  },
  { id: "cost", header: t("llmInsightsDrill.cost"), size: COL.price, meta: { align: "right" } },
  {
    id: "duration",
    header: t("llmInsightsDrill.duration"),
    size: COL.duration,
    meta: { align: "right" },
  },
];

function firstQuestion(input: unknown): string {
  return messagesFromInput(input).find((m) => m.role === "user" && m.content)?.content ?? "";
}

async function load() {
  const sel = props.selection;
  if (!props.open || !sel || !props.stream) return;
  const mine = ++seq;
  loading.value = true;
  failed.value = false;
  try {
    const org = store.state.selectedOrganization.identifier;
    const hasParentSpan = await streamHasParentSpan(org, props.stream);
    if (mine !== seq) return;
    const hits = (await executeQuery(
      traceListSql(props.stream, sel, props.scope, hasParentSpan),
      sel.startTime,
      sel.endTime,
    )) as any[];
    if (mine !== seq) return;
    rows.value = hits.map((h) => ({
      ...h,
      question: firstQuestion(h.input),
      status: traceStatus(h.error_spans),
    }));
  } catch (e) {
    if (mine !== seq) return;
    rows.value = [];
    failed.value = true;
    console.error("[LLM trace list] fetch error", e);
  } finally {
    if (mine === seq) loading.value = false;
  }
}

watch(() => [props.open, props.selection, props.scope, props.stream], load, { immediate: true });
watch(
  () => props.open,
  (open) => {
    if (!open) cancelAll();
  },
);
</script>
