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

// Create-if-absent import of the bundled Host Metrics dashboard (design 4.2).
// Never replaces an existing dashboard — an automatic trigger must not destroy
// user edits; the user-confirmed replace path lives in TemplateSuggestionCards.

import dashboardsService from "@/services/dashboards";
import hostMetricsDashboard from "@/assets/dashboards/host_metrics.dashboard.json";

export const HOST_METRICS_DASHBOARD_TITLE = "Host Metrics";

export type HostMetricsImportResult =
  | { status: "created" | "exists"; dashboardId: string; folderId: "default" }
  | { status: "error"; kind: "forbidden" | "generic"; message: string };

const inFlight = new Map<string, Promise<HostMetricsImportResult>>();

export function importHostMetricsDashboard(orgId: string): Promise<HostMetricsImportResult> {
  const pending = inFlight.get(orgId);
  if (pending) return pending;
  const run = doImport(orgId).finally(() => inFlight.delete(orgId));
  inFlight.set(orgId, run);
  return run;
}

async function doImport(orgId: string): Promise<HostMetricsImportResult> {
  try {
    // Server-side title filter — a list-and-scan would miss page 2 on big orgs.
    const listed = await dashboardsService.list(
      0,
      50,
      "name",
      false,
      "",
      orgId,
      "default",
      HOST_METRICS_DASHBOARD_TITLE,
    );
    // The title param may match by substring — confirm the exact title.
    const existing = (listed.data?.dashboards ?? []).find(
      (d: any) => d.title === HOST_METRICS_DASHBOARD_TITLE,
    );
    if (existing) {
      return { status: "exists", dashboardId: existing.dashboardId, folderId: "default" };
    }
    const created = await dashboardsService.create(orgId, hostMetricsDashboard, "default");
    const dashboardId = created.data?.[`v${created.data?.version}`]?.dashboardId ?? "";
    return { status: "created", dashboardId, folderId: "default" };
  } catch (err: any) {
    return {
      status: "error",
      kind: err?.response?.status === 403 ? "forbidden" : "generic",
      message: err?.message ?? String(err),
    };
  }
}
