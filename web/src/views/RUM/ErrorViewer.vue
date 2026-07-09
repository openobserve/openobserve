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
  <div
    data-test="error-viewer-container"
    class="card-container h-full overflow-y-auto"
  >
    <template v-if="isLoading.length">
      <div
        class="pb-4 flex items-center justify-center text-center h-[calc(100vh-12.5rem)]"
      >
        <div>
          <OSpinner
            size="md"
            class="mx-auto block"
            data-test="error-viewer-loading-indicator"
          />
          <div class="text-center w-full">
            {{ t("rum.loadingErrorDetails") }}
          </div>
        </div>
      </div>
    </template>
    <div v-else>
      <div class="p-[0.625rem]">
        <ErrorHeader :error="errorDetails" />
      </div>
      <OSeparator class="w-full" />
      <div class="p-[0.625rem] flex flex-col gap-3">
        <!-- Impact: how bad, how new — answered above the fold -->
        <ErrorImpactStrip
          :metrics="metrics"
          :spike-factor="deploySpikeFactor"
          :release="errorDetails.version || null"
          :loading="impactLoading"
        />

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
          <!-- Root-cause narrative: trend -> user actions -> stack -->
          <div class="lg:col-span-2 flex flex-col gap-3 min-w-0">
            <div
              class="h-[13.75rem] min-w-0"
              data-test="error-viewer-occurrences-chart"
            >
              <ErrorsOverTimeChart
                :buckets="chartBuckets"
                :deploy="latestDeploy"
                :spike-factor="deploySpikeFactor"
                :loading="impactLoading"
              />
            </div>
            <ErrorEvents :error="errorDetails" />
            <ErrorStackTrace
              :error_stack="errorDetails.error_stack || []"
              :error="errorDetails"
            />
          </div>

          <!-- Evidence: replay, backend trace, context -->
          <aside class="flex flex-col gap-3 min-w-0">
            <ErrorSessionReplay :error="errorDetails" />
            <TraceCorrelationCard
              v-if="errorTraceId"
              :trace-id="errorTraceId"
              :session-id="errorDetails.session_id || ''"
              :timestamp="errorDetails._timestamp || 0"
              data-test="error-viewer-trace-correlation"
            />
            <ErrorTags :error="errorDetails" />
          </aside>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from "vue";
import ErrorHeader from "@/components/rum/errorTracking/view/ErrorHeader.vue";
import ErrorTags from "@/components/rum/errorTracking/view/ErrorTags.vue";
import ErrorEvents from "@/components/rum/errorTracking/view/ErrorEvents.vue";
import ErrorSessionReplay from "@/components/rum/errorTracking/view/ErrorSessionReplay.vue";
import { useRouter } from "vue-router";
import useQuery from "@/composables/useQuery";
import { useStore } from "vuex";
import useErrorTracking from "@/composables/useErrorTracking";
import searchService from "@/services/search";
import ErrorStackTrace from "@/components/rum/errorTracking/view/ErrorStackTrace.vue";
import ErrorImpactStrip from "@/components/rum/errorTracking/view/ErrorImpactStrip.vue";
import ErrorsOverTimeChart from "@/components/rum/errorTracking/list/ErrorsOverTimeChart.vue";
import TraceCorrelationCard from "@/components/rum/correlation/TraceCorrelationCard.vue";
import useErrorImpact from "@/composables/rum/useErrorImpact";
import { useI18n } from "vue-i18n";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

const { t } = useI18n();

const isLoading = ref<boolean[]>([]);
const router = useRouter();
const { getTimeInterval, parseQuery, buildQueryPayload } = useQuery();
const store = useStore();
const { errorTrackingState } = useErrorTracking();
const errorDetails = ref<any>({});

// Issue-scoped impact: occurrences, users, crash-free, trend + deploy markers.
const {
  metrics,
  chartBuckets,
  latestDeploy,
  deploySpikeFactor,
  isLoading: impactLoading,
  loadForError,
} = useErrorImpact();

onActivated(async () => {
  await getError();
  getErrorLogs();
  if (errorDetails.value?.error_type || errorDetails.value?.error_message) {
    loadForError(errorDetails.value, errorDetails.value.service || "");
  }
});

const getTimestamp = computed(() => {
  return Number(router.currentRoute.value.query.timestamp) || 30000;
});

// Trace id linking this error to a backend trace: on the error itself, or
// on the nearest xhr/fetch event captured around the failure.
const errorTraceId = computed(() => {
  if (errorDetails.value?._oo_trace_id) {
    return errorDetails.value._oo_trace_id as string;
  }
  const xhrWithTrace = (errorDetails.value?.events || []).find(
    (event: any) => event.type === "resource" && event._oo_trace_id,
  );
  return (xhrWithTrace?._oo_trace_id as string) || "";
});

const getErrorLogs = () => {
  const req = {
    query: {
      sql: 'select *[QUERY_FUNCTIONS] from "[INDEX_NAME]" [WHERE_CLAUSE]',
      start_time: getTimestamp.value - 3600000000,
      end_time: getTimestamp.value + 1,
      from: 0,
      size: 150,
    },
  };

  req.query.sql = `select * from ${errorTrackingState.data.stream.errorStream} where type='error' or type='action' or type='view' or (type='resource' and resource_type='xhr') order by ${store.state.zoConfig.timestamp_column}`;
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
      const errorIndex = res.data.hits.findIndex(
        (hit: any) => hit.error_id === errorDetails.value.error_id,
      );
      errorDetails.value.events = res.data.hits.slice(
        errorIndex,
        errorIndex + 100,
      );
      errorDetails.value.events = errorDetails.value.events.map(
        (event: any) => ({
          ...event,
          category: getErrorCategory(event),
        }),
      );
    })
    .finally(() => isLoading.value.pop());
};

const getErrorCategory = (row: any) => {
  if (row["type"] === "error") return row["error_type"] || "Error";
  else if (row["type"] === "resource") return row["resource_type"];
  else if (row["type"] === "view")
    return row["view_loading_type"] === "route_change"
      ? "Navigation"
      : "Reload";
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
          errorDetails.value.error_stack ||
          errorDetails.value.error_handling_stack;
        errorDetails.value.error_stack = errorStack.split("\n");
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

