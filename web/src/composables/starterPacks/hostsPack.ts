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

import {
  findHostMetricsDashboard,
  HOST_METRICS_DASHBOARD_TITLE,
  importHostMetricsDashboard,
} from "@/composables/useHostMetricsDashboard";

import type { PackSharedDashboard, StarterPack } from "./types";

// Placeholder selection until the pack's real alert list is chosen.
export const PLACEHOLDER_HOST_ALERT_IDS = [
  "infrastructure/host_high_cpu_load",
  "infrastructure/host_out_of_memory",
  "infrastructure/host_out_of_disk_space",
  "infrastructure/host_disk_may_fill_in_24_hours",
];

const failure = (result: { status: string; message?: string }) =>
  new Error(result.message ?? "host metrics dashboard import failed");

// The setup card imports the same dashboard, so both go through its one importer (R22).
const HOST_METRICS_IMPORT: PackSharedDashboard = {
  find: async (org) => {
    const result = await findHostMetricsDashboard(org);
    if (result.status === "error") throw failure(result);
    return result.status === "exists"
      ? { id: result.dashboardId, folderId: result.folderId }
      : null;
  },
  create: async (org) => {
    const result = await importHostMetricsDashboard(org);
    if (result.status === "error") throw failure(result);
    return result.status === "created";
  },
};

export const HOSTS_PACK: StarterPack = {
  id: "hosts",
  version: "1.0.0",
  titleKey: "starterPacks.hosts.title",
  descriptionKey: "starterPacks.hosts.description",
  folder: { name: "Hosts", description: "Installed by the Hosts starter pack" },
  dashboards: [
    {
      id: "host_metrics",
      title: HOST_METRICS_DASHBOARD_TITLE,
      load: async () => (await import("@/assets/dashboards/host_metrics.dashboard.json")).default,
      shared: HOST_METRICS_IMPORT,
    },
  ],
  alerts: PLACEHOLDER_HOST_ALERT_IDS,
  savedViews: [],
  collectorRoute: "ingestFromLinux",
  signals: [
    "system_cpu_time",
    "system_memory_usage",
    "system_filesystem_usage",
    "node_cpu_seconds_total",
    "node_memory_MemAvailable_bytes",
    "node_filesystem_avail_bytes",
  ],
};
