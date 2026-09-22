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
  HOSTS_MEMORY_UTILIZATION_QUERY,
  HOSTS_MEMORY_USAGE_QUERY,
  HOSTS_MEMORY_STATES,
  HOSTS_DISK_QUERY,
  HOSTS_LOAD_QUERY,
  HOSTS_CORES_QUERY,
  HOSTS_PRODUCER_GUARD,
  HOSTS_PRODUCER_GUARD_SQL,
} from "./hostsQueries";

// Stated literally, NOT interpolated from the constant: interpolating makes the
// assertion tautological and a typo'd label name would pass.
const GUARD = 'instrumentation_library_name!~".*instrumentation.system_metrics.*"';

const PROMQL_CONSTANTS = [
  HOSTS_LIVENESS_QUERY,
  HOSTS_CPU_QUERY,
  HOSTS_MEMORY_UTILIZATION_QUERY,
  HOSTS_MEMORY_USAGE_QUERY,
  HOSTS_DISK_QUERY,
  HOSTS_LOAD_QUERY,
  HOSTS_CORES_QUERY,
];

// The two memory queries deliberately return per-state series for client-side reduction.
const AGGREGATED_CONSTANTS = [
  HOSTS_LIVENESS_QUERY,
  HOSTS_CPU_QUERY,
  HOSTS_DISK_QUERY,
  HOSTS_LOAD_QUERY,
  HOSTS_CORES_QUERY,
];

describe("hostsQueries — liveness & last-seen ride the 1-series-per-host load stream", () => {
  it("liveness counts last_over_time over system_cpu_load_average_15m, by host and os_type", () => {
    expect(HOSTS_LIVENESS_QUERY).toBe(
      "count by (host_name, os_type, k8s_node_name) (last_over_time(system_cpu_load_average_15m{" +
        GUARD +
        "}[10m]))",
    );
  });

  it("last-seen is SQL max(_timestamp) grouped by host over the same load stream", () => {
    expect(HOSTS_LAST_SEEN_SQL).toContain("max(_timestamp)");
    expect(HOSTS_LAST_SEEN_SQL).toContain('FROM "system_cpu_load_average_15m"');
    expect(HOSTS_LAST_SEEN_SQL).toContain("GROUP BY host_name");
  });

  /**
   * A min(_timestamp) here is bounded by the caller's window, so it yields that
   * window's floor rather than the host's first sample — a first-seen claim this
   * query cannot make, and one that contradicted the drawer's own panels.
   */
  it("claims no first-seen, which this window-bounded scan cannot know", () => {
    expect(HOSTS_LAST_SEEN_SQL).not.toContain("min(_timestamp)");
    expect(HOSTS_LAST_SEEN_SQL).not.toContain("first_seen");
    // One statement, one GROUP BY: a second SELECT here would be a second round trip.
    expect(HOSTS_LAST_SEEN_SQL.match(/SELECT/gi)).toHaveLength(1);
  });

  it("never keys liveness or last-seen on system_cpu_time (per-state × per-CPU blowup)", () => {
    expect(HOSTS_LIVENESS_QUERY).not.toContain("system_cpu_time");
    expect(HOSTS_LAST_SEEN_SQL).not.toContain("system_cpu_time");
  });

  it("system_cpu_time appears ONLY where its per-cpu fan-out is the point", () => {
    // Cores COUNTS that fan-out; everything else must avoid the row blowup.
    const allowed = new Set(["HOSTS_CPU_QUERY", "HOSTS_CORES_QUERY"]);
    const allStringExports = Object.entries(hostsQueries).filter(
      ([, v]) => typeof v === "string",
    ) as Array<[string, string]>;
    for (const [name, value] of allStringExports) {
      if (allowed.has(name)) continue;
      expect(value, name).not.toContain("system_cpu_time");
    }
    expect(HOSTS_CPU_QUERY).toContain("system_cpu_time");
  });
});

describe("hostsQueries — utilization shapes", () => {
  it("CPU is the 1 - idle form, never a partial state sum", () => {
    expect(HOSTS_CPU_QUERY).toBe(
      '100 * (1 - avg by (host_name)(irate(system_cpu_time{state="idle",' + GUARD + "}[5m])))",
    );
  });

  // The collector computes every state as ratio(state, MemTotal) against ONE
  // authoritative MemTotal, so no sum of states reconstructs it.
  it("memory % comes from OTel's own utilization gauge, not a reconstructed total", () => {
    expect(HOSTS_MEMORY_UTILIZATION_QUERY).toBe("system_memory_utilization{" + GUARD + "}");
    // Unaggregated: the client needs every state to derive MemTotal and the fallback.
    expect(HOSTS_MEMORY_UTILIZATION_QUERY).not.toContain("sum by");
    expect(HOSTS_MEMORY_UTILIZATION_QUERY).not.toContain("/");
  });

  // system.memory.utilization is `enabled: false` upstream, so a stock collector
  // emits only usage and the column would go blank without this second query.
  it("fetches the always-on usage bytes too, for the fallback and the byte tooltip", () => {
    expect(HOSTS_MEMORY_USAGE_QUERY).toBe("system_memory_usage{" + GUARD + "}");
    expect(HOSTS_MEMORY_USAGE_QUERY).not.toContain("/");
  });

  it("constrains neither memory query by state, so every state reaches the client", () => {
    // A state filter here would strip the redundant MemTotal estimates the median needs.
    for (const q of [HOSTS_MEMORY_UTILIZATION_QUERY, HOSTS_MEMORY_USAGE_QUERY]) {
      expect(q, q).not.toMatch(/state\s*=~?"/);
    }
  });

  it("names the six states the collector ratios against MemTotal, slab included", () => {
    // Slab is INSIDE the partition: the collector divides it by the same MemTotal.
    expect([...HOSTS_MEMORY_STATES].sort()).toEqual(
      ["buffered", "cached", "free", "slab_reclaimable", "slab_unreclaimable", "used"].sort(),
    );
  });

  it("last-seen carries the node so INACTIVE rows can be named", () => {
    // Liveness holds k8s_node_name only for ACTIVE hosts; without it here a dead
    // host can never resolve anything but the collector's pod name.
    expect(HOSTS_LAST_SEEN_SQL).toContain("k8s_node_name");
    // Grouped, not aggregated: the column must be in GROUP BY for the SQL to be legal.
    expect(HOSTS_LAST_SEEN_SQL.split("GROUP BY")[1]).toContain("k8s_node_name");
  });

  it("disk excludes firmware mountpoints so max reports a real filesystem", () => {
    // A ~10MB /boot/efi at 13.70% beat every real root volume on 82 of 116 hosts.
    const mountpointMatchers = [...HOSTS_DISK_QUERY.matchAll(/mountpoint!~"([^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(mountpointMatchers).toEqual(["/boot.*|/efi.*", "/boot.*|/efi.*"]);
    // Both halves of the ratio must filter identically, or the divisor keeps the partition.
    expect(HOSTS_DISK_QUERY.split("/ sum by")).toHaveLength(2);
    for (const half of HOSTS_DISK_QUERY.split("/ sum by")) {
      expect(half, half).toContain('mountpoint!~"/boot.*|/efi.*"');
    }
    // A real data mount at 76.34% is not a bug and must still be reported.
    expect(HOSTS_DISK_QUERY).not.toContain('mountpoint="/"');
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

  it("load is the 15m average by host, kept RAW", () => {
    expect(HOSTS_LOAD_QUERY).toBe("avg by (host_name)(system_cpu_load_average_15m{" + GUARD + "})");
    // Dividing here would contradict what `uptime` prints on the host itself.
    expect(HOSTS_LOAD_QUERY).not.toContain("/");
  });

  it("counts cores off the DEFAULT-ON cpu metric, one series per cpu", () => {
    // system_cpu_logical_count is opt-in and this fleet emits zero series of it.
    expect(HOSTS_CORES_QUERY).toBe(
      'count by (host_name)(count by (host_name, cpu)(system_cpu_time{state="idle",' +
        GUARD +
        "}))",
    );
    expect(HOSTS_CORES_QUERY).not.toContain("system_cpu_logical_count");
    // One state only: without it each cpu contributes a series per state.
    expect(HOSTS_CORES_QUERY).toContain('state="idle"');
  });

  it("the guard names the label the collector actually writes", () => {
    expect(HOSTS_PRODUCER_GUARD).toBe(GUARD);
  });

  it("every query the row set or a value comes from excludes language-SDK process metrics", () => {
    // Row membership is liveness ∪ last-seen, so an unguarded row source conjures
    // a row whose every value column is blank.
    for (const q of PROMQL_CONSTANTS) {
      expect(q, q).toContain(GUARD);
    }
    expect(HOSTS_LAST_SEEN_SQL).toContain("instrumentation_library_name");
  });

  it("the SQL guard keeps hosts whose series never carry the label", () => {
    // NOT LIKE alone is unknown-valued against NULL, which would drop every such host.
    expect(HOSTS_PRODUCER_GUARD_SQL).toBe(
      "(instrumentation_library_name IS NULL OR instrumentation_library_name NOT LIKE " +
        "'%instrumentation.system_metrics%')",
    );
    expect(HOSTS_LAST_SEEN_SQL).toContain(HOSTS_PRODUCER_GUARD_SQL);
  });

  it("the guard excludes by negative match, so a series missing the label still counts", () => {
    expect(HOSTS_PRODUCER_GUARD).toContain("!~");
    expect(HOSTS_PRODUCER_GUARD).not.toContain("=~");
  });

  it("no PromQL constant contains a backslash escape", () => {
    // The metrics engine rejects `\.` inside a matcher with "unknown escape
    // sequence", which fails the whole query and blanks the column.
    for (const q of PROMQL_CONSTANTS) {
      expect(q, q).not.toContain("\\");
    }
  });

  it("every reduced PromQL constant aggregates by (host_name)", () => {
    for (const q of AGGREGATED_CONSTANTS) {
      expect(q, q).toContain("by (host_name");
    }
  });

  it("every PromQL constant carries host_name, so the client can join on it", () => {
    for (const q of PROMQL_CONSTANTS) {
      // The unaggregated memory queries carry it as a series label instead.
      expect(q, q).toMatch(/by \(host_name|^system_memory_/);
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
