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

// Imports a data source's companion dashboard into the org's Default folder when its
// setup card detects data. The JSON is bundled (a lazy chunk), never fetched at runtime,
// so an automatic import can't pull in remote content and works air-gapped. Like the
// Host Metrics import it never replaces an existing dashboard.

import dashboardsService from "@/services/dashboards";
import { dashboardKeys } from "@/services/dashboards.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";

export interface SetupDashboardRef {
  /** Dashboard title — the no-overwrite lookup matches on it. */
  title: string;
  /** Loads the bundled dashboard JSON. */
  load: () => Promise<Record<string, any>>;
}

/** The dashboard NVIDIA's dcgm-exporter README links to (openobserve/dashboards gallery). */
export const NVIDIA_GPU_DASHBOARD: SetupDashboardRef = {
  title: "GPU Monitoring - NVIDIA",
  load: () => import("@/assets/dashboards/nvidia_gpu.dashboard.json").then((m) => m.default),
};

/** Data-source slugs whose setup card imports a companion dashboard. */
export const SETUP_DASHBOARD_BY_SLUG: Record<string, SetupDashboardRef> = {
  nvidiaDcgm: NVIDIA_GPU_DASHBOARD,
};

export type SetupDashboardImportResult =
  | { status: "created" | "exists"; dashboardId: string; folderId: "default" }
  | { status: "error"; kind: "forbidden" | "generic"; message: string };

const inFlight = new Map<string, Promise<SetupDashboardImportResult>>();

export function importSetupDashboard(
  orgId: string,
  dash: SetupDashboardRef,
): Promise<SetupDashboardImportResult> {
  const key = `${orgId}\u0000${dash.title}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = doImport(orgId, dash).finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function lookup(orgId: string, title: string): Promise<string | null> {
  // Server-side title filter — a list-and-scan would miss page 2 on big orgs.
  const listed = await dashboardsService.list(0, 50, "name", false, "", orgId, "default", title);
  // The title param may match by substring — confirm the exact title.
  const existing = (listed.data?.dashboards ?? []).find((d: any) => d.title === title);
  if (!existing) return null;
  // LIST rows are snake_case on the wire.
  const id = existing.dashboard_id ?? existing.dashboardId ?? existing.id;
  // It exists, so creating would duplicate it — fail instead.
  if (!id) throw new Error("existing dashboard has no id");
  return id;
}

async function doImport(
  orgId: string,
  dash: SetupDashboardRef,
): Promise<SetupDashboardImportResult> {
  try {
    const existingId = await lookup(orgId, dash.title);
    if (existingId) return { status: "exists", dashboardId: existingId, folderId: "default" };

    // Same preparation as a manual import: current schema, created now, pinned title.
    const doc = convertDashboardSchemaVersion(structuredClone(await dash.load()));
    const created = await dashboardsService.create(
      orgId,
      { ...doc, title: dash.title, created: new Date().toISOString() },
      "default",
    );
    // The create bypasses the dashboards query, so the cached folder lists must be told.
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.all(orgId) });
    const dashboardId = created.data?.[`v${created.data?.version}`]?.dashboardId;
    // Without an id there is nothing to open — surface it rather than cache a blank target.
    if (!dashboardId) throw new Error("create response carried no dashboard id");
    return { status: "created", dashboardId, folderId: "default" };
  } catch (err: any) {
    return {
      status: "error",
      kind: err?.response?.status === 403 ? "forbidden" : "generic",
      message: err?.message ?? String(err),
    };
  }
}
