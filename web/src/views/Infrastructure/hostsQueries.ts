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

// Default window, matching the bundled dashboard's defaultDatetimeDuration ("3h").
export const HOSTS_DEFAULT_RELATIVE_PERIOD = "3h";

export const HOSTS_DEFAULT_WINDOW_US = 3 * 60 * 60 * 1000 * 1000;

export const HOSTS_LIVENESS_QUERY =
  "count by (host_name, os_type) (last_over_time(system_cpu_load_average_15m[10m]))";

// SQL because timestamp(last_over_time(...)) re-stamps at eval time in this engine.
export const HOSTS_LAST_SEEN_SQL =
  'SELECT host_name, max(_timestamp) AS last_seen FROM "system_cpu_load_average_15m" GROUP BY host_name';

export const HOSTS_CPU_QUERY =
  '100 * (1 - avg by (host_name)(irate(system_cpu_time{state="idle"}[5m])))';

// Two byte queries, no PromQL ratio — the % and the GB tooltip both derive client-side from the same bytes.
export const HOSTS_MEMORY_USED_QUERY = 'sum by (host_name)(system_memory_usage{state="used"})';

export const HOSTS_MEMORY_TOTAL_QUERY = "sum by (host_name)(system_memory_usage)";

export const HOSTS_DISK_QUERY = `100 * max by (host_name)(sum by (host_name, mountpoint)(system_filesystem_usage{state="used",device!~"${HOSTS_DEVICE_EXCLUSION}"}) / sum by (host_name, mountpoint)(system_filesystem_usage{device!~"${HOSTS_DEVICE_EXCLUSION}"}))`;

export const HOSTS_LOAD_QUERY = "avg by (host_name)(system_cpu_load_average_15m)";
