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

import { onBeforeUnmount } from "vue";
import { useLogsAutoRun } from "@/composables/useLogs/logsAutoRun";
import { searchState } from "@/composables/useLogs/searchState";
import { useRecentSearches } from "./useRecentSearches";
import { buildLogsRecord, isRecordedLogsRun, logsRunResult } from "@/utils/queryHistory/logs";

/** Records each user-initiated Logs search once it finishes or fails. */
export const useLogsHistoryRecorder = () => {
  const { record } = useRecentSearches();
  const { searchObj } = searchState();
  const stop = useLogsAutoRun().onRunSettled((run) => {
    if (!isRecordedLogsRun(run.reasons, run.signature)) return;
    const result = logsRunResult(run);
    if (!result) return;
    const fields: unknown = searchObj.data.stream?.selectedFields;
    record(
      buildLogsRecord({
        signature: run.signature,
        startUs: run.startUs,
        endUs: run.endUs,
        columns: Array.isArray(fields) ? fields.map(String) : [],
        result,
      }),
    );
  });
  onBeforeUnmount(stop);
};
