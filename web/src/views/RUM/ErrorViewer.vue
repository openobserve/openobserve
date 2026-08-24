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
  <div data-test="error-viewer-container" class="bg-card-glass-bg h-full overflow-y-auto">
    <template v-if="isLoading.length">
      <div class="flex h-[calc(100vh-12.5rem)] items-center justify-center pb-4 text-center">
        <div>
          <OSpinner size="md" class="mx-auto block" data-test="error-viewer-loading-indicator" />
          <div class="w-full text-center">
            {{ t("rum.loadingErrorDetails") }}
          </div>
        </div>
      </div>
    </template>
    <div v-else class="pb-4">
      <div class="py-2.5">
        <ErrorHeader :error="errorDetails" />
      </div>
      <OSeparator class="w-full" />

      <div class="px-page-edge flex flex-col gap-3 py-3">
        <ErrorImpactStrip
          :impact="impact"
          :loading="isLoadingImpact"
          :has-signature="hasSignature"
        />

        <!--
          Two columns: the diagnosis path (what happened, in code) on the left,
          the corroborating evidence (replay, backend trace, who/where) on the
          right. Collapses to one column below xl, keeping that reading order.
        -->
        <div class="grid grid-cols-1 gap-3 xl:grid-cols-3">
          <div class="flex min-w-0 flex-col gap-3 xl:col-span-2">
            <ErrorOccurrencesChart
              :buckets="occurrences"
              :loading="isLoadingInsights"
              :current-timestamp="errorDetails._timestamp"
            />
            <ErrorStackTrace :error_stack="errorDetails.error_stack || []" :error="errorDetails" />
            <ErrorEvents :error="errorDetails" />
          </div>

          <aside class="flex min-w-0 flex-col gap-3">
            <ErrorSessionReplay :error="errorDetails" />
            <TraceCorrelationCard
              v-if="errorTraceId"
              :trace-id="errorTraceId"
              :session-id="errorDetails.session_id || ''"
              :timestamp="errorDetails._timestamp || 0"
              data-test="error-viewer-trace-correlation"
            />
            <ErrorFacetBreakdown :facets="facets" :loading="isLoadingInsights" />
            <ErrorContextCard :error="errorDetails" />
          </aside>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Explicit name so <keep-alive :include> in RealUserMonitoring.vue matches this
// view. Without it the name is inferred from the FILENAME, so renaming the file
// would silently drop it from the cache and bring back the refetch-on-return.
defineOptions({ name: "ErrorViewer" });

import { computed, onActivated, onBeforeUnmount, onDeactivated, ref } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import ErrorHeader from "@/components/rum/errorTracking/view/ErrorHeader.vue";
import ErrorEvents from "@/components/rum/errorTracking/view/ErrorEvents.vue";
import ErrorSessionReplay from "@/components/rum/errorTracking/view/ErrorSessionReplay.vue";
import ErrorStackTrace from "@/components/rum/errorTracking/view/ErrorStackTrace.vue";
import ErrorImpactStrip from "@/components/rum/errorTracking/view/ErrorImpactStrip.vue";
import ErrorOccurrencesChart from "@/components/rum/errorTracking/view/ErrorOccurrencesChart.vue";
import ErrorFacetBreakdown from "@/components/rum/errorTracking/view/ErrorFacetBreakdown.vue";
import ErrorContextCard from "@/components/rum/errorTracking/view/ErrorContextCard.vue";
import TraceCorrelationCard from "@/components/rum/correlation/TraceCorrelationCard.vue";
import useErrorTracking from "@/composables/useErrorTracking";
import useErrorDetail from "@/composables/rum/useErrorDetail";
import useStreams from "@/composables/useStreams";
import searchService from "@/services/search";
import { rumField } from "@/utils/rum/fields";
import { buildBreadcrumbsSql, type ErrorDetailContext } from "@/utils/rum/errorDetailQueries";
import { useI18nTyped } from "@/types/i18n";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";

const { t } = useI18nTyped();

const isLoading = ref<boolean[]>([]);
const router = useRouter();
const store = useStore();
const { errorTrackingState } = useErrorTracking();
const { getStream } = useStreams(t);
const errorDetails = ref<any>({});
const streamSchema = ref<Record<string, boolean>>({});

const {
  impact,
  occurrences,
  facets,
  hasSignature,
  isLoadingImpact,
  isLoadingInsights,
  fetchDetail,
  cancelAll,
} = useErrorDetail(t);

/** Breadcrumbs are read from a bounded slice of the session around the error. */
const BREADCRUMB_WINDOW_US = 1_800_000_000;
/** Steps shown leading up to the failure, and the few that follow it. */
const BREADCRUMBS_BEFORE = 30;
const BREADCRUMBS_AFTER = 5;
/** Fallback analysis window when the page is opened without one (deep link). */
const DEFAULT_ANALYSIS_SPAN_US = 86_400_000_000;

onActivated(() => {
  // Each stage already degrades on its own; this only stops an unexpected
  // rejection surfacing as an unhandled promise.
  load().catch(() => {
    isLoading.value = [];
  });
});

// Leaving frees the searches this page started; the server holds a work-group
// slot until each request completes, so abandoned runs starve the next view.
onBeforeUnmount(() => cancelAll());
onDeactivated(() => cancelAll());

const getTimestamp = computed(() => {
  return Number(router.currentRoute.value.query.timestamp) || 30000;
});

// Trace id linking this error to a backend trace: on the error itself, or
// on the nearest xhr/fetch event captured around the failure.
const errorTraceId = computed(() => {
  if (rumField(errorDetails.value, "trace_id")) {
    return rumField<string>(errorDetails.value, "trace_id");
  }
  const xhrWithTrace = (errorDetails.value?.events || []).find(
    (event: any) => event.type === "resource" && rumField(event, "trace_id"),
  );
  return rumField<string>(xhrWithTrace, "trace_id") || "";
});

/**
 * The window the issue-level aggregates are computed over. It mirrors the range
 * the errors list was queried with, so "12 occurrences" on this page means the
 * same thing as the row the user clicked. A deep link has no such range, so it
 * falls back to the day ending at the error.
 */
const analysisRange = computed(() => {
  const { startTime, endTime } = errorTrackingState.data.datetime ?? {};
  if (startTime && endTime && endTime > startTime) return { startTime, endTime };
  const end = getTimestamp.value;
  return { startTime: end - DEFAULT_ANALYSIS_SPAN_US, endTime: end + 1 };
});

const load = async () => {
  await Promise.all([getError(), loadSchema()]);
  if (!errorDetails.value?.error_id && !errorDetails.value?.error_message) return;
  getErrorLogs();
  fetchDetail({
    signature: {
      error_type: errorDetails.value.error_type,
      error_message: errorDetails.value.error_message,
      error_handling: errorDetails.value.error_handling,
    },
    schema: streamSchema.value,
    ...analysisRange.value,
  });
};

const loadSchema = async () => {
  // The SQL builders name optional columns, and naming one the stream lacks
  // fails the WHOLE query — so the schema decides which aggregates can run.
  try {
    const stream = await getStream(errorTrackingState.data.stream.errorStream, "logs", true);
    const presence: Record<string, boolean> = {};
    for (const field of stream?.schema ?? []) presence[field.name] = true;
    streamSchema.value = presence;
  } catch {
    streamSchema.value = {};
  }
};

const detailContext = computed<ErrorDetailContext>(() => ({
  streamName: errorTrackingState.data.stream.errorStream,
  timestampColumn: store.state.zoConfig.timestamp_column || "_timestamp",
  schema: streamSchema.value,
  signature: {},
}));

/**
 * The breadcrumb trail: what this user did in THIS session before the crash.
 * Scoped to the session id — an unscoped read returns whatever the stream
 * happened to receive in the window, i.e. other people's clicks presented as
 * the reproduction steps.
 */
const getErrorLogs = () => {
  const sessionId = errorDetails.value.session_id;
  if (!sessionId) {
    errorDetails.value.events = [];
    return;
  }

  const errorTs = Number(errorDetails.value._timestamp) || getTimestamp.value;
  isLoading.value.push(true);
  searchService
    .search(
      {
        org_identifier: store.state.selectedOrganization.identifier,
        query: {
          query: {
            sql: buildBreadcrumbsSql(detailContext.value, sessionId),
            start_time: errorTs - BREADCRUMB_WINDOW_US,
            end_time: errorTs + BREADCRUMB_WINDOW_US,
            from: 0,
            size: 500,
          },
        },
        page_type: "logs",
      },
      "RUM",
    )
    .then((res) => {
      const hits = res.data.hits ?? [];
      const errorIndex = hits.findIndex((hit: any) => hit.error_id === errorDetails.value.error_id);
      // Without the error in the result set, anchor on the tail so the user
      // still sees the most recent activity rather than an empty timeline.
      const anchor = errorIndex >= 0 ? errorIndex : hits.length - 1;
      errorDetails.value.events = hits
        .slice(Math.max(0, anchor - BREADCRUMBS_BEFORE), anchor + BREADCRUMBS_AFTER + 1)
        .map((event: any) => ({ ...event, category: getErrorCategory(event) }));
    })
    .catch(() => {
      errorDetails.value.events = [];
    })
    .finally(() => isLoading.value.pop());
};

const getErrorCategory = (row: any) => {
  if (row["type"] === "error") return row["error_type"] || "Error";
  else if (row["type"] === "resource") return row["resource_type"];
  else if (row["type"] === "view")
    return row["view_loading_type"] === "route_change" ? "Navigation" : "Reload";
  else if (row["type"] === "action") return row["action_type"];
  else return row["type"];
};

const getError = () => {
  return new Promise((resolve) => {
    const req = {
      query: {
        sql: 'select *[QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE]',
        start_time: getTimestamp.value - 1,
        end_time: getTimestamp.value + 1,
        from: 0,
        size: 10,
      },
    };

    req.query.sql = `select * from ${errorTrackingState.data.stream.errorStream} where type='error' and ${store.state.zoConfig.timestamp_column}=${getTimestamp.value} order by ${store.state.zoConfig.timestamp_column} desc`;
    isLoading.value.push(true);
    searchService
      .search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: req,
          page_type: "logs",
        },
        "RUM",
      )
      .then((res) => {
        errorDetails.value = { ...res.data.hits[0] };
        errorDetails.value["category"] = [];
        // Prioritize error_stack (actual application error) over error_handling_stack (Vue internals)
        const errorStack =
          errorDetails.value.error_stack || errorDetails.value.error_handling_stack;
        errorDetails.value.error_stack = errorStack ? errorStack.split("\n") : [];
        // Keep the original stack for translation
        errorDetails.value.original_error_stack = errorDetails.value.error_stack;
      })
      .finally(() => {
        isLoading.value.pop();
        resolve(true);
      });
  });
};
</script>
