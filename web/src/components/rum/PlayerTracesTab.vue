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
  <div class="flex flex-col flex-1 min-h-0">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="flex flex-col items-center justify-center h-full gap-3"
      data-test="rum-player-traces-tab-loading"
    >
      <OSpinner size="md" />
      <small>{{ t("rum.loadingErrorDetails") }}</small>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="flex flex-col items-center justify-center h-full gap-4 p-4"
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
      class="flex flex-col items-center justify-center h-full gap-3 p-4"
      data-test="rum-player-traces-tab-empty"
    >
      <OIcon name="info" size="lg" class="text-text-muted" />
      <p class="text-center text-text-secondary">
        {{ t("rum.noCorrelatedTraces") }}
      </p>
    </div>

    <!-- Detail view: embedded TraceDetails -->
    <div v-else-if="selectedTrace" class="flex flex-col h-full overflow-hidden">
      <!-- Trace detail header -->
      <div
        class="flex items-center gap-1 px-2 py-1.5 border-b border-solid border-card-glass-border"
      >
        <OButton
          variant="ghost"
          size="xs"
          @click="closeTraceDetail"
          data-test="rum-player-traces-tab-back-btn"
          aria-label="Back"
        >
          <OIcon name="arrow-back" size="sm" />
        </OButton>
        <code class="text-sm text-text-secondary truncate min-w-0 flex-1">{{
          shortRoute(selectedTrace.route) || selectedTrace.label
        }}</code>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <span
            v-if="selectedTrace.metadata?.errorCount > 0"
            class="font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded-default text-2xs bg-status-error-bg! text-status-error-text!"
          >
            <OIcon name="error" size="xs" />
            {{ selectedTrace.metadata.errorCount }}
            {{ selectedTrace.metadata.errorCount === 1 ? t("rum.error") : t("rum.errors") }}
          </span>
          <button
            v-if="selectedTrace.metadata?.start_time && props.startTime > 0"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-default text-2xs bg-surface-accent text-text-body whitespace-nowrap cursor-pointer hover:bg-card-glass-border"
            :title="t('rum.seekToMoment')"
            data-test="rum-player-traces-tab-seek-btn"
            @click="seekToTrace(selectedTrace)"
          >
            <OIcon name="play-arrow" size="xs" class="text-text-secondary" />
            {{ traceTimeOffset(selectedTrace.metadata.start_time) }}
          </button>
          <span
            v-if="selectedTrace.metadata?.e2eDuration"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-default text-2xs bg-surface-accent text-text-body whitespace-nowrap"
          >
            <OIcon name="timer" size="xs" class="text-text-secondary" />
            {{ formatTimeWithSuffix(selectedTrace.metadata.e2eDuration * 1000) }}
          </span>
          <span
            v-if="selectedTrace.metadata?.spanCount"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-default text-2xs bg-surface-accent text-text-body whitespace-nowrap"
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
          stream-name-prop="default"
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
    <div v-else class="flex flex-col overflow-hidden h-full px-2">
      <!-- Filter bar -->
      <div class="flex items-center pr-2 py-1 shrink-0 min-h-8">
        <OTag
          type="logsResultChip"
          value="neutral"
          data-test="rum-player-traces-tab-count-badge"
          class="mr-[0.6rem]"
          >{{
            `${formatLargeNumber(correlatedViews.length)} ${t("menu.traces").toLowerCase()}`
          }}</OTag
        >
        <OTag
          v-if="totalErrorCount > 0"
          type="logsResultChip"
          value="error"
          data-test="rum-player-traces-tab-error-count-badge"
          >{{ `${formatLargeNumber(totalErrorCount)} ${t("rum.errorTraces")}` }}</OTag
        >
      </div>

      <!-- Traces table -->
      <div class="flex-1 min-h-0 overflow-hidden rounded-default">
        <TenstackTable
          :rows="correlatedViews"
          :columns="traceColumns"
          :row-height="32"
          :enable-row-expand="false"
          :enable-text-highlight="false"
          :enable-status-bar="false"
          :default-columns="false"
          :enable-column-reorder="true"
          :enable-ai-context-button="false"
          :row-class="traceRowClass"
          data-test="rum-player-traces-tab-table"
          @click:dataRow="handleTraceRowClick"
        >
          <template #cell-timestamp="{ item, cell }">
            <div
              class="overflow-hidden whitespace-nowrap"
              :style="{ width: cell.column.getSize() + 'px' }"
            >
              <span class="text-xs tabular-nums">
                {{ formatTraceTimestamp(item.metadata?.start_time) }}
              </span>
            </div>
          </template>
          <template #cell-route="{ item, cell }">
            <div class="overflow-hidden" :style="{ width: cell.column.getSize() + 'px' }">
              <span class="truncate font-mono text-xs block" :title="item.route">
                {{ shortRoute(item.route) }}
              </span>
            </div>
          </template>
          <template #cell-duration="{ item, cell }">
            <div
              class="overflow-hidden whitespace-nowrap"
              :style="{ width: cell.column.getSize() + 'px' }"
            >
              <span class="text-xs tabular-nums">
                {{ formatTimeWithSuffix(item.metadata?.e2eDuration * 1000) }}
              </span>
            </div>
          </template>
          <template #cell-status="{ item, cell }">
            <div
              class="overflow-hidden flex items-center"
              :style="{ width: cell.column.getSize() + 'px' }"
            >
              <TraceStatusCell :item="{ errors: item.metadata?.errorCount ?? 0 }" />
            </div>
          </template>
        </TenstackTable>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import searchService from "@/services/search";
import { formatTimeWithSuffix, formatLargeNumber, generateTraceContext } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import TraceStatusCell from "@/plugins/traces/components/TraceStatusCell.vue";
import TenstackTable from "@/components/TenstackTable.vue";
import TraceDetails from "@/plugins/traces/TraceDetails.vue";

const { t } = useI18n();
const store = useStore();

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

const totalErrorCount = computed(
  () => correlatedViews.value.filter((v) => (v.metadata?.errorCount || 0) > 0).length,
);

const { fetchQueryDataWithHttpStream } = useHttpStreaming();

// ── Table column definitions ────────────────────────────────
const traceColumns = computed(() => [
  {
    id: "timestamp",
    header: t("rum.timestamp"),
    accessorFn: (row: any) => row.metadata?.start_time ?? 0,
    size: 100,
    minSize: 100,
    maxSize: 200,
    meta: { align: "left", slot: true },
  },
  {
    id: "route",
    header: t("rum.route"),
    accessorFn: (row: any) => shortRoute(row.route),
    size: 400,
    minSize: 80,
    maxSize: 800,
    meta: { align: "left", slot: true },
  },
  {
    id: "duration",
    header: t("rum.duration"),
    accessorFn: (row: any) => row.metadata?.e2eDuration ?? 0,
    size: 100,
    minSize: 50,
    maxSize: 200,
    meta: { align: "left", slot: true },
  },
  {
    id: "status",
    header: t("common.status"),
    accessorFn: (row: any) => row.metadata?.errorCount ?? 0,
    size: 120,
    minSize: 80,
    maxSize: 180,
    meta: { align: "left", slot: true },
  },
]);

function traceRowClass(row: any): string {
  return row.metadata?.errorCount > 0 ? "trace-row--error" : "";
}

// ── Formatting helpers ──────────────────────────────────────
function shortRoute(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
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
async function fetchTraceMetadata(traceIds: string[]): Promise<Record<string, any>> {
  if (traceIds.length === 0) return {};

  const orgId = store.state.selectedOrganization.identifier;
  const nowMs = Date.now();
  const searchStartTime = (props.startTime || nowMs - 86400000) * 1000;
  const searchEndTime = (props.endTime || nowMs) * 1000;

  // Build filter for multiple trace IDs
  const safeTraceIds = traceIds.map((id) => id.replace(/'/g, "''"));
  const filter =
    safeTraceIds.length === 1
      ? `trace_id='${safeTraceIds[0]}'`
      : `trace_id IN (${safeTraceIds.map((id) => `'${id}'`).join(",")})`;

  return new Promise<Record<string, any>>((resolve, reject) => {
    const traceId = generateTraceContext().traceId;
    const metadata: Record<string, any> = {};

    fetchQueryDataWithHttpStream(
      {
        queryReq: {
          stream_name: "default",
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
          const hits = response.content?.results?.hits || [];
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
        error: (_, error) => reject(error),
        complete: () => resolve(metadata),
        reset: () => {},
      },
    );
  });
}

async function fetchTraces() {
  if (!props.sessionId) return;

  loading.value = true;
  error.value = null;

  try {
    const orgId = store.state.selectedOrganization.identifier;
    const nowMs = Date.now();
    const searchStartTime = (props.startTime || nowMs - 86400000) * 1000;
    const searchEndTime = (props.endTime || nowMs) * 1000;

    const rumQuery = {
      query: {
        sql: `SELECT max(view_id) as _view_id, max(view_url) as _view_url, max(view_loading_type) as _view_loading_type, _oo_trace_id, max(type) as _type, min(date) as _date FROM "_rumdata" WHERE session_id='${props.sessionId}' AND _oo_trace_id IS NOT NULL AND action_id is not null GROUP BY _oo_trace_id ORDER BY _date ASC`,
        start_time: searchStartTime,
        end_time: searchEndTime,
        from: 0,
        size: 250,
      },
    };

    const rumResponse = await searchService.search(
      {
        org_identifier: orgId,
        query: rumQuery,
        page_type: "logs",
      },
      "RUM",
    );

    const rumHits = rumResponse.data?.hits || [];

    if (rumHits.length === 0) {
      correlatedViews.value = [];
      return;
    }

    // Deduplicate by trace_id, keep first occurrence for view context
    const traceMap = new Map<string, any>();
    for (const hit of rumHits) {
      const traceId = hit._oo_trace_id;
      if (!traceId || traceMap.has(traceId)) continue;
      const viewUrl = hit._view_url || hit.view_url || "";
      traceMap.set(traceId, {
        traceId,
        rumDate: hit._date || 0,
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
        const metadata = await fetchTraceMetadata(views.map((v) => v.traceId));

        // Only keep views whose trace_id exists in the traces stream, sorted by start time
        filteredViews = views
          .filter((view) => metadata[view.traceId])
          .map((view) => {
            const meta = metadata[view.traceId];
            const e2eDuration =
              view.rumDate && meta.end_time
                ? Math.max(0, Math.floor(meta.end_time / 1_000_000) - view.rumDate)
                : 0;
            return { ...view, metadata: { ...meta, e2eDuration: e2eDuration } };
          })
          .sort((a, b) => (a.metadata.start_time ?? 0) - (b.metadata.start_time ?? 0));

        traceMetadata.value = metadata;
      } catch (err: any) {
        metadataError.value = err?.message || "Failed to fetch trace metadata";
        console.warn("Trace metadata fetch failed:", err);
      } finally {
        metadataLoading.value = false;
      }
    }

    correlatedViews.value = filteredViews;
  } catch (err: any) {
    error.value = err?.message || t("rum.failedToFetchTraces");
  } finally {
    loading.value = false;
  }
}

function openTraceDetail(view: any) {
  selectedTrace.value = view;

  const nowMs = Date.now();
  const fallbackStart = (props.startTime || nowMs - 86400000) * 1000;
  const fallbackEnd = (props.endTime || nowMs) * 1000;

  const meta = traceMetadata.value[view.traceId];
  if (meta?.start_time && meta?.end_time) {
    const ONE_MINUTE_US = 60_000_000;
    selectedTraceStartTime.value = Math.floor(meta.start_time / 1000) - ONE_MINUTE_US;
    selectedTraceEndTime.value = Math.ceil(meta.end_time / 1000) + ONE_MINUTE_US;
  } else {
    selectedTraceStartTime.value = fallbackStart;
    selectedTraceEndTime.value = fallbackEnd;
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
    selectedTrace.value = null;
    closeTraceDetail();
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
