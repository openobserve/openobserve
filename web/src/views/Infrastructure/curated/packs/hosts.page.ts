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

// Hosts content pack (design §7.3): ids, titles, units and query text frozen against the pre-retrofit builder.

import {
  HOSTS_DEVICE_EXCLUSION,
  HOSTS_MOUNTPOINT_EXCLUSION,
  HOSTS_PRODUCER_GUARD,
} from "../../hostsQueries";
import { GROUP, STALENESS_24H_US, type CuratedPageManifest } from "../types";
import { explorerDrilldown } from "./drilldown";

const EXCL = `device!~"${HOSTS_DEVICE_EXCLUSION}"`;
const MPEXCL = `mountpoint!~"${HOSTS_MOUNTPOINT_EXCLUSION}"`;
// Same exclusion as the list's columns, or the drawer contradicts the row the user clicked.
const GUARD = HOSTS_PRODUCER_GUARD;
// Partitions repeat their whole disk's I/O, so drop them but never a bare nvme0n1, which also ends in a digit.
const DISK_EXCL = `device!~"loop.*|nvme[0-9]+n[0-9]+p[0-9]+|sd[a-z]+[0-9]+|xvd[a-z]+[0-9]+|sr[0-9]+"`;
// This panel sums ACROSS devices, so loopback and virtual interfaces would inflate the total.
const NET_EXCL = `device!~"lo|veth.*|docker.*|br-.*|cni.*|flannel.*|tunl.*"`;

export const hostsPage: CuratedPageManifest = {
  id: "hosts",
  titleKey: "menu.hosts",
  icon: "dns",
  contentVersion: 1,
  defaultRelativePeriod: "3h",
  stalenessThresholdUs: STALENESS_24H_US,

  groups: [
    {
      id: "hostmetrics",
      labelKey: "infra.hosts.group.hostMetrics",
      capabilityKey: "infra.hosts.group.hostMetricsCap",
      setupHintKey: "infra.hosts.group.hostMetricsHint",
      setup: { kind: "card", slug: "linux" },
      streamType: "metrics",
      // Not an optimisation: the `host` group lists `host_name` FIFTH, so rung 2 would rewrite all 8 queries (§7.3).
      fieldOverrides: { [GROUP.host]: "host_name" },
      anchorStream: "system_cpu_time",
    },
  ],

  scopePickers: [
    {
      name: "host",
      group: GROUP.host,
      valuesFrom: { groupId: "hostmetrics", stream: "system_cpu_time", streamType: "metrics" },
      multiSelect: false,
      omitWhenValuesEmpty: true,
    },
  ],

  sections: [
    {
      id: "host",
      titleKey: "infra.hosts.section.host",
      scopedBy: ["host"],
      panels: [
        {
          id: "hd_cpu_busy",
          titleKey: "infra.hosts.panel.cpuBusy",
          type: "line",
          unit: "percent",
          groupId: "hostmetrics",
          layout: { w: 96, h: 16 },
          variants: [
            {
              requiresStreams: ["system_cpu_time"],
              queryType: "promql",
              queries: [
                {
                  query: `100 * (1 - avg(irate(system_cpu_time{state="idle",\${scope:host},${GUARD}}[5m])))`,
                  legend: "busy",
                },
              ],
            },
          ],
          drilldown: [
            explorerDrilldown(
              "system_cpu_time",
              `100 * (1 - avg(irate(system_cpu_time{state="idle",\${scope:host},${GUARD}}[5m])))`,
            ),
          ],
        },
        {
          id: "hd_cpu_by_state",
          titleKey: "infra.hosts.panel.cpuByState",
          type: "line",
          unit: "percent-1",
          groupId: "hostmetrics",
          layout: { w: 96, h: 16 },
          variants: [
            {
              requiresStreams: ["system_cpu_time"],
              queryType: "promql",
              queries: [
                {
                  query: `avg by (state)(irate(system_cpu_time{\${scope:host},state!="idle",${GUARD}}[5m]))`,
                  legend: "{state}",
                },
              ],
            },
          ],
          drilldown: [
            explorerDrilldown(
              "system_cpu_time",
              `avg by (state)(irate(system_cpu_time{\${scope:host},state!="idle",${GUARD}}[5m]))`,
            ),
          ],
        },
        {
          id: "hd_memory_by_state",
          titleKey: "infra.hosts.panel.memoryByState",
          type: "area-stacked",
          unit: "bytes",
          groupId: "hostmetrics",
          layout: { w: 96, h: 16 },
          variants: [
            {
              requiresStreams: ["system_memory_usage"],
              queryType: "promql",
              queries: [
                {
                  query: `sum by (state)(system_memory_usage{\${scope:host},${GUARD}})`,
                  legend: "{state}",
                },
              ],
            },
          ],
          drilldown: [
            explorerDrilldown(
              "system_memory_usage",
              `sum by (state)(system_memory_usage{\${scope:host},${GUARD}})`,
            ),
          ],
        },
        {
          id: "hd_load",
          titleKey: "infra.hosts.panel.load",
          type: "line",
          unit: "numbers",
          groupId: "hostmetrics",
          layout: { w: 96, h: 16 },
          variants: [
            {
              requiresStreams: [
                "system_cpu_load_average_1m",
                "system_cpu_load_average_5m",
                "system_cpu_load_average_15m",
              ],
              queryType: "promql",
              queries: [
                { query: `avg(system_cpu_load_average_1m{\${scope:host},${GUARD}})`, legend: "1m" },
                { query: `avg(system_cpu_load_average_5m{\${scope:host},${GUARD}})`, legend: "5m" },
                {
                  query: `avg(system_cpu_load_average_15m{\${scope:host},${GUARD}})`,
                  legend: "15m",
                },
              ],
            },
          ],
          drilldown: [
            explorerDrilldown(
              "system_cpu_load_average_1m",
              `avg(system_cpu_load_average_1m{\${scope:host},${GUARD}})`,
            ),
          ],
        },
        {
          id: "hd_disk_read",
          titleKey: "infra.hosts.panel.diskRead",
          type: "line",
          unit: "bps",
          groupId: "hostmetrics",
          layout: { w: 96, h: 16 },
          variants: [
            {
              requiresStreams: ["system_disk_io"],
              queryType: "promql",
              queries: [
                {
                  query: `sum by (device)(irate(system_disk_io{direction="read",\${scope:host},${DISK_EXCL},${GUARD}}[5m]))`,
                  legend: "{device}",
                },
              ],
            },
          ],
          drilldown: [
            explorerDrilldown(
              "system_disk_io",
              `sum by (device)(irate(system_disk_io{direction="read",\${scope:host},${DISK_EXCL},${GUARD}}[5m]))`,
            ),
          ],
        },
        {
          id: "hd_disk_write",
          titleKey: "infra.hosts.panel.diskWrite",
          type: "line",
          unit: "bps",
          groupId: "hostmetrics",
          layout: { w: 96, h: 16 },
          variants: [
            {
              requiresStreams: ["system_disk_io"],
              queryType: "promql",
              queries: [
                {
                  query: `sum by (device)(irate(system_disk_io{direction="write",\${scope:host},${DISK_EXCL},${GUARD}}[5m]))`,
                  legend: "{device}",
                },
              ],
            },
          ],
          drilldown: [
            explorerDrilldown(
              "system_disk_io",
              `sum by (device)(irate(system_disk_io{direction="write",\${scope:host},${DISK_EXCL},${GUARD}}[5m]))`,
            ),
          ],
        },
        {
          // Grouped by device, not mountpoint: a bind mount reports byte-identical series at each mountpoint.
          id: "hd_fs_used_pct",
          titleKey: "infra.hosts.panel.filesystemUsedPct",
          type: "line",
          unit: "percent",
          groupId: "hostmetrics",
          layout: { w: 96, h: 16 },
          variants: [
            {
              requiresStreams: ["system_filesystem_usage"],
              queryType: "promql",
              queries: [
                {
                  query: `100 * sum by (device)(system_filesystem_usage{state="used",\${scope:host},${EXCL},${MPEXCL},${GUARD}}) / sum by (device)(system_filesystem_usage{\${scope:host},${EXCL},${MPEXCL},${GUARD}})`,
                  legend: "{device}",
                },
              ],
            },
          ],
          drilldown: [
            explorerDrilldown(
              "system_filesystem_usage",
              `100 * sum by (device)(system_filesystem_usage{state="used",\${scope:host},${EXCL},${MPEXCL},${GUARD}}) / sum by (device)(system_filesystem_usage{\${scope:host},${EXCL},${MPEXCL},${GUARD}})`,
            ),
          ],
        },
        {
          id: "hd_network_by_direction",
          titleKey: "infra.hosts.panel.networkByDirection",
          type: "line",
          unit: "bps",
          groupId: "hostmetrics",
          layout: { w: 96, h: 16 },
          variants: [
            {
              requiresStreams: ["system_network_io"],
              queryType: "promql",
              queries: [
                {
                  query: `sum by (direction)(irate(system_network_io{\${scope:host},${NET_EXCL},${GUARD}}[5m]))`,
                  legend: "{direction}",
                },
              ],
            },
          ],
          drilldown: [
            explorerDrilldown(
              "system_network_io",
              `sum by (direction)(irate(system_network_io{\${scope:host},${NET_EXCL},${GUARD}}[5m]))`,
            ),
          ],
        },
      ],
    },
  ],
};
