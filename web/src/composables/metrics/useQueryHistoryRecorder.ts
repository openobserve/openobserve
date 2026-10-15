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

import { useMutation } from "@tanstack/vue-query";
import { useOrgId } from "@/composables/query/useOrgId";
import { recordQueryHistoryMutation } from "@/services/query_history.queries";
import { buildHistoryEntry } from "@/utils/metrics/queryHistory";
import type { SelectedDate } from "@/utils/dashboard/urlTimeParams";

/** Fire-and-forget: a failed record is only logged and never reaches the run. */
export const useQueryHistoryRecorder = () => {
  const orgId = useOrgId();
  const recordEntry = useMutation(() => recordQueryHistoryMutation(orgId.value));

  const record = (dashboardPanelData: any, selectedDate: Partial<SelectedDate> | null) => {
    const entry = buildHistoryEntry(dashboardPanelData, selectedDate);
    if (!entry) return;
    recordEntry.mutateAsync(entry).catch((err) => {
      console.error("Failed to record query history", err);
    });
  };

  return { record };
};
