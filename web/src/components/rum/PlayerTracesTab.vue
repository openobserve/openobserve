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
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="flex h-full flex-col items-center justify-center gap-3"
      data-test="rum-player-traces-tab-loading"
    >
      <OSpinner size="md" />
      <small>{{ t("rum.loadingErrorDetails") }}</small>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="flex h-full flex-col items-center justify-center gap-4 p-4"
      data-test="rum-player-traces-tab-error"
    >
      <OIcon name="error-outline" size="lg" class="text-status-error-text" />
      <p class="text-center">{{ error }}</p>
      <OButton
        variant="outline"
        size="sm-action"
        @click="fetchTraces"
        data-test="rum-player-traces-tab-retry-btn"
      >
        {{ t("common.retry") }}
      </OButton>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="correlatedViews.length === 0"
      class="flex h-full flex-col items-center justify-center gap-3 p-4"
      data-test="rum-player-traces-tab-empty"
    >
      <OIcon name="info" size="lg" class="text-text-muted" />
      <p class="text-text-secondary text-center">
        {{ t("rum.noCorrelatedTraces") }}
      </p>
      <OTag
        v-if="sessionTracesIncomplete"
        type="logsResultChip"
        value="warn"
        data-test="rum-player-traces-tab-partial-empty"
        >{{ t("common.partialResults") }}</OTag
      >
    </div>

    <!-- Detail view: embedded TraceDetails -->
    <div v-else-if="selectedTrace" class="flex h-full flex-col overflow-hidden">
      <!-- Trace detail header -->
      <div
        class="border-card-glass-border flex items-center gap-1 border-b border-solid px-2 py-1.5"
      >
        <OButton
          variant="ghost"
          size="xs"
          @click="closeTraceDetail"
          data-test="rum-player-traces-tab-back-btn"
          :aria-label="t('common.back')"
        >
          <OIcon name="arrow-back" size="sm" />
        </OButton>
        <OTruncatedText as="code" class="text-text-secondary flex-1 text-sm">{{
          traceDisplayName(selectedTrace)
        }}</OTruncatedText>
        <div class="flex flex-shrink-0 items-center gap-1.5">
          <span
            v-if="selectedTrace.metadata?.errorCount > 0"
            class="rounded-default text-2xs bg-status-error-bg! text-status-error-text! inline-flex items-center gap-1 px-1.5 py-0.5 font-bold"
          >
            <OIcon name="error" size="xs" />
            {{ selectedTrace.metadata.errorCount }}
            {{ selectedTrace.metadata.errorCount === 1 ? t("rum.error") : t("rum.errors") }}
          </span>
          <span
            v-if="rowHttpStatus(selectedTrace) >= 400"
            class="rounded-default text-2xs bg-status-error-bg! text-status-error-text! inline-flex items-center gap-1 px-1.5 py-0.5 font-bold"
            data-test="rum-player-traces-tab-http-status"
          >
            <OIcon name="error" size="xs" />
            {{ t("traces.traceTree.httpStatus", { status: rowHttpStatus(selectedTrace) }) }}
          </span>
          <button
            v-if="selectedTrace.metadata?.start_time && props.startTime > 0"
            class="rounded-default text-2xs bg-surface-accent text-text-body hover:bg-card-glass-border inline-flex cursor-pointer items-center gap-1 px-1.5 py-0.5 whitespace-nowrap"
            :title="t('rum.seekToMoment')"
            data-test="rum-player-traces-tab-seek-btn"
            @click="seekToTrace(selectedTrace)"
          >
            <OIcon name="play-arrow" size="xs" class="text-text-secondary" />
            {{ traceTimeOffset(selectedTrace.metadata.start_time) }}
          </button>
          <span
            v-if="rowDurationMs(selectedTrace) != null"
            class="rounded-default text-2xs bg-surface-accent text-text-body inline-flex items-center gap-1 px-1.5 py-0.5 whitespace-nowrap"
          >
            <OIcon name="timer" size="xs" class="text-text-secondary" />
            {{ formatTimeWithSuffix((rowDurationMs(selectedTrace) ?? 0) * 1000) }}
          </span>
          <span
            v-if="selectedTrace.metadata?.spanCount"
            class="rounded-default text-2xs bg-surface-accent text-text-body inline-flex items-center gap-1 px-1.5 py-0.5 whitespace-nowrap"
          >
            <OIcon name="lan" size="xs" class="text-text-secondary" />
            {{ selectedTrace.metadata.spanCount }}
            {{ selectedTrace.metadata.spanCount === 1 ? t("rum.span") : t("rum.spans") }}
          </span>
          <OButton
            variant="outline"
            size="chip"
            @click="traceDetailsRef?.handleExpandToFullView()"
            data-test="rum-player-traces-tab-open-full-btn"
            :aria-label="t('traces.openInFullView')"
          >
            <OIcon name="open-in-new" size="sm" />
            <OTooltip :content="t('traces.openInFullView')" />
          </OButton>
        </div>
      </div>
      <div class="flex-1 overflow-hidden">
        <TraceDetails
          ref="traceDetailsRef"
          mode="embedded"
          :trace-id-prop="selectedTrace.traceId"
          :stream-name-prop="selectedTrace.stream || RUM_CORRELATION_TRACES_STREAM"
          :span-list-prop="[]"
          :start-time-prop="selectedTraceStartTime"
          :end-time-prop="selectedTraceEndTime"
          :show-header="false"
          :show-back-button="false"
          :hide-session-replay-button="true"
          :show-timeline="true"
          :show-log-stream-selector="false"
          :show-share-button="false"
          :show-close-button="false"
          :show-expand-button="true"
          :enable-correlation-links="true"
          :initial-timeline-expanded="false"
          class="h-full!"
        />
      </div>
    </div>

    <!-- List view -->
    <div v-else class="flex h-full flex-col overflow-hidden px-2">
      <!-- Filter bar -->
      <div class="flex min-h-8 shrink-0 items-center py-1 pe-2">
        <OTag
          type="logsResultChip"
          value="neutral"
          data-test="rum-player-traces-tab-count-badge"
          class="me-[0.6rem]"
          >{{ `${formatLargeNumber(visibleViews.length)} ${t("menu.traces").toLowerCase()}` }}</OTag
        >
        <OTag
          v-if="totalErrorCount > 0"
          type="logsResultChip"
          value="error"
          data-test="rum-player-traces-tab-error-count-badge"
          >{{ `${formatLargeNumber(totalErrorCount)} ${t("rum.errorTraces")}` }}</OTag
        >
        <OTag
          v-if="sessionTracesIncomplete"
          type="logsResultChip"
          value="warn"
          data-test="rum-player-traces-tab-partial"
          >{{ t("common.partialResults") }}</OTag
        >
        <OTag
          v-if="metadataError"
          type="logsResultChip"
          value="warn"
          data-test="rum-player-traces-tab-metadata-error"
          :title="metadataError"
          >{{ t("rum.fetchTraceMetadataFailed") }}</OTag
        >
        <div class="ms-auto w-[18rem] max-w-[50%]">
          <OInput
            v-model="traceSearch"
            clearable
            :placeholder="t('traces.sessionDetail.searchPlaceholder')"
            data-test="rum-player-traces-tab-search"
          />
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2 pe-2 pb-1">
        <div class="w-1/2">
          <OSelect
            v-model="selectedTraceStatuses"
            :options="traceStatusOptions"
            multiple
            labelKey="label"
            valueKey="value"
            :placeholder="t('common.status')"
            data-test="rum-player-traces-tab-status-filter"
          />
        </div>
        <div class="w-1/2">
          <OSelect
            v-model="selectedPages"
            :options="pageOptions"
            multiple
            searchable
            clearable
            labelKey="label"
            valueKey="value"
            :placeholder="t('rum.analytics.overview.allPages')"
            data-test="rum-player-traces-tab-page-filter"
          />
        </div>
      </div>

      <!-- Traces table -->
      <div
        class="rounded-default min-h-0 flex-1 overflow-hidden"
        data-test="rum-player-traces-tab-table"
      >
        <OTable
          :data="visibleViews"
          :columns="traceColumns"
          :row-height="32"
          :default-columns="false"
          :enable-column-reorder="true"
          :row-class="traceRowClass"
          :show-global-filter="false"
          pagination="none"
          @row-click="handleTraceRowClick"
        >
          <template #cell-timestamp="{ row }">
            <span class="text-xs tabular-nums">
              {{ formatTraceTimestamp(row.metadata?.start_time) }}
            </span>
          </template>
          <template #cell-page="{ row }">
            <span class="font-mono text-xs">
              {{ pageRoute(row) }}
            </span>
          </template>
          <template #cell-route="{ row }">
            <span class="font-mono text-xs">
              {{ traceDisplayName(row) }}
            </span>
          </template>
          <template #cell-duration="{ row }">
            <span class="text-xs tabular-nums">
              {{
                rowDurationMs(row) === null ? "—" : formatTimeWithSuffix(rowDurationMs(row)! * 1000)
              }}
            </span>
          </template>
          <template #cell-status="{ row }">
            <TraceStatusCell v-if="rowStatusKnown(row)" :item="{ errors: rowErrorCount(row) }" />
            <span v-else class="text-xs">—</span>
          </template>
        </OTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed, type PropType } from "vue";
import { useStore } from "vuex";
import { useI18nTyped, raw } from "@/types/i18n";
import searchService from "@/services/search";
import useStreams from "@/composables/useStreams";
import {
  rumFieldSql,
  rumFieldNotNullSql,
  normalizeTraceId,
  RUM_CORRELATION_TRACES_STREAM,
} from "@/utils/rum/fields";
import { formatTimeWithSuffix, formatLargeNumber, generateTraceContext } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import useCorrelatedTracesStream from "@/composables/rum/useCorrelatedTracesStream";
import {
  arrivalTraceWindowUs,
  TRACE_RANGE_PADDING_US,
  traceQueryWindow,
} from "@/utils/rum/traceWindow";
import {
  TRACE_IDS_PER_GET_REQUEST,
  type TraceTimeRange,
} from "@/ts/interfaces/traces/traceTimeRange.types";
import { chunkItems, mapWithConcurrency } from "@/utils/rum/batching";
import { SERVER_STATUS_COLUMNS } from "@/utils/rum/serverStatus";
import { quoteSqlIdentifierIfNeeded } from "@/utils/query/sqlIdentifiers";
import { sqlEquals, sqlIn } from "@/utils/query/sqlFilterBuilder";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import TraceStatusCell from "@/plugins/traces/components/TraceStatusCell.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import TraceDetails from "@/plugins/traces/TraceDetails.vue";

const { t } = useI18nTyped();
const store = useStore();
const { getStream } = useStreams(t);
const {
  resolveTraceLocationsBulk,
  fallbackTracesStream,
  cancel: cancelCorrelatedTracesStream,
} = useCorrelatedTracesStream(t);

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  currentTime: {
    type: Number,
    default: 0,
  },
  startTime: {
    type: Number,
    default: 0,
  },
  endTime: {
    type: Number,
    default: 0,
  },
  rumWindowUs: {
    type: Object as PropType<{ start: number; end: number } | null>,
    default: null,
  },
});

const emit = defineEmits(["event-emitted"]);

// ── State ───────────────────────────────────────────────────
const loading = ref(false);
const error = ref<string | null>(null);
const correlatedViews = ref<any[]>([]);
const selectedTrace = ref<any>(null);
const selectedTraceStartTime = ref(0);
const selectedTraceEndTime = ref(0);
const traceDetailsRef = ref<any>(null);
const traceMetadata = ref<Record<string, any>>({});
const metadataLoading = ref(false);
const metadataError = ref<string | null>(null);
// The session's request list itself is incomplete (a partial page, or the MAX_SESSION_TRACES cap).
const sessionTracesIncomplete = ref(false);
const traceSearchWindow = ref<{ start: number; end: number } | null>(null);

const traceSearch = ref("");

// A request whose end-to-end duration reaches this counts as slow.
const SLOW_TRACE_MS = 1000;

const selectedTraceStatuses = ref<string[]>(["error", "success", "slow"]);
const selectedPages = ref<string[]>([]);

const traceStatusOptions = computed(() => [
  { label: t("rum.playerEvents.error"), value: "error" },
  { label: t("common.success"), value: "success" },
  { label: t("rum.slowTraceFilter", { seconds: SLOW_TRACE_MS / 1000 }), value: "slow" },
]);

// The pages this session's traces came from, in the order they were first visited.
const pageOptions = computed(() =>
  [...new Set(correlatedViews.value.map(pageRoute).filter(Boolean))].map((page) => ({
    label: raw(page),
    value: page,
  })),
);

// Clock skew can put the trace end before the RUM request, so fall back to the span's own length.
function traceDurationMs(rumDateMs: number, meta: any): number | null {
  const endToEndMs =
    rumDateMs && meta.end_time ? Math.floor(meta.end_time / 1_000_000) - rumDateMs : 0;
  if (endToEndMs > 0) return endToEndMs;
  const spanMs =
    meta.start_time && meta.end_time
      ? Math.floor((meta.end_time - meta.start_time) / 1_000_000)
      : 0;
  return spanMs > 0 ? spanMs : null;
}

// Like the Breadcrumbs type filter: a trace shows if it matches any checked status,
// and an empty selection shows every trace.
function matchesTraceStatus(view: any): boolean {
  const statuses = selectedTraceStatuses.value;
  if (!statuses.length) return true;
  const hasError = rowIsError(view);
  return (
    (statuses.includes("error") && hasError) ||
    (statuses.includes("success") && !hasError) ||
    (statuses.includes("slow") && (rowDurationMs(view) ?? 0) >= SLOW_TRACE_MS)
  );
}

// Search over what each row shows: the page, the request name and the trace id.
function matchesTraceSearch(view: any, term: string): boolean {
  return [pageRoute(view), traceDisplayName(view), view.traceId].some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(term),
  );
}

const visibleViews = computed(() => {
  const term = traceSearch.value.trim().toLowerCase();
  const pages = new Set(selectedPages.value);
  return correlatedViews.value.filter(
    (view) =>
      matchesTraceStatus(view) &&
      (!pages.size || pages.has(pageRoute(view))) &&
      (!term || matchesTraceSearch(view, term)),
  );
});

const totalErrorCount = computed(() => visibleViews.value.filter((v) => rowIsError(v)).length);

const { fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId } = useHttpStreaming();

// The metadata stream carries a local trace id; track it so unmount can abort an in-flight fetch.
let activeTraceIds: string[] = [];

// ── Table column definitions ────────────────────────────────
const traceColumns = computed(() => [
  {
    id: "timestamp",
    header: t("rum.timestamp"),
    accessorFn: (row: any) => traceSortKey(row),
    size: 100,
    minSize: 100,
    maxSize: 200,
    meta: { align: "left" },
  },
  {
    // The browser page each request was made from; the route column names the request itself.
    id: "page",
    header: t("rum.errorDetail.facetPage"),
    accessorFn: (row: any) => pageRoute(row),
    size: 160,
    minSize: 80,
    maxSize: 400,
    meta: { align: "left" },
  },
  {
    id: "route",
    header: t("rum.route"),
    accessorFn: (row: any) => traceDisplayName(row),
    size: 400,
    minSize: 80,
    maxSize: 800,
    meta: { align: "left" },
  },
  {
    id: "duration",
    header: t("rum.duration"),
    accessorFn: (row: any) => rowDurationMs(row) ?? 0,
    size: 100,
    minSize: 50,
    maxSize: 200,
    meta: { align: "left" },
  },
  {
    id: "status",
    header: t("common.status"),
    accessorFn: (row: any) => rowErrorCount(row),
    size: 120,
    minSize: 80,
    maxSize: 180,
    meta: { align: "left" },
  },
]);

// A row's duration and status. The browser's own timing of the request (`resource_duration`) is
// the duration: one clock, so a device clock that differs from the server's cannot zero or inflate it. Without it,
// the trace's end-to-end duration (traceDurationMs, which falls back to the span length under clock skew); with
// neither (or a zero, which is no measurement), null, shown as "—".
function rowDurationMs(row: any): number | null {
  if (row?.browserDurationMs > 0) return row.browserDurationMs;
  const traceMs = row?.metadata?.e2eDuration;
  return traceMs > 0 ? traceMs : null;
}

// The worse HTTP status the browser or the trace's server span saw (0 when neither has one). The browser reports
// 0 for a request it got no readable answer for, so the server span's status counts too.
function rowHttpStatus(row: any): number {
  return Math.max(Number(row?.browserStatus) || 0, Number(row?.metadata?.serverStatus) || 0);
}

// A request failed when its trace has an ERROR span or its HTTP status is 400 or above: backends leave a 4xx
// server span UNSET (OpenTelemetry semantics), so the span status alone shows almost every failure as a success.
function rowIsError(row: any): boolean {
  return (row?.metadata?.errorCount || 0) > 0 || rowHttpStatus(row) >= 400;
}

// The count the status pill shows: the trace's ERROR spans, or 1 for a request only its HTTP status failed.
function rowErrorCount(row: any): number {
  return row?.metadata?.errorCount || (rowIsError(row) ? 1 : 0);
}

// Whether a status is shown: the trace details loaded, or the HTTP status alone proves a failure.
function rowStatusKnown(row: any): boolean {
  return !!row?.metadata || rowHttpStatus(row) >= 400;
}

// A row's trace start (ns); a row whose trace details failed to load uses its browser time.
function traceSortKey(row: any): number {
  return row.metadata?.start_time ?? (row.rumDate || 0) * 1_000_000;
}

function traceRowClass(row: any): string {
  return rowIsError(row) ? "trace-row--error" : "";
}

// ── Formatting helpers ──────────────────────────────────────
function shortRoute(url: string): string {
  try {
    const u = new URL(url);
    // Hash-routed SPAs keep the route after `#`, so the pathname alone is `/` for every page.
    if (u.hash.startsWith("#/")) return u.pathname + u.search + u.hash;
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

function pageRoute(trace: any): string {
  return trace.route ? shortRoute(trace.route) : "";
}

function traceDisplayName(trace: any): string {
  const operation = trace.metadata?.httpOperation || trace.metadata?.rootOperation;
  return operation && operation !== "unknown" ? operation : shortRoute(trace.route) || trace.label;
}

// Converts nanosecond trace timestamp to millisecond offset from session start,
// matching SessionViewer's formatTimeDifference(event.date, session.start_time) pattern.
function traceRelativeTimeMs(startTimeNs: number): number {
  if (!props.startTime || !startTimeNs) return 0;
  const startTimeMs = Math.floor(startTimeNs / 1_000_000);
  return Math.max(0, startTimeMs - props.startTime);
}

function formatTraceTimestamp(startTimeNs: number): string {
  if (!startTimeNs || !props.startTime) return "—";
  const offsetMs = traceRelativeTimeMs(startTimeNs);
  const totalSec = Math.floor(offsetMs / 1000);
  const mm = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const ss = (totalSec % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function traceTimeOffset(startTimeNs: number): string {
  if (!props.startTime) return "";
  const offsetMs = traceRelativeTimeMs(startTimeNs);
  const totalSec = Math.floor(offsetMs / 1000);
  const min = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const sec = (totalSec % 60).toString().padStart(2, "0");
  return `${min}:${sec}`;
}

// ── Data fetching ───────────────────────────────────────────
// A session's requests are read in pages, up to MAX_SESSION_TRACES (a long session can have thousands),
// instead of the first 250 only.
const RUM_TRACE_PAGE_SIZE = 1000;
const MAX_SESSION_TRACES = 10000;
// The metadata GET carries its ids in the URL, so it goes in batches of TRACE_IDS_PER_GET_REQUEST;
// a WAF answers a longer query string with 403 and every row lost its metadata. This many batches run at once.
const METADATA_CONCURRENCY = 4;

/**
 * The window covering `ranges`, padded — widened to the caller's window when
 * any trace has no indexed range, so an unknown trace is never narrowed out.
 */
function unionTraceWindow(
  ranges: (TraceTimeRange | undefined)[],
  fallbackStartUs: number,
  fallbackEndUs: number,
): { startTime: number; endTime: number } {
  const known = ranges.filter((range): range is TraceTimeRange => Boolean(range));
  if (!known.length) return { startTime: fallbackStartUs, endTime: fallbackEndUs };
  const merged = known.reduce((acc, range) => ({
    start_time: Math.min(acc.start_time, range.start_time),
    end_time: Math.max(acc.end_time, range.end_time),
  }));
  const traceWindow = traceQueryWindow(merged, fallbackStartUs, fallbackEndUs);
  if (known.length === ranges.length) return traceWindow;
  return {
    startTime: Math.min(traceWindow.startTime, fallbackStartUs),
    endTime: Math.max(traceWindow.endTime, fallbackEndUs),
  };
}

/** What a traces stream's schema allows the server-span query to name. */
interface ServerSpanSchema {
  /** The HTTP status columns it has, in SERVER_STATUS_COLUMNS order. */
  statusColumns: string[];
  /** Whether it has `http_route`, which the route name needs. */
  hasRoute: boolean;
}

/**
 * The server-span columns a traces stream has (naming a column the stream lacks fails the whole query). Asked
 * once per stream per fetch: getStream re-reads the schema on every call. Without a schema there are no status
 * columns, and the route name is asked as before.
 */
async function serverSpanSchema(streamName: string): Promise<ServerSpanSchema> {
  try {
    const traceStream = await getStream(streamName, "traces", true);
    const columns = new Set((traceStream?.schema ?? []).map((field: any) => field?.name));
    return {
      statusColumns: SERVER_STATUS_COLUMNS.filter((column) => columns.has(column)),
      hasRoute: columns.has("http_route"),
    };
  } catch {
    return { statusColumns: [], hasRoute: true };
  }
}

/**
 * Trace summaries for `traceIds` in one stream. `incomplete` is true when the server flagged the answer partial
 * (`is_partial`, `function_error`), so an id it lacks is unknown, not absent. Rejects when `signal` aborts.
 * `serverSchema` says which server-span columns the stream has (see serverSpanSchema).
 */
async function fetchTraceMetadata(
  traceIds: string[],
  streamName: string,
  window?: { startTime: number; endTime: number },
  signal?: AbortSignal,
  serverSchema: ServerSpanSchema = { statusColumns: [], hasRoute: true },
): Promise<{ metadata: Record<string, any>; incomplete: boolean }> {
  const { statusColumns, hasRoute } = serverSchema;
  if (traceIds.length === 0) return { metadata: {}, incomplete: false };
  let incomplete = false;

  const orgId = store.state.selectedOrganization.identifier;
  const nowMs = Date.now();
  const searchStartTime = window?.startTime ?? (props.startTime || nowMs - 86400000) * 1000;
  const searchEndTime = window?.endTime ?? (props.endTime || nowMs) * 1000;

  // Build filter for multiple trace IDs
  const filter =
    traceIds.length === 1 ? sqlEquals("trace_id", traceIds[0]) : sqlIn("trace_id", traceIds);

  const metadata = await new Promise<Record<string, any>>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const traceId = generateTraceContext().traceId;
    activeTraceIds.push(traceId);
    // A cancelled stream calls no handler, so the abort settles this promise itself.
    const onAbort = () => {
      cancelStreamQueryBasedOnRequestId({
        trace_id: traceId,
        org_id: store.state.selectedOrganization?.identifier,
      });
      untrack();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const untrack = () => {
      activeTraceIds = activeTraceIds.filter((id) => id !== traceId);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const metadata: Record<string, any> = {};

    fetchQueryDataWithHttpStream(
      {
        queryReq: {
          stream_name: streamName,
          filter,
          start_time: searchStartTime,
          end_time: searchEndTime,
          from: 0,
          size: 1000,
        },
        type: "traces",
        traceId,
        org_id: orgId,
      },
      {
        data: (_payload, response) => {
          const results = response.content?.results;
          if (results?.is_partial || results?.function_error?.length) incomplete = true;
          const hits = results?.hits || [];
          hits.forEach((hit: any) => {
            metadata[hit.trace_id] = {
              duration: hit.duration,
              spanCount: hit.spans?.[0] || 0,
              errorCount: hit.spans?.[1] || 0,
              serviceCount: hit.service_name?.length || 0,
              rootService: hit.first_event?.service_name || "unknown",
              rootOperation: hit.first_event?.operation_name || "unknown",
              start_time: hit.start_time,
              end_time: hit.end_time,
            };
          });
        },
        error: (_, error) => {
          untrack();
          reject(error);
        },
        complete: () => {
          untrack();
          resolve(metadata);
        },
        reset: () => {},
      },
    );
  });

  // An abort between the summary stream and this lookup starts no request.
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const stream = quoteSqlIdentifierIfNeeded(streamName);
  const timestamp = quoteSqlIdentifierIfNeeded(store.state.zoConfig.timestamp_column);
  const routeSql = hasRoute
    ? `SELECT trace_id, first_value(operation_name ORDER BY ${timestamp} ASC) AS operation_name FROM ${stream} WHERE ${filter} AND span_kind='2' AND http_route IS NOT NULL AND operation_name IS NOT NULL AND operation_name != '' GROUP BY trace_id`
    : null;
  // With status columns, the status is the earliest server span's that has one: the request's
  // entry point, which answered the browser (a 404 an internal service returned to the backend is not the
  // request's status). Unrouted spans count, since a request rejected before routing (a 401, an unmatched 404)
  // has no route. The route name still comes from the earliest routed span: routed spans sort first, and a
  // trace without one gets a null name. One span answers for both status columns (a trace can mix
  // semantic-convention versions across services); they are cast to text, since one may be an integer.
  const routed = `http_route IS NOT NULL AND operation_name IS NOT NULL AND operation_name != ''`;
  const status = statusColumns.length
    ? `COALESCE(${statusColumns
        .map((column) => `CAST(${quoteSqlIdentifierIfNeeded(column)} AS VARCHAR)`)
        .join(", ")})`
    : "";
  // A stream without `http_route` has no route names, and naming the column would fail the query.
  const name = hasRoute
    ? `first_value(CASE WHEN ${routed} THEN operation_name END ORDER BY CASE WHEN ${routed} THEN 0 ELSE 1 END ASC, ${timestamp} ASC)`
    : "NULL";
  const statusSql = status
    ? `SELECT trace_id, ${name} AS operation_name, first_value(${status} ORDER BY CASE WHEN ${status} IS NOT NULL THEN 0 ELSE 1 END ASC, ${timestamp} ASC) AS server_status FROM ${stream} WHERE ${filter} AND span_kind='2' GROUP BY trace_id`
    : null;
  const searchOperations = (sql: string) =>
    searchService.search(
      {
        org_identifier: orgId,
        query: {
          query: {
            sql,
            start_time: searchStartTime,
            end_time: searchEndTime,
            from: 0,
            size: traceIds.length,
          },
        },
        page_type: "traces",
        signal,
      },
      "RUM",
    );
  const firstSql = statusSql ?? routeSql;
  if (!firstSql) return { metadata, incomplete };
  try {
    let operationResponse: any;
    try {
      operationResponse = await searchOperations(firstSql);
    } catch (err) {
      // A failed status query costs the status only; the route names are asked again without it.
      if (!statusSql || !routeSql || signal?.aborted) throw err;
      console.warn("Server status lookup failed; loading the route names without it:", err);
      operationResponse = await searchOperations(routeSql);
    }

    for (const hit of operationResponse.data?.hits || []) {
      if (metadata[hit.trace_id] && hit.operation_name) {
        metadata[hit.trace_id].httpOperation = hit.operation_name;
      }
      const serverStatus = Number(hit.server_status) || 0;
      if (metadata[hit.trace_id] && serverStatus > 0) {
        metadata[hit.trace_id].serverStatus = serverStatus;
      }
    }
  } catch (err) {
    // An abort is the caller's own doing (session change, unmount); the caller discards this result.
    if (!signal?.aborted) console.warn("HTTP server operation fetch failed:", err);
  }

  return { metadata, incomplete };
}

// Every fetch takes a generation. A newer fetch (another session) or unmount supersedes it; a
// superseded fetch starts no further request and writes no state, since a long session's paged and batched
// fetch can outlast the next session's.
let fetchGeneration = 0;
let fetchAbort: AbortController | null = null;

function cancelInFlightStreams() {
  const orgId = store.state.selectedOrganization?.identifier;
  activeTraceIds.forEach((traceId) =>
    cancelStreamQueryBasedOnRequestId({ trace_id: traceId, org_id: orgId }),
  );
  activeTraceIds = [];
  cancelCorrelatedTracesStream();
}

// An in-flight metadata fetch outlives this tab otherwise; cancel it on unmount.
onUnmounted(() => {
  fetchGeneration += 1;
  fetchAbort?.abort();
  cancelInFlightStreams();
});

async function fetchTraces() {
  // Supersede the previous fetch first, even when there is no session to load.
  const generation = ++fetchGeneration;
  const isStale = () => generation !== fetchGeneration;
  fetchAbort?.abort();
  const abort = new AbortController();
  fetchAbort = abort;
  metadataError.value = null;
  sessionTracesIncomplete.value = false;
  error.value = null;
  if (!props.sessionId) {
    loading.value = false;
    return;
  }

  loading.value = true;
  error.value = null;
  traceSearchWindow.value = null;

  try {
    const orgId = store.state.selectedOrganization.identifier;
    const nowMs = Date.now();
    const searchStartTime = (props.startTime || nowMs - 86400000) * 1000;
    const searchEndTime = (props.endTime || nowMs) * 1000;

    // The trace-id column exists under two namespaces (`_o2_` on newer SDKs, `_oo_` on
    // older ones and on all previously ingested data). Build the expression from the
    // schema — naming a column the stream lacks fails the whole query — and alias it to
    // a stable `_trace_id` so SELECT/GROUP BY and the row reads below stay identical
    // regardless of which spellings are present.
    const rumStream = await getStream("_rumdata", "logs", true);
    if (isStale()) return;
    const traceIdExpr = rumFieldSql(rumStream?.schema, "trace_id");
    const traceIdSet = rumFieldNotNullSql(rumStream?.schema, "trace_id");
    if (!traceIdExpr || !traceIdSet) {
      correlatedViews.value = [];
      return;
    }

    // Optional browser fields must be schema-guarded because mobile streams omit them.
    const presentCols = new Set((rumStream?.schema ?? []).map((field: any) => field?.name));
    const has = (col: string): boolean => presentCols.has(col);
    const aggOrNull = (fn: string, col: string, alias: string): string =>
      has(col) ? `${fn}(${col}) as ${alias}` : `NULL as ${alias}`;

    const selectParts = [
      aggOrNull("max", "view_id", "_view_id"),
      aggOrNull("max", "view_url", "_view_url"),
      aggOrNull("max", "view_loading_type", "_view_loading_type"),
      `${traceIdExpr} as _trace_id`,
      aggOrNull("max", "type", "_type"),
      aggOrNull("min", "date", "_date"),
      // The browser's own timing (ns) and the worst HTTP status it saw for the request.
      aggOrNull("max", "resource_duration", "_resource_duration"),
      aggOrNull("max", "resource_status_code", "_status_code"),
    ];
    if (props.rumWindowUs) {
      const ts = quoteSqlIdentifierIfNeeded(store.state.zoConfig.timestamp_column);
      selectParts.push(`min(${ts}) as _first_ts`, `max(${ts}) as _last_ts`);
    }
    const whereParts = [sqlEquals("session_id", props.sessionId), traceIdSet];
    const having = has("resource_url")
      ? " HAVING MAX(CASE WHEN resource_url LIKE '%/socket.io/%' AND resource_url LIKE '%transport=polling%' THEN 1 ELSE 0 END) = 0"
      : "";

    const rumQuery = {
      query: {
        sql: `SELECT ${selectParts.join(", ")} FROM "_rumdata" WHERE ${whereParts.join(" AND ")} GROUP BY ${traceIdExpr}${having} ORDER BY _date ASC, _trace_id ASC`,
        start_time: props.rumWindowUs
          ? Math.min(props.rumWindowUs.start, searchStartTime)
          : searchStartTime,
        // Rows keep arriving after the last device-clock event, so a re-fetch must reach "now".
        end_time: props.rumWindowUs
          ? Math.max(props.rumWindowUs.end, Date.now() * 1000)
          : searchEndTime,
        from: 0,
        size: RUM_TRACE_PAGE_SIZE,
      },
    };

    // A short page is the last one. There is one row per trace id and `_trace_id` breaks `_date` ties, so the
    // order is total; a row ingested during the read can only push later rows one place on, which repeats a row
    // across pages (dropped by the dedup below), never skips one.
    const rumHits: any[] = [];
    let lastPageShort = false;
    for (let from = 0; from < MAX_SESSION_TRACES; from += RUM_TRACE_PAGE_SIZE) {
      const size = Math.min(RUM_TRACE_PAGE_SIZE, MAX_SESSION_TRACES - from);
      const rumResponse = await searchService.search(
        {
          org_identifier: orgId,
          query: { query: { ...rumQuery.query, from, size } },
          page_type: "logs",
        },
        "RUM",
      );
      if (isStale()) return;
      if (rumResponse.data?.is_partial || rumResponse.data?.function_error?.length) {
        // The page is not authoritative, so a short one does not prove the list ended.
        sessionTracesIncomplete.value = true;
        console.warn(
          "Session traces: the server returned a partial page; later requests may be missing",
        );
      }
      const page = rumResponse.data?.hits || [];
      rumHits.push(...page);
      if (page.length < size) {
        lastPageShort = true;
        break;
      }
    }
    if (!lastPageShort) {
      // Every page came back full up to the cap, so the session may have more requests.
      sessionTracesIncomplete.value = true;
      console.warn(`Session traces capped at the first ${MAX_SESSION_TRACES} requests`);
    }

    if (rumHits.length === 0) {
      correlatedViews.value = [];
      return;
    }

    const deviceWindow = { start: searchStartTime, end: searchEndTime };
    const arrival = props.rumWindowUs ? arrivalTraceWindowUs(rumHits) : null;
    // Arrival can trail a span by more than the pad (offline buffering), so keep the device window too.
    const searchWindow = arrival
      ? {
          start: Math.min(arrival.start, deviceWindow.start - TRACE_RANGE_PADDING_US),
          end: Math.max(arrival.end, deviceWindow.end),
        }
      : deviceWindow;
    if (props.rumWindowUs) traceSearchWindow.value = searchWindow;

    // Deduplicate by trace_id, keep first occurrence for view context.
    // Canonicalize the id: SDK 0.4.x stored it zero-stripped, while the traces
    // stream stores the padded 32-char form — the metadata join and the embedded
    // trace view both need the stream's form.
    const traceMap = new Map<string, any>();
    for (const hit of rumHits) {
      const traceId = normalizeTraceId(hit._trace_id) || hit._trace_id;
      if (!traceId || traceMap.has(traceId)) continue;
      const viewUrl = hit._view_url || hit.view_url || "";
      traceMap.set(traceId, {
        traceId,
        rumDate: hit._date || 0,
        browserDurationMs: (Number(hit._resource_duration) || 0) / 1_000_000,
        browserStatus: Number(hit._status_code) || 0,
        route: viewUrl,
        label: viewUrl ? shortRoute(viewUrl).replace(/\/$/, "") || "/" : traceId,
        kind:
          (hit._view_loading_type || hit.view_loading_type) === "initial_load"
            ? "load"
            : "route_change",
        viewId: hit._view_id || hit.view_id || "",
      });
    }

    const views = Array.from(traceMap.values());

    // Fetch trace metadata for all trace IDs and filter to only those present in traces
    let filteredViews = views;
    if (views.length > 0) {
      metadataLoading.value = true;
      try {
        // Which stream holds each trace (one bulk request; cached in the store).
        // Every row keeps ITS OWN stream so multi-stream sessions list fully and
        // each click opens against the right stream; an unresolved id falls back
        // to `default` only where the org has it, and otherwise drops out unfetched.
        const locationById = await resolveTraceLocationsBulk(
          views.map((v) => v.traceId),
          searchWindow.start,
          searchWindow.end,
          undefined,
          abort.signal,
        );
        if (isStale()) return;
        const fallbackStream = await fallbackTracesStream();
        if (isStale()) return;
        for (const view of views as any[]) {
          const location = locationById[view.traceId];
          view.stream = location?.stream ?? fallbackStream;
          view.range = location?.range;
        }

        // Metadata is fetched per distinct stream (usually one, at most a few).
        const idsByStream = new Map<string, string[]>();
        const rangeById = new Map<string, TraceTimeRange | undefined>();
        for (const view of views as any[]) {
          if (!view.stream) continue;
          const ids = idsByStream.get(view.stream) ?? [];
          ids.push(view.traceId);
          idsByStream.set(view.stream, ids);
          rangeById.set(view.traceId, view.range);
        }
        // Metadata goes in URL-safe batches per stream, METADATA_CONCURRENCY at a time. A failed
        // batch keeps its rows without metadata (shown as "—") instead of dropping the whole list's metadata.
        const batches = [...idsByStream.entries()].flatMap(([stream, ids]) =>
          chunkItems(ids, TRACE_IDS_PER_GET_REQUEST).map((batchIds) => ({ stream, batchIds })),
        );
        // Each stream's status columns, asked once for this fetch rather than once per batch.
        const serverSchemaByStream = new Map<string, ServerSpanSchema>();
        for (const stream of idsByStream.keys()) {
          serverSchemaByStream.set(stream, await serverSpanSchema(stream));
          if (isStale()) return;
        }
        const metadata: Record<string, any> = {};
        const unresolvedIds = new Set<string>();
        let firstBatchError: any = null;
        await mapWithConcurrency(batches, METADATA_CONCURRENCY, async ({ stream, batchIds }) => {
          if (isStale()) return;
          try {
            const part = await fetchTraceMetadata(
              batchIds,
              stream,
              unionTraceWindow(
                batchIds.map((id) => rangeById.get(id)),
                searchWindow.start,
                searchWindow.end,
              ),
              abort.signal,
              serverSchemaByStream.get(stream),
            );
            Object.assign(metadata, part.metadata);
            if (part.incomplete) {
              // A partial answer: an id it lacks may still exist, so its row stays (without metadata).
              const missing = batchIds.filter((id) => !part.metadata[id]);
              missing.forEach((id) => unresolvedIds.add(id));
              if (missing.length) {
                firstBatchError ??= new Error(t("rum.fetchTraceMetadataFailed"));
              }
            }
          } catch (err: any) {
            if (isStale()) return;
            firstBatchError ??= err;
            batchIds.forEach((id) => unresolvedIds.add(id));
          }
        });
        if (isStale()) return;
        if (firstBatchError) {
          // As when the whole lookup failed: a row whose id no stream claimed stays listed too.
          views.filter((view) => !view.stream).forEach((view) => unresolvedIds.add(view.traceId));
          metadataError.value = firstBatchError?.message || t("rum.fetchTraceMetadataFailed");
          console.warn(
            `Trace metadata fetch failed for ${unresolvedIds.size} of ${views.length} traces:`,
            firstBatchError,
          );
        }

        // Keep views whose trace_id exists in the traces stream, plus the ones whose batch failed (unknown, not
        // absent), sorted by start time; a row without metadata sorts by its browser time.
        filteredViews = views
          .filter((view) => metadata[view.traceId] || unresolvedIds.has(view.traceId))
          .map((view) => {
            const meta = metadata[view.traceId];
            if (!meta) return view;
            return {
              ...view,
              metadata: { ...meta, e2eDuration: traceDurationMs(view.rumDate, meta) },
            };
          })
          .sort((a, b) => traceSortKey(a) - traceSortKey(b));

        traceMetadata.value = metadata;
      } catch (err: any) {
        if (isStale()) return;
        metadataError.value = err?.message || t("rum.fetchTraceMetadataFailed");
        console.warn("Trace metadata fetch failed:", err);
      } finally {
        if (!isStale()) metadataLoading.value = false;
      }
    }

    correlatedViews.value = filteredViews;
  } catch (err: any) {
    if (!isStale()) error.value = err?.message || t("rum.failedToFetchTraces");
  } finally {
    if (!isStale()) loading.value = false;
  }
}

function openTraceDetail(view: any) {
  selectedTrace.value = view;

  const nowMs = Date.now();
  const fallbackStart =
    traceSearchWindow.value?.start ?? (props.startTime || nowMs - 86400000) * 1000;
  const fallbackEnd = traceSearchWindow.value?.end ?? (props.endTime || nowMs) * 1000;

  const meta = traceMetadata.value[view.traceId];
  if (meta?.start_time && meta?.end_time) {
    const ONE_MINUTE_US = 60_000_000;
    selectedTraceStartTime.value = Math.floor(meta.start_time / 1000) - ONE_MINUTE_US;
    selectedTraceEndTime.value = Math.ceil(meta.end_time / 1000) + ONE_MINUTE_US;
  } else {
    // The indexed range beats the session window: a trace running past the
    // session's picker window would otherwise open truncated.
    const traceWindow = traceQueryWindow(view.range, fallbackStart, fallbackEnd);
    selectedTraceStartTime.value = traceWindow.startTime;
    selectedTraceEndTime.value = traceWindow.endTime;
  }
}

function closeTraceDetail() {
  selectedTrace.value = null;
  selectedTraceStartTime.value = 0;
  selectedTraceEndTime.value = 0;
}

function handleTraceRowClick(view: any) {
  openTraceDetail(view);
  const relativeTimeMs = traceRelativeTimeMs(view.metadata?.start_time);
  if (relativeTimeMs > 0) {
    emit("event-emitted", "trace-row-click", { relativeTime: relativeTimeMs });
  }
}

function seekToTrace(view: any) {
  const relativeTimeMs = traceRelativeTimeMs(view.metadata?.start_time);
  if (relativeTimeMs >= 0) {
    emit("event-emitted", "trace-seek", { relativeTime: relativeTimeMs });
  }
}

// ── Lifecycle ───────────────────────────────────────────────
onMounted(() => {
  fetchTraces();
});

watch(
  () => props.sessionId,
  () => {
    correlatedViews.value = [];
    // Another session visited other pages.
    selectedPages.value = [];
    selectedTrace.value = null;
    closeTraceDetail();
    // Stop the previous session's streams; fetchTraces supersedes the rest of its work.
    cancelInFlightStreams();
    fetchTraces();
  },
);

// The replay arrival bounds can become available after this tab's first fetch.
watch(
  () => [props.rumWindowUs?.start, props.rumWindowUs?.end],
  (now, before) => {
    if (now[0] === before[0] && now[1] === before[1]) return;
    fetchTraces();
  },
);
</script>

<style scoped>
/* keep(generated-content): reaches into TenstackTable-generated rows and the
   embedded TraceDetails DOM, which Tailwind utilities on this template can't target */
:deep(.trace-row--error td:first-child) {
  border-left: 0.125rem solid var(--color-status-error-text);
}
</style>
