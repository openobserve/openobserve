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

import { ref } from "vue";
import type { RouteRecordNameGeneric } from "vue-router";

/** True while an org switch is leaving an org-scoped page, so editor guards treat the leave as forced. */
export const orgSwitchPending = ref(false);

/** Detail and edit routes whose id belongs to one org, mapped to the list route to land on after an org switch. */
const ORG_SCOPED_DETAIL_ROUTES: Record<string, string> = {
  viewDashboard: "dashboards",
  addPanel: "dashboards",
  editAlert: "alertList",
  alertDetail: "alertList",
  editAnomalyDetection: "alertList",
  pipelineEditor: "pipelines",
  reportDetail: "reports",
  editSlo: "sloList",
  sloDetail: "sloList",
  editDowntime: "downtimes",
  downtimeDetail: "downtimes",
  editGroup: "groups",
  editRole: "roles",
  incidentDetail: "incidentList",
  onCallResponseDetail: "onCallResponses",
  onCallTeamDetail: "onCallTeams",
  workflowRuns: "workflows",
  traceDetails: "traces",
  "synthetics-edit": "synthetics",
  "synthetic-monitor-results": "synthetics",
  aiExperimentDetail: "aiExperiments",
  aiExperimentCompare: "aiExperiments",
  aiRemoteTaskDetail: "aiRemoteTasks",
  aiRemoteTaskEdit: "aiRemoteTasks",
};

/** The list route to leave for on an org switch, or null when the current page is not tied to an org-scoped id. */
export const orgSwitchListRoute = (
  routeName: RouteRecordNameGeneric,
  query: Record<string, unknown> = {},
): string | null => {
  const name = String(routeName ?? "");
  if (name === "createReport") return query.report_id || query.name ? "reports" : null;
  return ORG_SCOPED_DETAIL_ROUTES[name] ?? null;
};
