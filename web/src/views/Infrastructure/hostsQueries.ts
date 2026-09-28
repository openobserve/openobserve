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

// Hosts-list query constants (design 4.8). Liveness and last-seen ride
// system_cpu_load_average_15m — exactly ONE series per host — never
// system_cpu_time, whose per-state × per-CPU fan-out explodes the row count.

export const HOSTS_DEVICE_EXCLUSION = "/dev/loop.*|tmpfs|nsfs|squashfs|overlay";

// A ~10MB /boot/efi runs high on a healthy host, so `max` reports it over the real root volume.
export const HOSTS_MOUNTPOINT_EXCLUSION = "/boot.*|/efi.*";

// Prospective: language SDKs write these same stream names, so exclude them before one ever emits the load stream.
// The dot is unescaped because this engine rejects `\.` in a matcher with "unknown escape sequence".
export const HOSTS_PRODUCER_GUARD =
  'instrumentation_library_name!~".*instrumentation.system_metrics.*"';

// The IS NULL branch keeps a host whose label is absent: NOT LIKE alone is unknown-valued, not true, for NULL.
export const HOSTS_PRODUCER_GUARD_SQL =
  "(instrumentation_library_name IS NULL OR instrumentation_library_name NOT LIKE '%instrumentation.system_metrics%')";

// Default window, matching the bundled dashboard's defaultDatetimeDuration ("3h").
export const HOSTS_DEFAULT_RELATIVE_PERIOD = "3h";

export const HOSTS_DEFAULT_WINDOW_US = 3 * 60 * 60 * 1000 * 1000;

// k8s_node_name rides liveness because host_name is the collector's hostname — a pod name on a DaemonSet.
export const HOSTS_LIVENESS_QUERY = `count by (host_name, os_type, k8s_node_name) (last_over_time(system_cpu_load_average_15m{${HOSTS_PRODUCER_GUARD}}[10m]))`;

// SQL because timestamp(last_over_time(...)) re-stamps at eval time in this engine.
// k8s_node_name is grouped too because liveness carries it only for ACTIVE hosts, leaving dead ones pod-named.
export const HOSTS_LAST_SEEN_SQL = `SELECT host_name, k8s_node_name, max(_timestamp) AS last_seen FROM "system_cpu_load_average_15m" WHERE ${HOSTS_PRODUCER_GUARD_SQL} GROUP BY host_name, k8s_node_name`;

export const HOSTS_CPU_QUERY = `100 * (1 - avg by (host_name)(irate(system_cpu_time{state="idle",${HOSTS_PRODUCER_GUARD}}[5m])))`;

// The six states the collector ratios against ONE MemTotal; each is a redundant MemTotal estimate.
export const HOSTS_MEMORY_STATES = [
  "used",
  "free",
  "cached",
  "buffered",
  "slab_reclaimable",
  "slab_unreclaimable",
] as const;

// The collector divides every state by one authoritative MemTotal, so no sum of states reconstructs it.
export const HOSTS_MEMORY_UTILIZATION_QUERY = `system_memory_utilization{${HOSTS_PRODUCER_GUARD}}`;

// system.memory.utilization is opt-in upstream, so on a stock collector this is the only memory metric emitted.
export const HOSTS_MEMORY_USAGE_QUERY = `system_memory_usage{${HOSTS_PRODUCER_GUARD}}`;

export const HOSTS_DISK_QUERY = `100 * max by (host_name)(sum by (host_name, mountpoint)(system_filesystem_usage{state="used",device!~"${HOSTS_DEVICE_EXCLUSION}",mountpoint!~"${HOSTS_MOUNTPOINT_EXCLUSION}",${HOSTS_PRODUCER_GUARD}}) / sum by (host_name, mountpoint)(system_filesystem_usage{device!~"${HOSTS_DEVICE_EXCLUSION}",mountpoint!~"${HOSTS_MOUNTPOINT_EXCLUSION}",${HOSTS_PRODUCER_GUARD}}))`;

export const HOSTS_LOAD_QUERY = `avg by (host_name)(system_cpu_load_average_15m{${HOSTS_PRODUCER_GUARD}})`;

// system_cpu_logical_count is opt-in and unemitted here; system_cpu_time is default-on and carries one series per cpu.
export const HOSTS_CORES_QUERY = `count by (host_name)(count by (host_name, cpu)(system_cpu_time{state="idle",${HOSTS_PRODUCER_GUARD}}))`;
