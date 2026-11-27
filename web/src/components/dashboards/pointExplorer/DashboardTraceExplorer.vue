<!-- Copyright 2026 OpenObserve Inc.
SPDX-License-Identifier: AGPL-3.0-or-later -->

<!-- Trace Explorer: the traces of a clicked chart point, one row per trace; a row opens its waterfall. -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18nTyped, raw } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { toFilterFields } from "@/utils/query/filterBar";
import {
  requestFieldValues,
  requestFieldValuesMatching,
  valuesWindowFor,
} from "@/composables/fieldValueStore";
import OInnerLoading from "@/lib/feedback/InnerLoading/OInnerLoading.vue";
import TracesSearchResultList from "@/plugins/traces/components/TracesSearchResultList.vue";
import TraceDetails from "@/plugins/traces/TraceDetails.vue";
import ExplorerToolbar from "./ExplorerToolbar.vue";
import ExplorerDetailNav from "./ExplorerDetailNav.vue";
import ExplorerFilterBar from "./ExplorerFilterBar.vue";
import useHttpStreaming from "@/composables/useStreamingSearch";
import useTraces, { DEFAULT_TRACE_COLUMNS } from "@/composables/useTraces";
import useStreams from "@/composables/useStreams";
import { useTracesTableColumns } from "@/plugins/traces/composables/useTracesTableColumns";
import { useExplorerDetailKeys } from "@/composables/dashboard/useExplorerDetailKeys";
import { useExplorerPagedStep } from "@/composables/dashboard/useExplorerPagedStep";
import { generateTraceContext } from "@/utils/auth";
import { toast } from "@/lib/feedback/Toast/useToast";
import {
  filtersWhere,
  tracesPageQuery,
  type FieldFilter,
} from "@/utils/dashboard/chartPointExplore";
import {
  explorerErrorText,
  hasFullPage,
  traceDetailWindow,
} from "@/utils/dashboard/pointExplorers";
import ExplorerQueryError from "./ExplorerQueryError.vue";

const props = defineProps<{
  stream: string;
  /** The clicked group-by values, or the service correlation's; the Filter starts from them. */
  filters: FieldFilter[];
  startTime: number;
  endTime: number;
  /** The traces panel's own WHERE, ANDed before the clicked values. */
  baseWhere?: string;
}>();

const PAGE_SIZE = 25;

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();
const orgId = computed(() => store.state.selectedOrganization.identifier);

const rangeStart = ref(props.startTime);
const rangeEnd = ref(props.endTime);
const whereText = ref(filtersWhere(props.baseWhere ?? "", props.filters));
const showFilter = ref(false);

// ── Columns and schema: the drawer's own, never the Traces page's ────────────
const { buildColumns } = useTracesTableColumns();
const columns = buildColumns(false, "traces", DEFAULT_TRACE_COLUMNS.traces);
const streamFields = ref<{ name: string; isSchemaField: boolean }[]>([]);
const schemaRows = ref<{ name: string; type?: string }[]>([]);
const fieldsLoading = ref(true);
const { getStream } = useStreams(t);
onMounted(async () => {
  try {
    const stream = await getStream(props.stream, "traces", true);
    schemaRows.value = stream?.schema ?? [];
    streamFields.value = schemaRows.value.map((f) => ({ name: f.name, isSchemaField: true }));
  } catch {
    schemaRows.value = [];
    streamFields.value = [];
  }
  fieldsLoading.value = false;
});
const filterFields = computed(() => toFilterFields(schemaRows.value));
// Values come from the stream over the drawer's own range, never the Traces page's search state.
const loadFilterValues = (field: string, search: string): Promise<string[]> => {
  const ctx = { org: orgId.value, streamType: "traces", streamName: props.stream };
  const timeRange = valuesWindowFor(rangeStart.value, rangeEnd.value) ?? undefined;
  return search.trim()
    ? requestFieldValuesMatching(ctx, field, search, { timeRange })
    : requestFieldValues(ctx, field, { timeRange });
};

// ── Search over traces/latest_stream ─────────────────────────────────────────
const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();
const { formatTracesMetaData } = useTraces();
const page = ref(0);
// The list's sort, as on the Traces page in traces mode: the endpoint sorts by start_time or
// duration (the only sortable headers); a header click reruns from page 1 and paging keeps it.
const sortBy = ref<"start_time" | "duration">("start_time");
const sortOrder = ref<"asc" | "desc">("desc");
const hits = ref<any[]>([]);
const loading = ref(false);
const scrollRef = ref<HTMLElement | null>(null);
const searched = ref(false);
const errorMsg = ref("");
// The filter a failed search ran, shown under its message.
const errorFilter = ref("");
let runningId: string | null = null;
// Settles the running search's promise, so a superseded one never leaves a waiter hanging.
let settleRunning: (() => void) | null = null;

function cancelRunning() {
  settleRunning?.();
  settleRunning = null;
  if (!runningId) return;
  cancelStreamQueryBasedOnRequestId({ trace_id: runningId, org_id: orgId.value });
  runningId = null;
}

function search(): Promise<void> {
  cancelRunning();
  const { traceId } = generateTraceContext();
  runningId = traceId;
  const settled = new Promise<void>((resolve) => (settleRunning = resolve));
  loading.value = true;
  errorMsg.value = "";
  errorFilter.value = "";
  hits.value = [];
  const rows: any[] = [];
  const filter = whereText.value.trim();
  fetchQueryDataWithHttpStream(
    {
      queryReq: {
        stream_name: props.stream,
        filter,
        start_time: rangeStart.value,
        end_time: rangeEnd.value,
        from: page.value * PAGE_SIZE,
        size: PAGE_SIZE,
        sort_by: sortBy.value,
        sort_order: sortOrder.value,
      },
      type: "traces",
      traceId,
      org_id: orgId.value,
    },
    {
      data: (_payload: unknown, response: any) => {
        if (runningId !== traceId) return;
        const chunk: any[] = response?.content?.results?.hits ?? [];
        if (!chunk.length) return;
        rows.push(...formatTracesMetaData(chunk));
        hits.value = [...rows];
      },
      error: (_payload: unknown, response: any) => {
        if (runningId !== traceId) return;
        runningId = null;
        // A streamed error event carries its body in `content`; an HTTP failure is the body itself
        // (with `status`), or just a status message when the body was not JSON.
        const body = response?.content ?? response ?? {};
        errorMsg.value = explorerErrorText({
          message: response?.message,
          response: { data: body },
        });
        errorFilter.value = filter;
        hits.value = [];
        loading.value = false;
        searched.value = true;
        settleRunning?.();
      },
      complete: () => {
        if (runningId !== traceId) return;
        runningId = null;
        hits.value = rows;
        loading.value = false;
        searched.value = true;
        settleRunning?.();
      },
      reset: () => {},
    },
  );
  return settled;
}
onBeforeUnmount(cancelRunning);

// The chip bar's pending auto-run, if any; a run from here supersedes it, so one click sends one search.
const filterBarRef = ref<InstanceType<typeof ExplorerFilterBar> | null>(null);
function runQuery() {
  filterBarRef.value?.cancelPendingRun();
  page.value = 0;
  search();
}

function onSortChange(field: string, order: "asc" | "desc") {
  if (field !== "start_time" && field !== "duration") return;
  sortBy.value = field;
  sortOrder.value = order;
  runQuery();
}

function goToPage(next: number): Promise<void> {
  page.value = next;
  return search();
}
const hasNextPage = computed(() => hasFullPage(hits.value.length, PAGE_SIZE));
// A page past an exactly full last page has no range to name; Previous stays to go back.
const pageRange = computed(() =>
  hits.value.length
    ? t("panel.traceExplorer.pageRange", {
        from: page.value * PAGE_SIZE + 1,
        to: page.value * PAGE_SIZE + hits.value.length,
      })
    : t("panel.logExplorer.pagerEmptyPage"),
);

function onDateChange(range: { startTime: number; endTime: number }) {
  rangeStart.value = range.startTime;
  rangeEnd.value = range.endTime;
  runQuery();
}

function addFilter(condition: string) {
  const where = whereText.value.trim();
  whereText.value = where ? `${where} AND ${condition}` : condition;
  showFilter.value = true;
  runQuery();
}

onMounted(runQuery);

// ── Detail: embedded TraceDetails ─────────────────────────────────────────────
const selected = ref<any | null>(null);
const selectedIndex = computed(() => (selected.value ? hits.value.indexOf(selected.value) : -1));
const detailWindow = computed(() =>
  selected.value ? traceDetailWindow(selected.value) : { startTime: 0, endTime: 0 },
);
// A trace opens as on the Traces page: no span selected, so the span panel is closed and the
// waterfall shows its bars. TraceDetails (keyed per trace) clears any selection when it loads.
function openTrace(row: any) {
  selected.value = row;
}
function closeTrace() {
  selected.value = null;
}
const {
  hasPrev,
  hasNext,
  step: stepTrace,
} = useExplorerPagedStep({
  items: () => hits.value,
  index: () => selectedIndex.value,
  page: () => page.value,
  nextPageExists: () => hasNextPage.value,
  loadPage: goToPage,
  open: openTrace,
});
const onExplorerKeydown = useExplorerDetailKeys({
  isOpen: () => !!selected.value,
  prev: () => stepTrace(-1),
  next: () => stepTrace(1),
  back: closeTrace,
});

// ── Hand-offs ────────────────────────────────────────────────────────────────
function openInTraces() {
  const query = tracesPageQuery({
    org: orgId.value,
    stream: props.stream,
    startTime: rangeStart.value,
    endTime: rangeEnd.value,
    filter: whereText.value.trim(),
  });
  window.open(router.resolve({ name: "traces", query }).href, "_blank", "noopener,noreferrer");
}

// The drawer is not restored from the URL, so the link names the trace's own page.
function copyTraceLink() {
  if (!selected.value) return;
  const href = router.resolve({
    name: "traceDetails",
    query: {
      trace_id: selected.value.trace_id,
      stream: props.stream,
      from: String(detailWindow.value.startTime),
      to: String(detailWindow.value.endTime),
      org_identifier: orgId.value,
    },
  }).href;
  navigator.clipboard
    .writeText(new URL(href, window.location.origin).toString())
    .then(() => toast({ variant: "success", message: t("common.copiedToClipboard") }))
    .catch(() => {
      /* best-effort */
    });
}

const detailTitle = computed(() =>
  raw(selected.value ? `${selected.value.service_name} · ${selected.value.operation_name}` : ""),
);
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col overflow-hidden"
    data-test="trace-explorer"
    @keydown="onExplorerKeydown"
  >
    <div v-show="!selected" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ExplorerToolbar
        :range-start="rangeStart"
        :range-end="rangeEnd"
        :query-label="t('panel.traceExplorer.filter')"
        query-icon="filter-alt"
        :query-open="showFilter"
        :open-label="t('panel.traceExplorer.openInTraces')"
        open-feature="traces"
        :loading="loading"
        data-test-prefix="trace-explorer"
        @date-change="onDateChange"
        @toggle-query="showFilter = !showFilter"
        @open="openInTraces"
        @run="runQuery"
      >
        <ExplorerFilterBar
          v-if="showFilter"
          ref="filterBarRef"
          :chips-query="whereText"
          own-kind="where"
          :own-value="whereText"
          :fields="filterFields"
          :fields-loading="fieldsLoading"
          :load-values="loadFilterValues"
          data-test-prefix="trace-explorer"
          @update:chips-query="(where: string) => (whereText = where)"
          @update:own-value="(where: string) => (whereText = where)"
          @run="runQuery"
        />
      </ExplorerToolbar>

      <ExplorerQueryError
        v-if="errorMsg"
        :message="errorMsg"
        :sql="errorFilter"
        data-test="trace-explorer-error"
      />

      <div v-else class="relative flex min-h-0 flex-1 flex-col" data-test="trace-explorer-results">
        <OInnerLoading :showing="loading && !hits.length" size="sm" :label="t('common.loading')" />
        <div
          v-if="searched && !loading && !hits.length"
          class="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10"
          data-test="trace-explorer-empty"
        >
          <OIcon name="manage-search" size="xl" class="text-text-secondary opacity-30" />
          <span class="text-text-secondary text-sm">{{ t("panel.traceExplorer.noTraces") }}</span>
          <code
            v-if="whereText"
            class="text-text-secondary bg-surface-subtle rounded-default max-w-full overflow-x-auto px-3 py-2 text-center font-mono text-xs break-all whitespace-pre-wrap"
            >{{ whereText }}</code
          >
        </div>
        <div v-else ref="scrollRef" class="min-h-0 flex-1 overflow-y-auto">
          <TracesSearchResultList
            :hits="hits"
            :loading="loading"
            :search-performed="searched"
            :show-header="false"
            :columns="columns"
            :stream-fields="streamFields"
            :stream-name="stream"
            :query-window-us="{ start: rangeStart, end: rangeEnd }"
            :scroll-el="scrollRef"
            :sort-by="sortBy"
            :sort-order="sortOrder"
            @sort-change="onSortChange"
            @row-click="openTrace"
            @add-filter="addFilter"
          />
        </div>
        <div
          v-if="hits.length || page > 0"
          class="bg-dialog-bg border-border-default sticky bottom-0 z-10 flex w-full items-center gap-2 border-t px-3 py-2"
          data-test="trace-explorer-pager"
        >
          <div class="flex-1" />
          <OButton
            size="sm-toolbar"
            variant="outline"
            icon-left="chevron-left"
            :disabled="page === 0 || loading"
            data-test="trace-explorer-prev-page"
            @click="goToPage(page - 1)"
          >
            {{ t("panel.logExplorer.prevPage") }}
          </OButton>
          <span
            class="text-text-secondary min-w-16 text-center text-xs tabular-nums"
            data-test="trace-explorer-page-range"
            >{{ pageRange }}</span
          >
          <OButton
            size="sm-toolbar"
            variant="outline"
            icon-right="chevron-right"
            :disabled="!hasNextPage || loading"
            data-test="trace-explorer-next-page"
            @click="goToPage(page + 1)"
          >
            {{ t("panel.logExplorer.nextPage") }}
          </OButton>
        </div>
      </div>
    </div>

    <div v-if="selected" class="flex h-full min-h-0 flex-col" data-test="trace-explorer-detail">
      <ExplorerDetailNav
        :title="detailTitle"
        :subtitle="raw(selected.trace_id)"
        :index="selectedIndex"
        :count="hits.length"
        :has-prev="hasPrev"
        :has-next="hasNext"
        :offset="page * PAGE_SIZE"
        :total="page === 0 && !hasNextPage ? hits.length : null"
        :prev-label="t('panel.traceExplorer.prevTrace')"
        :next-label="t('panel.traceExplorer.nextTrace')"
        data-test-prefix="trace-explorer"
        @back="closeTrace"
        @prev="stepTrace(-1)"
        @next="stepTrace(1)"
        @copy-link="copyTraceLink"
      />
      <div class="min-h-0 flex-1 overflow-hidden">
        <TraceDetails
          :key="selected.trace_id"
          mode="embedded"
          :trace-id-prop="selected.trace_id"
          :stream-name-prop="stream"
          own-stream-name
          ignore-saved-tab
          :span-list-prop="[]"
          :start-time-prop="detailWindow.startTime"
          :end-time-prop="detailWindow.endTime"
          :show-header="false"
          :show-back-button="false"
          :show-timeline="true"
          :show-log-stream-selector="false"
          :show-share-button="false"
          :show-close-button="false"
          :show-expand-button="true"
          :enable-correlation-links="true"
          :initial-timeline-expanded="false"
          open-links-in-new-tab
          class="h-full!"
        />
      </div>
    </div>
  </div>
</template>
