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
import {
  omitFunctionErrorMessages,
  type PanelDiagnostics,
  type SeriesLimitInfo,
} from "@/utils/dashboard/panelDiagnostics";

/**
 * The notice state a PanelSchemaRenderer host keeps for PanelErrorButtons: server diagnostics,
 * the series cap, and the legacy range warning without the messages the chips already show.
 */
export const usePanelNotices = (timezone: () => string) => {
  const resultMetadata = shallowRef<unknown>(null);
  const panelDiagnostics = shallowRef<PanelDiagnostics | null>(null);
  const seriesLimit = shallowRef<SeriesLimitInfo | null>(null);
  const returnLinks = ref(0);
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

  const handleReturnLinksUpdate = (count: number) => {
    returnLinks.value = count;
  };

  const resetNotices = () => {
    resultMetadata.value = null;
    panelDiagnostics.value = null;
    seriesLimit.value = null;
    returnLinks.value = 0;
    maxQueryRangeWarning.value = "";
  };

  /** The PanelErrorButtons props these notices drive, bound with `v-bind`. */
  const noticeProps = computed(() => ({
    seriesLimit: seriesLimit.value,
    returnLinks: returnLinks.value,
    serverPartial: panelDiagnostics.value?.serverPartial ?? false,
    rowsCapped: panelDiagnostics.value?.rowsCapped ?? false,
    serverPartialReasons: panelDiagnostics.value?.partialReasons ?? [],
    functionErrors: panelDiagnostics.value?.functionErrors ?? [],
  }));

  return {
    panelDiagnostics,
    seriesLimit,
    returnLinks,
    maxQueryRangeWarning,
    noticeProps,
    handleResultMetadataUpdate,
    handlePanelDiagnosticsUpdate,
    handleSeriesLimitUpdate,
    handleReturnLinksUpdate,
    resetNotices,
  };
};
