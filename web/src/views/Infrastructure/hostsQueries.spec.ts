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

// The Hosts-list query constants (design 4.8/§6) — scale-critical shapes pinned as exported strings.

import { describe, it, expect } from "vitest";
import * as hostsQueries from "./hostsQueries";
import {
  HOSTS_LIVENESS_QUERY,
  HOSTS_LAST_SEEN_SQL,
  HOSTS_CPU_QUERY,
  HOSTS_MEMORY_USED_QUERY,
  HOSTS_MEMORY_TOTAL_QUERY,
  HOSTS_DISK_QUERY,
  HOSTS_LOAD_QUERY,
} from "./hostsQueries";

const PROMQL_CONSTANTS = [
  HOSTS_LIVENESS_QUERY,
  HOSTS_CPU_QUERY,
  HOSTS_MEMORY_USED_QUERY,
  HOSTS_MEMORY_TOTAL_QUERY,
  HOSTS_DISK_QUERY,
  HOSTS_LOAD_QUERY,
];

describe("hostsQueries — liveness & last-seen ride the 1-series-per-host load stream", () => {
  it("liveness counts last_over_time over system_cpu_load_average_15m, by host and os_type", () => {
    expect(HOSTS_LIVENESS_QUERY).toBe(
      "count by (host_name, os_type) (last_over_time(system_cpu_load_average_15m[10m]))",
    );
  });

  it("last-seen is SQL max(_timestamp) grouped by host over the same load stream", () => {
    expect(HOSTS_LAST_SEEN_SQL).toContain("max(_timestamp)");
    expect(HOSTS_LAST_SEEN_SQL).toContain('FROM "system_cpu_load_average_15m"');
    expect(HOSTS_LAST_SEEN_SQL).toContain("GROUP BY host_name");
  });

  it("first-seen rides the SAME aggregate as last-seen, so the banner costs no extra request", () => {
    expect(HOSTS_LAST_SEEN_SQL).toContain("min(_timestamp)");
    expect(HOSTS_LAST_SEEN_SQL).toContain("first_seen");
    // One statement, one GROUP BY: a second SELECT here would be a second round trip.
    expect(HOSTS_LAST_SEEN_SQL.match(/SELECT/gi)).toHaveLength(1);
  });

  it("never keys liveness or last-seen on system_cpu_time (per-state × per-CPU blowup)", () => {
    expect(HOSTS_LIVENESS_QUERY).not.toContain("system_cpu_time");
    expect(HOSTS_LAST_SEEN_SQL).not.toContain("system_cpu_time");
  });

  it("system_cpu_time appears ONLY in the CPU % constant", () => {
    const allStringExports = Object.entries(hostsQueries).filter(
      ([, v]) => typeof v === "string",
    ) as Array<[string, string]>;
    for (const [name, value] of allStringExports) {
      if (name === "HOSTS_CPU_QUERY") continue;
      expect(value, name).not.toContain("system_cpu_time");
    }
    expect(HOSTS_CPU_QUERY).toContain("system_cpu_time");
  });
});

describe("hostsQueries — utilization shapes", () => {
  it("CPU is the 1 - idle form, never a partial state sum", () => {
    expect(HOSTS_CPU_QUERY).toBe(
      '100 * (1 - avg by (host_name)(irate(system_cpu_time{state="idle"}[5m])))',
    );
  });

  it("memory is TWO byte queries — used and total — with no ratio in PromQL", () => {
    // The % AND the GB tooltip both derive client-side from the same bytes.
    expect(HOSTS_MEMORY_USED_QUERY).toBe('sum by (host_name)(system_memory_usage{state="used"})');
    expect(HOSTS_MEMORY_TOTAL_QUERY).toBe("sum by (host_name)(system_memory_usage)");
    expect(HOSTS_MEMORY_USED_QUERY).not.toContain("/");
    expect(HOSTS_MEMORY_TOTAL_QUERY).not.toContain("/");
  });

  it("disk takes the worst mountpoint with the single no-space device exclusion", () => {
    expect(HOSTS_DISK_QUERY).toContain("max by (host_name)");
    expect(HOSTS_DISK_QUERY).toContain("system_filesystem_usage");
    expect(HOSTS_DISK_QUERY).toContain('device!~"/dev/loop.*|tmpfs|nsfs|squashfs|overlay"');
    // The shipped `"tmpfs | nsfs"` bug: whitespace inside a matcher matches nothing.
    const matcherValues = [...HOSTS_DISK_QUERY.matchAll(/(?:=~|!~)\s*"((?:[^"\\]|\\.)*)"/g)].map(
      (m) => m[1],
    );
    for (const v of matcherValues) expect(v).not.toMatch(/\s/);
  });

  it("load is the 15m average by host", () => {
    expect(HOSTS_LOAD_QUERY).toBe("avg by (host_name)(system_cpu_load_average_15m)");
  });

  it("every PromQL constant aggregates by (host_name)", () => {
    for (const q of PROMQL_CONSTANTS) {
      expect(q).toContain("by (host_name");
    }
  });
});

describe("hostsQueries — default window constants", () => {
  it("the microsecond window and the DateTime relative period agree (single 3h source)", () => {
    const match = /^(\d+)h$/.exec(hostsQueries.HOSTS_DEFAULT_RELATIVE_PERIOD);
    expect(match).not.toBeNull();
    const hours = Number(match![1]);
    expect(hostsQueries.HOSTS_DEFAULT_WINDOW_US).toBe(hours * 60 * 60 * 1000 * 1000);
  });

  it("matches the bundled dashboard's defaultDatetimeDuration", async () => {
    const dashboard: any = (await import("@/assets/dashboards/host_metrics.dashboard.json"))
      .default;
    expect(dashboard.defaultDatetimeDuration.relativeTimePeriod).toBe(
      hostsQueries.HOSTS_DEFAULT_RELATIVE_PERIOD,
    );
  });
});
