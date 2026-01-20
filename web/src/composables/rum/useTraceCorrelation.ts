// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { ref, computed, Ref } from "vue";
import { useStore } from "vuex";
import searchService from "@/services/search";

export interface TraceCorrelationData {
  trace_id: string;
  session_id: string | null;
  rum_events: any[];
  backend_spans: any[];
  has_backend_trace: boolean;
  performance_breakdown: {
    total_duration_ms: number;
    browser_duration_ms: number;
    network_latency_ms: number;
    backend_duration_ms: number;
  } | null;
}

export default function useTraceCorrelation(traceId: Ref<string>) {
  const store = useStore();
  const correlationData = ref<TraceCorrelationData | null>(null);
  const isLoading = ref(false);
  const error = ref<Error | null>(null);

  const hasBackendTrace = computed(() => {
    return correlationData.value?.has_backend_trace ?? false;
  });

  const backendSpanCount = computed(() => {
    return correlationData.value?.backend_spans?.length ?? 0;
  });

  const performanceData = computed(() => {
    return correlationData.value?.performance_breakdown ?? null;
  });

  /**
   * Fetch trace correlation data from backend
   * Uses existing searchService.search with _rumdata stream
   */
  const fetchCorrelation = async () => {
    if (!traceId.value) {
      correlationData.value = null;
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      // Query RUM data for this trace ID
      const rumQuery = {
        query: {
          sql: `select * from _rumdata where "_oo.trace_id" = '${traceId.value}' order by ${store.state.zoConfig.timestamp_column} desc`,
          start_time: Date.now() * 1000 - 3600000000, // Last hour in microseconds
          end_time: Date.now() * 1000,
          from: 0,
          size: 100,
        },
      };

      const rumResponse = await searchService.search(
        {
          org_identifier: store.state.selectedOrganization.identifier,
          query: rumQuery,
          page_type: "logs",
        },
        "RUM"
      );

      const rumEvents = rumResponse.data.hits || [];

      // Try to query backend trace data
      // Note: This assumes traces are stored in a stream like "_traces" or similar
      // Adjust the stream name based on your actual trace storage
      let backendSpans: any[] = [];
      let hasTrace = false;

      try {
        const traceQuery = {
          query: {
            sql: `select * from _traces where trace_id = '${traceId.value}' order by start_time`,
            start_time: Date.now() * 1000 - 3600000000,
            end_time: Date.now() * 1000,
            from: 0,
            size: 100,
          },
        };

        const traceResponse = await searchService.search(
          {
            org_identifier: store.state.selectedOrganization.identifier,
            query: traceQuery,
            page_type: "logs",
          },
          "APM"
        );

        backendSpans = traceResponse.data.hits || [];
        hasTrace = backendSpans.length > 0;
      } catch (traceError) {
        // Backend trace not found or stream doesn't exist - this is okay
        console.debug("Backend trace not found:", traceError);
      }

      // Calculate performance breakdown
      let performanceBreakdown = null;
      if (rumEvents.length > 0) {
        const resourceEvent = rumEvents.find((e: any) => e.type === "resource");
        if (resourceEvent) {
          const totalDuration = resourceEvent.resource?.duration || 0;
          const backendDuration = backendSpans.reduce(
            (sum: number, span: any) => sum + (span.duration_ms || 0),
            0
          );

          // Estimate network latency and browser time
          const browserDuration = Math.max(0, totalDuration - backendDuration);
          const networkLatency = Math.floor(totalDuration * 0.1); // Rough estimate

          performanceBreakdown = {
            total_duration_ms: Math.round(totalDuration),
            browser_duration_ms: Math.round(browserDuration),
            network_latency_ms: networkLatency,
            backend_duration_ms: Math.round(backendDuration),
          };
        }
      }

      correlationData.value = {
        trace_id: traceId.value,
        session_id: rumEvents[0]?.session_id || null,
        rum_events: rumEvents,
        backend_spans: backendSpans,
        has_backend_trace: hasTrace,
        performance_breakdown: performanceBreakdown,
      };
    } catch (e) {
      error.value = e as Error;
      console.error("Failed to fetch trace correlation:", e);
      correlationData.value = null;
    } finally {
      isLoading.value = false;
    }
  };

  const reset = () => {
    correlationData.value = null;
    isLoading.value = false;
    error.value = null;
  };

  return {
    correlationData: computed(() => correlationData.value),
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value),
    hasBackendTrace,
    backendSpanCount,
    performanceData,
    fetchCorrelation,
    reset,
  };
}
