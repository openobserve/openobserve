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

import { queryClient } from "@/composables/query/queryClient";
import { alertsListQuery } from "@/services/alerts.queries";
import { CALIBRATION_PREFILL, type EditHandoffPrefill } from "@/utils/alerts/alertEditHandoff";

export interface EditAlertRoute {
  name: "editAlert";
  params: { alert_id: string };
  query: { org_identifier: string; prefill: EditHandoffPrefill; folder?: string };
}

interface AlertListRow {
  alert_id?: string;
  id?: string;
  folder_id?: string;
}

/** The alert's folder id, or undefined when it cannot be read; it never throws. */
export const alertFolderOf = async (
  org: string,
  alertId: string,
  name: string | null | undefined,
): Promise<string | undefined> => {
  if (!org || !alertId || !name) return undefined;
  try {
    // The alert GET has no folder, so read the list; a refusal is the silent fallback, not an access denial.
    const lookup = alertsListQuery(org, "", name, undefined, { silentForbidden: true });
    const rows = (await queryClient.fetchQuery(lookup)) as AlertListRow[];
    return rows.find((row) => (row.alert_id ?? row.id) === alertId)?.folder_id || undefined;
  } catch {
    return undefined;
  }
};

/** An unknown folder leaves the link as it was, since the editor's own fallback is a guess. */
export const editAlertRoute = (
  org: string,
  alertId: string,
  folder: string | undefined,
  prefill: EditHandoffPrefill = CALIBRATION_PREFILL,
): EditAlertRoute => ({
  name: "editAlert",
  params: { alert_id: alertId },
  query: {
    org_identifier: org,
    prefill,
    ...(folder ? { folder } : {}),
  },
});
