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

// Never replaces an existing dashboard — an automatic trigger must not destroy user edits.
// The check is exposed separately so a caller can confirm before the org is written to.

import dashboardsService from "@/services/dashboards";
import hostMetricsDashboard from "@/assets/dashboards/host_metrics.dashboard.json";

export const HOST_METRICS_DASHBOARD_TITLE = "Host Metrics";

export type HostMetricsImportResult =
  | { status: "created" | "exists"; dashboardId: string; folderId: "default" }
  | { status: "error"; kind: "forbidden" | "generic"; message: string };

export type HostMetricsLookupResult =
  | { status: "exists"; dashboardId: string; folderId: "default" }
  | { status: "absent"; folderId: "default" }
  | { status: "error"; kind: "forbidden" | "generic"; message: string };

const inFlight = new Map<string, Promise<HostMetricsImportResult>>();
const lookupsInFlight = new Map<string, Promise<HostMetricsLookupResult>>();

/** Existence check with no side effect — for callers that must ask before creating. */
export function findHostMetricsDashboard(orgId: string): Promise<HostMetricsLookupResult> {
  const pending = lookupsInFlight.get(orgId);
  if (pending) return pending;
  const run = doFind(orgId).finally(() => lookupsInFlight.delete(orgId));
  lookupsInFlight.set(orgId, run);
  return run;
}

export function importHostMetricsDashboard(orgId: string): Promise<HostMetricsImportResult> {
  const pending = inFlight.get(orgId);
  if (pending) return pending;
  const run = doImport(orgId).finally(() => inFlight.delete(orgId));
  inFlight.set(orgId, run);
  return run;
}

function toError(err: any): { status: "error"; kind: "forbidden" | "generic"; message: string } {
  return {
    status: "error",
    kind: err?.response?.status === 403 ? "forbidden" : "generic",
    message: err?.message ?? String(err),
  };
}

async function lookup(orgId: string): Promise<{ dashboardId: string } | null> {
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
  if (!existing) return null;
  // LIST rows are snake_case on the wire (ListDashboardsResponseBodyItem has no camelCase rename).
  return { dashboardId: existing.dashboard_id ?? existing.dashboardId ?? existing.id };
}

async function doFind(orgId: string): Promise<HostMetricsLookupResult> {
  try {
    const existing = await lookup(orgId);
    return existing
      ? { status: "exists", dashboardId: existing.dashboardId, folderId: "default" }
      : { status: "absent", folderId: "default" };
  } catch (err: any) {
    return toError(err);
  }
}

async function doImport(orgId: string): Promise<HostMetricsImportResult> {
  try {
    const existing = await lookup(orgId);
    if (existing) {
      return { status: "exists", dashboardId: existing.dashboardId, folderId: "default" };
    }
    const created = await dashboardsService.create(orgId, hostMetricsDashboard, "default");
    const dashboardId = created.data?.[`v${created.data?.version}`]?.dashboardId ?? "";
    return { status: "created", dashboardId, folderId: "default" };
  } catch (err: any) {
    return toError(err);
  }
}
