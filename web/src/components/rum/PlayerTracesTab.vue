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
  <div class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:gap-3"
      data-test="rum-player-traces-tab-loading"
    >
      <OSpinner size="md" />
      <small>{{ t("rum.loadingErrorDetails") }}</small>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:gap-4 tw:p-4"
      data-test="rum-player-traces-tab-error"
    >
      <OIcon name="error-outline" size="lg" class="tw:text-[var(--o2-status-error)]" />
      <p class="tw:text-center">{{ error }}</p>
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
      class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:gap-3 tw:p-4"
      data-test="rum-player-traces-tab-empty"
    >
      <OIcon name="info" size="lg" class="tw:text-[var(--o2-text-muted)]" />
      <p class="tw:text-center tw:text-[var(--o2-text-secondary)]">
        {{ t("rum.noCorrelatedTraces") }}
      </p>
    </div>

    <!-- Detail view: embedded TraceDetails -->
    <div
      v-else-if="selectedTrace"
      class="tw:flex tw:flex-col tw:h-full tw:overflow-hidden"
    >
      <!-- Trace detail header -->
      <div class="tw:flex tw:items-center tw:gap-1 tw:px-2 tw:py-1.5 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]">
        <OButton
          variant="ghost"
          size="xs"
          @click="closeTraceDetail"
          data-test="rum-player-traces-tab-back-btn"
          aria-label="Back"
        >
          <OIcon name="arrow-back" size="sm" />
        </OButton>
        <code class="tw:text-sm tw:text-[var(--o2-text-secondary)] tw:truncate tw:min-w-0 tw:flex-1">{{ shortRoute(selectedTrace.route) || selectedTrace.label }}</code>
        <div class="tw:flex tw:items-center tw:gap-1.5 tw:flex-shrink-0">
          <span
            v-if="selectedTrace.metadata?.start_time && props.startTime > 0"
            class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-hover-accent)] tw:text-[var(--o2-text-body)] tw:whitespace-nowrap"
          >
            <OIcon name="schedule" size="xs" class="tw:text-[var(--o2-text-secondary)]" />
            {{ traceTimeOffset(selectedTrace.metadata.start_time) }}
          </span>
          <span
            v-if="selectedTrace.metadata?.duration"
            class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-hover-accent)] tw:text-[var(--o2-text-body)] tw:whitespace-nowrap"
          >
            <OIcon name="timer" size="xs" class="tw:text-[var(--o2-text-secondary)]" />
            {{ formatDuration(selectedTrace.metadata.duration / 1000) }}
          </span>
          <span
            v-if="selectedTrace.metadata?.spanCount"
            class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-hover-accent)] tw:text-[var(--o2-text-body)] tw:whitespace-nowrap"
          >
            <OIcon name="lan" size="xs" class="tw:text-[var(--o2-text-secondary)]" />
            {{ selectedTrace.metadata.spanCount }} {{ selectedTrace.metadata.spanCount === 1 ? t("rum.span") : t("rum.spans") }}
          </span>
          <span
            v-if="selectedTrace.metadata?.errorCount > 0"
            class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-status-error)]/10 tw:text-[var(--o2-status-error)]"
          >
            <OIcon name="error" size="xs" />
            {{ selectedTrace.metadata.errorCount }} {{ selectedTrace.metadata.errorCount === 1 ? t("rum.error") : t("rum.errors") }}
          </span>
        </div>
      </div>
      <div class="tw:flex-1 tw:overflow-hidden">
        <TraceDetails
          mode="embedded"
          :trace-id-prop="selectedTrace.traceId"
          stream-name-prop="default"
          :span-list-prop="[]"
          :start-time-prop="selectedTraceStartTime"
          :end-time-prop="selectedTraceEndTime"
          :show-header="false"
          :show-back-button="false"
          :show-timeline="true"
          :show-log-stream-selector="false"
          :show-share-button="false"
          :show-close-button="false"
          :show-expand-button="true"
          :enable-correlation-links="true"
          :initial-timeline-expanded="false"
        />
      </div>
    </div>

    <!-- List view -->
    <div v-else class="tw:flex tw:flex-col tw:overflow-hidden tw:h-full">
      <!-- Filter bar -->
      <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]">
        <small class="tw:text-[var(--o2-text-secondary)] tw:font-semibold">
          {{ correlatedViews.length }} {{ t("menu.traces").toLowerCase() }}
        </small>
        <div class="tw:flex-1" />
      </div>

      <!-- Trace cards list -->
      <div class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:overflow-x-hidden tw:px-2 tw:py-2 tw:flex tw:flex-col tw:gap-2">
        <OCard
          v-for="(view, index) in correlatedViews"
          :key="view.traceId"
          class="tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:overflow-hidden tw:min-h-fit! tw:h-fit! tw:cursor-pointer"
          :data-test="`rum-player-traces-tab-trace-card-${index}`"
          @click="openTraceDetail(view)"
        >
          <!-- Card header -->
          <OCardSection class="tw:flex tw:items-center tw:gap-2 tw:px-2.5 tw:pt-2 tw:pb-1.5">
            <code class="tw:text-[0.6875rem] tw:text-[var(--o2-text-secondary)] tw:truncate tw:min-w-0 tw:flex-1">
              {{ shortRoute(view.route) }}
            </code>
            <OBadge
              v-if="view.metadata?.errorCount > 0"
              variant="error-outline"
              size="sm"
              class="tw:flex-shrink-0 tw:px-1.5! tw:py-1!"
            >
              <OIcon name="error" size="xs" class="tw:mr-0.5" />
              {{ view.metadata.errorCount }} {{ view.metadata.errorCount === 1 ? t("rum.error") : t("rum.errors") }}
            </OBadge>
          </OCardSection>

          <!-- Card body: Trace metadata -->
          <OCardSection v-if="view.metadata" class="tw:flex tw:flex-wrap tw:gap-1 tw:px-2.5 tw:pb-2">
            <!-- Duration -->
            <span class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-hover-accent)] tw:text-[var(--o2-text-body)] tw:whitespace-nowrap">
              <OIcon name="timer" size="xs" class="tw:text-[var(--o2-text-secondary)]" />
              {{ formatTimeWithSuffix(view.metadata.duration) }}
            </span>

            <!-- Service count -->
            <span class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-hover-accent)] tw:text-[var(--o2-text-body)] tw:whitespace-nowrap">
              <OIcon name="lan" size="xs" class="tw:text-[var(--o2-text-secondary)]" />
              {{ view.metadata.serviceCount }} {{ view.metadata.serviceCount > 1 ? 'services' : 'service' }}
            </span>

            <!-- Root operation -->
            <span class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-hover-accent)] tw:text-[var(--o2-text-body)] tw:whitespace-nowrap">
              {{ view.metadata.rootService }} → {{ view.metadata.rootOperation }}
            </span>
          </OCardSection>
        </OCard>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import searchService from "@/services/search";
import { formatDuration, formatTimeWithSuffix, generateTraceContext } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
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
const traceMetadata = ref<Record<string, any>>({});
const metadataLoading = ref(false);
const metadataError = ref<string | null>(null);

const {fetchQueryDataWithHttpStream} = useHttpStreaming();

// ── Formatting helpers ──────────────────────────────────────
function shortRoute(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search || "/";
  } catch {
    return url;
  }
}

function traceTimeOffset(startTimeUs: number): string {
  const sessionStartMs = props.startTime;
  if (!sessionStartMs) return "";
  const offsetMs = Math.max(0, Math.floor(startTimeUs / 1000) - sessionStartMs);
  const totalSec = Math.floor(offsetMs / 1000);
  const min = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const sec = (totalSec % 60).toString().padStart(2, "0");
  return `@ ${min}:${sec}`;
}

// ── Data fetching ───────────────────────────────────────────
async function fetchTraceMetadata(traceIds: string[]) {
  if (traceIds.length === 0) return {};

  const orgId = store.state.selectedOrganization.identifier;
  const nowMs = Date.now();
  const searchStartTime = (props.startTime || (nowMs - 86400000)) * 1000;
  const searchEndTime = (props.endTime || nowMs) * 1000;

  // Build filter for multiple trace IDs
  const safeTraceIds = traceIds.map(id => id.replace(/'/g, "''"));
  const filter = safeTraceIds.length === 1
    ? `trace_id='${safeTraceIds[0]}'`
    : `trace_id IN (${safeTraceIds.map(id => `'${id}'`).join(',')})`;

  return new Promise((resolve, reject) => {
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
          console.log(hits);
          hits.forEach((hit: any) => {
            metadata[hit.trace_id] = {
              duration: hit.duration,
              spanCount: hit.spans?.[0] || 0,
              errorCount: hit.spans?.[1] || 0,
              serviceCount: hit.service_name?.length || 0,
              rootService: hit.first_event?.service_name || 'unknown',
              rootOperation: hit.first_event?.operation_name || 'unknown',
              start_time: hit.start_time,
              end_time: hit.end_time,
            };
          });
        },
        error: (_, error) => reject(error),
        complete: () => resolve(metadata),
        reset: () => {}
      }
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
    const searchStartTime = (props.startTime || (nowMs - 86400000)) * 1000;
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
        route: viewUrl,
        label: viewUrl ? shortRoute(viewUrl).replace(/\/$/, "") || "/" : traceId,
        kind: (hit._view_loading_type || hit.view_loading_type) === "initial_load" ? "load" : "route_change",
        viewId: hit._view_id || hit.view_id || "",
      });
    }

    const views = Array.from(traceMap.values());

    // Fetch trace metadata for all trace IDs and filter to only those present in traces
    let filteredViews = views;
    if (views.length > 0) {
      metadataLoading.value = true;
      try {
        const metadata = await fetchTraceMetadata(views.map(v => v.traceId));

        // Only keep views whose trace_id exists in the traces stream
        filteredViews = views
          .filter(view => metadata[view.traceId])
          .map(view => ({ ...view, metadata: metadata[view.traceId] }));

        traceMetadata.value = metadata;
      } catch (err: any) {
        metadataError.value = err?.message || 'Failed to fetch trace metadata';
        console.warn('Trace metadata fetch failed:', err);
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
  const fallbackStart = (props.startTime || (nowMs - 86400000)) * 1000;
  const fallbackEnd = (props.endTime || nowMs) * 1000;

  const meta = traceMetadata.value[view.traceId];
  console.log(traceMetadata, view, meta);
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

<style scoped lang="scss">
.player-traces-tab {
  height: 100%;
  overflow: hidden;
}

.body--dark {
  .hover\:tw\:bg-\[var\(--o2-hover-accent\)\]:hover {
    background: var(--o2-hover-accent);
  }
}
</style>
