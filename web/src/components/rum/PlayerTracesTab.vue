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
      <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:border-b tw:border-solid tw:border-[var(--o2-border-color)]">
        <OButton
          variant="ghost"
          size="sm"
          @click="closeTraceDetail"
          data-test="rum-player-traces-tab-back-btn"
        >
          <template #icon-left>
            <OIcon name="arrow-back" size="sm" />
          </template>
          {{ t("common.back") }}
        </OButton>
        <OSeparator vertical class="tw:h-4" />
        <small class="tw:text-[var(--o2-text-secondary)]">{{ selectedTrace.label }}</small>
      </div>
      <!-- Trace loading state -->
      <div
        v-if="traceLoading"
        class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:gap-3"
        data-test="rum-player-traces-tab-trace-loading"
      >
        <OSpinner size="md" />
        <small>{{ t("rum.loadingErrorDetails") }}</small>
      </div>
      <!-- Trace error state -->
      <div
        v-else-if="traceError"
        class="tw:flex tw:flex-col tw:items-center tw:justify-center tw:h-full tw:gap-4 tw:p-4"
        data-test="rum-player-traces-tab-trace-error"
      >
        <OIcon name="error-outline" size="lg" class="tw:text-[var(--o2-status-error)]" />
        <p class="tw:text-center">{{ traceError }}</p>
        <OButton
          variant="outline"
          size="sm-action"
          @click="openTraceDetail(selectedTrace)"
          data-test="rum-player-traces-tab-trace-retry-btn"
        >
          {{ t("common.retry") }}
        </OButton>
      </div>
      <!-- Embedded TraceDetails -->
      <div v-else class="tw:flex-1 tw:overflow-hidden">
        <TraceDetails
          mode="embedded"
          :trace-id-prop="selectedTrace.traceId"
          stream-name-prop="default"
          :span-list-prop="selectedTraceSpanList"
          :start-time-prop="selectedTraceStartTime"
          :end-time-prop="selectedTraceEndTime"
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
        <div
          v-for="(view, index) in correlatedViews"
          :key="view.traceId"
          class="tw:border tw:border-solid tw:rounded-lg tw:overflow-hidden tw:border-[var(--o2-border-color)] tw:min-h-fit! tw:h-fit!"
          :data-test="`rum-player-traces-tab-trace-card-${index}`"
        >
          <!-- Card header -->
          <div class="tw:flex tw:items-start tw:gap-2 tw:p-2">
            <div class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col">
              <div class="tw:flex tw:items-center tw:gap-2">
                <h4 class="tw:text-sm tw:font-semibold tw:truncate tw:text-[var(--o2-text-heading)]">
                  {{ view.label }}
                </h4>
                <OBadge :variant="view.kind === 'load' ? 'default' : 'primary'" size="sm">
                  {{ view.kind === "load" ? t("rum.initialView") : t("rum.routeChange") }}
                </OBadge>
              </div>
              <code class="tw:text-[0.6875rem] tw:text-[var(--o2-text-secondary)] tw:truncate tw:block">
                {{ shortRoute(view.route) }}
              </code>
            </div>
          </div>

          <!-- Card body: Trace metadata -->
          <div v-if="view.metadata" class="tw:flex tw:flex-wrap tw:gap-1 tw:px-2.5 tw:pb-2">
            <!-- Duration -->
            <span class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-hover-accent)] tw:text-[var(--o2-text-body)]">
              <OIcon name="timer" size="xs" class="tw:text-[var(--o2-text-secondary)]" />
              {{ formatTimeWithSuffix(view.metadata.duration) }}
            </span>

            <!-- Error count (if any) -->
            <span
              v-if="view.metadata.errorCount > 0"
              class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-status-error)]/10 tw:text-[var(--o2-status-error)]"
            >
              <OIcon name="error" size="xs" />
              {{ view.metadata.errorCount }} {{ view.metadata.errorCount > 1 ? t("rum.errors") : t("rum.error") }}
            </span>

            <!-- Service count -->
            <span class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-hover-accent)] tw:text-[var(--o2-text-body)]">
              <OIcon name="lan" size="xs" class="tw:text-[var(--o2-text-secondary)]" />
              {{ view.metadata.serviceCount }} {{ view.metadata.serviceCount > 1 ? 'services' : 'service' }}
            </span>

            <!-- Root operation -->
            <span class="tw:inline-flex tw:items-center tw:gap-1 tw:px-1.5 tw:py-0.5 tw:rounded tw:text-[0.6875rem] tw:bg-[var(--o2-hover-accent)] tw:text-[var(--o2-text-body)]">
              {{ view.metadata.rootService }} → {{ view.metadata.rootOperation }}
            </span>
          </div>

          <!-- Card footer -->
          <div class="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:border-t tw:border-solid tw:border-[var(--o2-border-color)]">
            <code class="tw:text-[0.625rem] tw:text-[var(--o2-text-secondary)] tw:bg-[var(--o2-hover-accent)] tw:px-1.5 tw:py-0.5 tw:rounded tw:truncate">
              {{ view.traceId }}
            </code>
            <div class="tw:flex-1" />
            <OButton
              variant="outline"
              size="xs"
              @click.stop="openTraceDetail(view)"
              :data-test="`rum-player-traces-tab-view-details-btn-${index}`"
            >
              <template #icon-left>
                <OIcon name="open-in-new" size="xs" />
              </template>
              {{ t("rum.viewTraceDetails") }}
            </OButton>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import searchService from "@/services/search";
import { b64EncodeUnicode, formatTimeWithSuffix, generateTraceContext } from "@/utils/zincutils";
import useHttpStreaming from "@/composables/useStreamingSearch";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
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
const selectedTraceSpanList = ref<any[]>([]);
const selectedTraceStartTime = ref(0);
const selectedTraceEndTime = ref(0);
const traceLoading = ref(false);
const traceError = ref<string | null>(null);
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
          hits.forEach((hit: any) => {
            metadata[hit.trace_id] = {
              duration: hit.duration,
              spanCount: hit.spans?.[0] || 0,
              errorCount: hit.spans?.[1] || 0,
              serviceCount: hit.service_name?.length || 0,
              rootService: hit.first_event?.service_name || 'unknown',
              rootOperation: hit.first_event?.operation_name || 'unknown'
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
      traceMap.set(traceId, {
        traceId,
        route: hit.view_url || "",
        label: hit.view_url ? shortRoute(hit.view_url).replace(/\/$/, "") || "/" : "View",
        kind: hit.view_loading_type === "initial_load" ? "load" : "route_change",
        viewId: hit.view_id || "",
      });
    }

    const views = Array.from(traceMap.values());

    // Fetch trace metadata for all trace IDs
    if (views.length > 0) {
      metadataLoading.value = true;
      try {
        const metadata = await fetchTraceMetadata(views.map(v => v.traceId));

        // Merge metadata into views
        views.forEach(view => {
          view.metadata = metadata[view.traceId] || null;
        });

        traceMetadata.value = metadata;
      } catch (err: any) {
        metadataError.value = err?.message || 'Failed to fetch trace metadata';
        console.warn('Trace metadata fetch failed:', err);
      } finally {
        metadataLoading.value = false;
      }
    }

    correlatedViews.value = views;
  } catch (err: any) {
    error.value = err?.message || t("rum.failedToFetchTraces");
  } finally {
    loading.value = false;
  }
}

async function openTraceDetail(view: any) {
  selectedTrace.value = view;
  traceLoading.value = true;
  traceError.value = null;

  try {
    const orgId = store.state.selectedOrganization.identifier;
    const nowMs = Date.now();
    const searchStartTime = (props.startTime || (nowMs - 86400000)) * 1000;
    const searchEndTime = (props.endTime || nowMs) * 1000;
    const traceStream = "default";

    // Fetch trace metadata for time range
    const traceMetaResponse = await searchService.get_traces({
      org_identifier: orgId,
      start_time: searchStartTime,
      end_time: searchEndTime,
      filter: `trace_id='${view.traceId}'`,
      size: 1,
      from: 0,
      stream_name: traceStream,
    });

    const traceMeta = traceMetaResponse.data?.hits?.[0];
    if (!traceMeta) {
      traceError.value = t("rum.traceNotFound");
      traceLoading.value = false;
      return;
    }

    const traceStartTime = Math.floor(traceMeta.start_time / 1000) - 10000;
    const traceEndTime = Math.ceil(traceMeta.end_time / 1000) + 10000;

    // Fetch all spans
    const spansQuery = {
      query: {
        sql: b64EncodeUnicode(
          `SELECT * FROM "${traceStream}" WHERE trace_id = '${view.traceId}' ORDER BY start_time`,
        ),
        start_time: traceStartTime,
        end_time: traceEndTime,
        from: 0,
        size: 2500,
      },
      encoding: "base64",
    };

    const spansResponse = await searchService.search(
      {
        org_identifier: orgId,
        query: spansQuery,
        page_type: "traces",
      },
      "ui",
    );

    const spans = spansResponse.data?.hits || [];
    const rootSpan = spans[0] || {};

    selectedTraceSpanList.value = spans.map((s: any) => ({
      ...s,
      depth: s.depth || 0,
      kind: s.span_kind || "i",
      op: s.operation_name || s.operation || "span",
      dur: s.duration || 0,
      start: s.start_time ? s.start_time - rootSpan.start_time : 0,
      svc: s.service_name || s.service || "unknown",
    }));
    selectedTraceStartTime.value = traceStartTime;
    selectedTraceEndTime.value = traceEndTime;
  } catch (err: any) {
    traceError.value = err?.message || t("rum.failedToFetchTraceDetails");
  } finally {
    traceLoading.value = false;
  }
}

function closeTraceDetail() {
  selectedTrace.value = null;
  selectedTraceSpanList.value = [];
  selectedTraceStartTime.value = 0;
  selectedTraceEndTime.value = 0;
  traceLoading.value = false;
  traceError.value = null;
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
