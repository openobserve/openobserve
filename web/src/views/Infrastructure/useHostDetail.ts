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

// Builders for the host detail drawer (design 4.8): the inline single-host v8
// dashboard and the logs preview SQL. Host names are escaped, never excluded —
// excluding would silently drop a real host.

import { gt } from "@/types/i18n";
import { HOSTS_DEVICE_EXCLUSION } from "./hostsQueries";

// Not derivable from this repo (§7 risk 1) — a wrong value degrades to an empty logs search, never an error.
export const HOST_LOGS_STREAM = "default";

export const LOGS_PREVIEW_LIMIT = 100;

/** Backslash-escape `\` and `"` for a PromQL string literal. */
export function promEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Double single quotes for a SQL string literal. */
export function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildLogsPreviewSql(host: string): string {
  return `SELECT * FROM "${HOST_LOGS_STREAM}" WHERE host_name = '${sqlEscape(host)}' ORDER BY _timestamp DESC LIMIT ${LOGS_PREVIEW_LIMIT}`;
}

interface DrawerPanelDef {
  id: string;
  type: string;
  title: string;
  unit: string;
  queries: Array<[string, string]>;
}

function drawerPanel(def: DrawerPanelDef, index: number) {
  return {
    id: def.id,
    type: def.type,
    title: def.title,
    description: "",
    config: {
      show_legends: true,
      legends_position: "bottom",
      unit: def.unit,
      unit_custom: null,
      drilldown: [],
    },
    queryType: "promql",
    queries: def.queries.map(([query, legend]) => ({
      query,
      vrlFunctionQuery: "",
      customQuery: true,
      fields: {
        stream: "",
        stream_type: "metrics",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      },
      config: { promql_legend: legend },
    })),
    layout: {
      x: (index % 2) * 96,
      y: Math.floor(index / 2) * 16,
      w: 96,
      h: 16,
      i: index,
    },
  };
}

// Eight fixed panels pinned to one literal host — a single host needs no variable selectors.
export function buildHostDashboard(host: string) {
  const h = `host_name="${promEscape(host)}"`;
  const excl = `device!~"${HOSTS_DEVICE_EXCLUSION}"`;
  const panels: DrawerPanelDef[] = [
    {
      id: "hd_cpu_busy",
      type: "line",
      title: gt("infra.hosts.panel.cpuBusy"),
      unit: "percent",
      queries: [[`100 * (1 - avg(irate(system_cpu_time{state="idle",${h}}[5m])))`, "busy"]],
    },
    {
      id: "hd_cpu_by_state",
      type: "line",
      title: gt("infra.hosts.panel.cpuByState"),
      unit: "percent-1",
      queries: [[`avg by (state)(irate(system_cpu_time{${h},state!="idle"}[5m]))`, "{state}"]],
    },
    {
      id: "hd_memory_by_state",
      type: "area-stacked",
      title: gt("infra.hosts.panel.memoryByState"),
      unit: "bytes",
      queries: [[`sum by (state)(system_memory_usage{${h}})`, "{state}"]],
    },
    {
      id: "hd_load",
      type: "line",
      title: gt("infra.hosts.panel.load"),
      unit: "numbers",
      queries: [
        [`avg(system_cpu_load_average_1m{${h}})`, "1m"],
        [`avg(system_cpu_load_average_5m{${h}})`, "5m"],
        [`avg(system_cpu_load_average_15m{${h}})`, "15m"],
      ],
    },
    {
      id: "hd_disk_read",
      type: "line",
      title: gt("infra.hosts.panel.diskRead"),
      unit: "bps",
      queries: [
        [
          `sum by (device)(irate(system_disk_io{direction="read",${h},device!~"loop.*"}[5m]))`,
          "{device}",
        ],
      ],
    },
    {
      id: "hd_disk_write",
      type: "line",
      title: gt("infra.hosts.panel.diskWrite"),
      unit: "bps",
      queries: [
        [
          `sum by (device)(irate(system_disk_io{direction="write",${h},device!~"loop.*"}[5m]))`,
          "{device}",
        ],
      ],
    },
    {
      id: "hd_fs_used_pct",
      type: "line",
      title: gt("infra.hosts.panel.filesystemUsedPct"),
      unit: "percent",
      queries: [
        [
          `100 * sum by (mountpoint)(system_filesystem_usage{state="used",${h},${excl}}) / sum by (mountpoint)(system_filesystem_usage{${h},${excl}})`,
          "{mountpoint}",
        ],
      ],
    },
    {
      id: "hd_network_by_direction",
      type: "line",
      title: gt("infra.hosts.panel.networkByDirection"),
      unit: "bps",
      queries: [[`sum by (direction)(irate(system_network_io{${h}}[5m]))`, "{direction}"]],
    },
  ];
  return {
    version: 8,
    dashboardId: "",
    title: host,
    description: "",
    role: "",
    owner: "",
    created: new Date().toISOString(),
    variables: { list: [], showDynamicFilters: false },
    tabs: [
      {
        tabId: "host",
        name: "Host",
        panels: panels.map((p, i) => drawerPanel(p, i)),
      },
    ],
  };
}
