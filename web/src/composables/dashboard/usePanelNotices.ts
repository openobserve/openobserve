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

import { computed, ref, shallowRef } from "vue";
import { processQueryMetadataErrors } from "@/utils/queryUtils";
import { useStreamTimeLimits, type StreamRef } from "@/composables/useStreamTimeLimits";
import {
  omitFunctionErrorMessages,
  type PanelDiagnostics,
  type SeriesLimitInfo,
} from "@/utils/dashboard/panelDiagnostics";
import type { RegionJoinInfo } from "@/utils/dashboard/convertMapsData";
import type { SankeyNotice } from "@/utils/dashboard/convertSankeyData";

/** What a host knows of its panel: the streams its SQL reads and the hours its window spans. */
export interface PanelNoticeSource {
  streams: () => StreamRef[];
  rangeHours?: () => number;
}

/** The streams a SQL panel reads; PromQL has none, since the stream query-range limit does not clip it. */
export const panelQueryStreams = (panel: any): StreamRef[] =>
  panel?.queryType === "promql"
    ? []
    : (panel?.queries ?? []).map((query: any) => ({
        name: String(query?.fields?.stream ?? ""),
        type: String(query?.fields?.stream_type ?? "logs"),
      }));

/** Hours a dashboard panel time spans; 0 when either bound is missing. */
export const panelRangeHours = (time: any): number => {
  // Dashboard time Dates carry epoch microseconds in getTime(), not milliseconds.
  const startUs = Number(time?.start_time?.getTime?.());
  const endUs = Number(time?.end_time?.getTime?.());
  return endUs > startUs ? (endUs - startUs) / 3_600_000_000 : 0;
};

/**
 * The notice state a PanelSchemaRenderer host keeps for PanelErrorButtons: server diagnostics,
 * the series cap, and the legacy range warning without the messages the chips already show.
 */
export const usePanelNotices = (timezone: () => string, panel?: PanelNoticeSource) => {
  const resultMetadata = shallowRef<unknown>(null);
  const panelDiagnostics = shallowRef<PanelDiagnostics | null>(null);
  const seriesLimit = shallowRef<SeriesLimitInfo | null>(null);
  const regionJoin = shallowRef<RegionJoinInfo | null>(null);
  const sankeyNotice = shallowRef<SankeyNotice | null>(null);
  // Writable, so a host can still clear it with its other warnings.
  const maxQueryRangeWarning = ref("");

  const recomputeRangeWarning = (tz: string) => {
    maxQueryRangeWarning.value = processQueryMetadataErrors(
      omitFunctionErrorMessages(resultMetadata.value, [
        ...(panelDiagnostics.value?.functionErrors ?? []),
        ...(panelDiagnostics.value?.partialReasons ?? []),
      ]),
      tz,
    );
  };

  // A result-cache hit clips with a notice that names no hours, or with none at all, so the chip needs the streams' own limit.
  const streamLimits = panel ? useStreamTimeLimits(panel.streams) : null;
  const rangeLimitHours = computed(() => streamLimits?.value.queryRangeRestrictionInHour ?? 0);

  const handleResultMetadataUpdate = (metadata: unknown) => {
    resultMetadata.value = metadata;
    recomputeRangeWarning(timezone());
  };

  const handlePanelDiagnosticsUpdate = (diagnostics: PanelDiagnostics | null) => {
    panelDiagnostics.value = diagnostics;
    recomputeRangeWarning(timezone());
  };

  const handleSeriesLimitUpdate = (limit: SeriesLimitInfo | null) => {
    seriesLimit.value = limit;
  };

  const handleRegionJoinUpdate = (join: RegionJoinInfo | null) => {
    regionJoin.value = join;
  };

  const handleSankeyNoticeUpdate = (notice: SankeyNotice | null) => {
    sankeyNotice.value = notice;
  };

  const resetNotices = () => {
    resultMetadata.value = null;
    panelDiagnostics.value = null;
    seriesLimit.value = null;
    regionJoin.value = null;
    sankeyNotice.value = null;
    maxQueryRangeWarning.value = "";
  };

  /** The PanelErrorButtons props these notices drive, bound with `v-bind`. */
  const noticeProps = computed(() => ({
    seriesLimit: seriesLimit.value,
    regionJoin: regionJoin.value,
    sankeyNotice: sankeyNotice.value,
    serverPartial: panelDiagnostics.value?.serverPartial ?? false,
    rowsCapped: panelDiagnostics.value?.rowsCapped ?? false,
    serverPartialReasons: panelDiagnostics.value?.partialReasons ?? [],
    functionErrors: panelDiagnostics.value?.functionErrors ?? [],
    rangeLimitHours: rangeLimitHours.value,
    rangeOverLimit:
      rangeLimitHours.value > 0 && (panel?.rangeHours?.() ?? 0) > rangeLimitHours.value,
  }));

  return {
    panelDiagnostics,
    seriesLimit,
    sankeyNotice,
    maxQueryRangeWarning,
    noticeProps,
    handleResultMetadataUpdate,
    handlePanelDiagnosticsUpdate,
    handleSeriesLimitUpdate,
    handleRegionJoinUpdate,
    handleSankeyNoticeUpdate,
    resetNotices,
  };
};
