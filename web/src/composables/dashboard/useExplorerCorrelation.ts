// Copyright 2026 OpenObserve Inc.
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

import { ref, watch, type Ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { buildChipDimensionsFromFilters } from "@/services/service_streams";
import { correlationDisplayProps } from "@/types/serviceRef";
import { buildWorkloadChipDimensions } from "@/composables/useMetricSubjectButtons";
import { extractSeverity } from "@/utils/sourceEventSeverity";
import type { TelemetryContext, TelemetryType } from "@/utils/telemetryCorrelation";

/** The correlated Logs / Metrics / Traces tabs of one explorer event, fetched when a tab opens. */
export function useExplorerCorrelation(options: {
  sourceType: TelemetryType;
  stream: () => string;
  /** The open event; a new one drops the previous event's correlation. */
  selected: Ref<Record<string, any> | null>;
  ftsFields?: string[];
}) {
  const { t } = useI18nTyped();
  const correlationDashboardProps = ref<any>(null);
  const correlationLoading = ref(false);
  const correlationError = ref<string | null>(null);
  const correlationFetchInProgress = ref(false);
  const {
    findRelatedTelemetry,
    semanticGroups,
    noMatch: correlationNoMatch,
    error: serviceCorrelationError,
  } = useServiceCorrelation();
  const { locked: correlationLocked } = useLicenseLock("correlation");

  // Each event and each fetch is a new request; an older one's answer, error or cleanup is dropped.
  let request = 0;

  // Fresh correlation per event (mirrors the Logs page reset on row change).
  watch(options.selected, () => {
    request += 1;
    correlationDashboardProps.value = null;
    correlationLoading.value = false;
    correlationError.value = null;
    correlationFetchInProgress.value = false;
  });

  // Lazy correlation fetch — replicated from SearchResult.vue's openCorrelationFromLog.
  async function openCorrelation(eventData: any) {
    if (correlationFetchInProgress.value || correlationLocked.value) return;
    request += 1;
    const call = request;
    try {
      correlationFetchInProgress.value = true;
      correlationLoading.value = true;
      correlationError.value = null;
      const context: TelemetryContext = {
        timestamp: eventData._timestamp || Date.now() * 1000,
        fields: eventData,
      };
      const timeWindowMicros = 5 * 60 * 1000000;
      const startTimeMicros = context.timestamp - timeWindowMicros;
      let endTimeMicros = context.timestamp + timeWindowMicros;
      const currentTimeMicros = Date.now() * 1000;
      if (endTimeMicros > currentTimeMicros) endTimeMicros = currentTimeMicros;
      const result = await findRelatedTelemetry(context, options.sourceType, 5, options.stream(), {
        start: startTimeMicros,
        end: endTimeMicros,
      });
      if (call !== request) return;
      if (!result) {
        correlationError.value = correlationNoMatch.value
          ? t("logs.searchResult.noMatchingService")
          : serviceCorrelationError.value || t("logs.searchResult.unableToRetrieveCorrelation");
        return;
      }
      if (!result.correlationData) {
        correlationError.value = t("logs.searchResult.unableToRetrieveCorrelation");
        return;
      }
      const logFilters = result.correlationData.related_streams.logs?.[0]?.filters || {};
      const actualMatchedDimensions =
        Object.keys(logFilters).length > 0 ? logFilters : result.correlationData.matched_dimensions;
      correlationDashboardProps.value = {
        serviceName: result.correlationData.service_name,
        ...correlationDisplayProps(result.correlationData),
        matchedDimensions: actualMatchedDimensions,
        additionalDimensions: {},
        matchedSetId: result.correlationData.matched_set_id,
        chipDimensions: {
          ...buildChipDimensionsFromFilters(result.correlationData, semanticGroups.value),
          ...buildWorkloadChipDimensions(
            result.correlationData.matched_set_id,
            semanticGroups.value,
            eventData,
          ),
        },
        sourceEvent: {
          timestamp: eventData._timestamp,
          severity: extractSeverity(eventData) ?? undefined,
          message: eventData.body || eventData.message || eventData.log || eventData.msg,
        },
        metricStreams: result.correlationData.related_streams.metrics || [],
        logStreams: result.correlationData.related_streams.logs || [],
        traceStreams: result.correlationData.related_streams.traces || [],
        sourceStream: options.stream(),
        sourceType: options.sourceType,
        availableDimensions: { ...logFilters, ...context.fields },
        semanticGroups: semanticGroups.value,
        ...(options.ftsFields ? { ftsFields: options.ftsFields } : {}),
        timeRange: { startTime: startTimeMicros, endTime: endTimeMicros },
      };
    } catch (err: any) {
      if (call !== request) return;
      correlationError.value = t("logs.searchResult.correlationError", {
        error: err?.message || err,
      });
      correlationDashboardProps.value = null;
    } finally {
      if (call === request) {
        correlationLoading.value = false;
        correlationFetchInProgress.value = false;
      }
    }
  }

  return { correlationDashboardProps, correlationLoading, correlationError, openCorrelation };
}
