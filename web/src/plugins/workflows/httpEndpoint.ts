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

import type { I18nKey } from "@/types/i18n";
import type { WorkflowHistoryRow, WorkflowListHttpFields } from "@/services/workflows";

export type RunSource =
  "http" | "alert_fired" | "incident_event" | "test" | "retry" | "manual" | "other";

const SOURCE_BY_TYPE: Record<string, RunSource> = {
  Webhook: "http",
  AlertFired: "alert_fired",
  AlertResolved: "alert_fired",
  IncidentEvent: "incident_event",
  Test: "test",
  Retry: "retry",
  Manual: "manual",
};

export const RUN_SOURCE_LABEL_KEYS: Record<RunSource, I18nKey> = {
  http: "workflow.history.sourceHttp",
  alert_fired: "workflow.history.sourceAlertFired",
  incident_event: "workflow.history.sourceIncidentEvent",
  test: "workflow.history.testRun",
  retry: "workflow.history.sourceRetry",
  manual: "workflow.history.sourceManual",
  other: "workflow.history.sourceOther",
};

/** Every HTTP surface hides unless the server says hooks are on; an absent flag means an older server. */
export function workflowHooksEnabled(
  zoConfig: { workflow_hooks_enabled?: unknown } | null | undefined,
): boolean {
  return zoConfig?.workflow_hooks_enabled === true;
}

export function hasHttpEndpoint(row: WorkflowListHttpFields | null | undefined): boolean {
  return row?.http_endpoint_enabled === true;
}

/** The run's own type decides the source; a retry of an HTTP run is a retry and carries no request facts. */
export function runSourceOf(row: Pick<WorkflowHistoryRow, "event_type">): RunSource {
  return SOURCE_BY_TYPE[row.event_type] ?? "other";
}

export function isHttpRun(row: Pick<WorkflowHistoryRow, "event_type">): boolean {
  return runSourceOf(row) === "http";
}
