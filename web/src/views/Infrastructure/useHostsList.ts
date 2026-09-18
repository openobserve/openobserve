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

// Hosts-list data plane (design 4.8): 6 PromQL instant queries + 1 SQL
// last-seen, joined client-side on host_name. The picker's END anchors the
// utilization samples; its full range only bounds last-seen and membership.

import { computed, onScopeDispose, ref, watch } from "vue";
import { useStore } from "vuex";
import searchService from "@/services/search";
import { timestampToTimezoneDate } from "@/utils/timezone";
import {
  HOSTS_CORES_QUERY,
  HOSTS_CPU_QUERY,
  HOSTS_DISK_QUERY,
  HOSTS_LAST_SEEN_SQL,
  HOSTS_LIVENESS_QUERY,
  HOSTS_LOAD_QUERY,
  HOSTS_MEMORY_STATES,
  HOSTS_MEMORY_USAGE_QUERY,
  HOSTS_MEMORY_UTILIZATION_QUERY,
} from "./hostsQueries";

export type HostStatus = "ACTIVE" | "INACTIVE" | "UNKNOWN";

export interface HostRow {
  /** The series key: the collector's own hostname, which on a K8s DaemonSet is its POD name. */
  host_name: string;
  os_type: string | null;
  /** The K8s node this host's collector runs on; null off-cluster. */
  k8s_node_name: string | null;
  /** What the Host column shows: the node when we know it, else the series key. */
  display_name: string;
  status: HostStatus;
  cpu: number | null;
  memoryPct: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  disk: number | null;
  /** The raw {thread} count the host's own `uptime` prints — never pre-divided by cores. */
  load: number | null;
  cores: number | null;
  /** Populated only when cores resolved AND the fleet is not already collector-normalized. */
  loadPerCore: number | null;
  lastSeen: string | null;
  /** The raw µs behind `lastSeen` — the curated drawer badges off THIS host's
   * own last-seen, which a formatted string cannot be compared against. */
  lastSeenUs: number | null;
}

export interface HostsRefreshArgs {
  orgId: string;
  start: number;
  end: number;
}

const PAGE_SIZE = 50;
const NAME_FILTER_DEBOUNCE_MS = 300;
const LAST_SEEN_FORMAT = "yyyy-MM-dd HH:mm:ss";

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** One host's memory reading: the % and the byte pair always come from the SAME source. */
interface MemoryReading {
  pct: number | null;
  usedBytes: number | null;
  totalBytes: number | null;
}

const EMPTY_MEMORY: MemoryReading = { pct: null, usedBytes: null, totalBytes: null };

/** Primary is OTel's utilization gauge; the usage-sum fallback double-counts, so a host never mixes the two. */
function readMemory(
  utilization: Map<string, number> | undefined,
  usage: Map<string, number> | undefined,
): MemoryReading {
  const usedBytes = usage?.get("used") ?? null;
  const usedRatio = utilization?.get("used");
  if (usedRatio != null) {
    // Six redundant MemTotal estimates from separate scrapes; the median rejects a skewed one.
    const totals: number[] = [];
    for (const state of HOSTS_MEMORY_STATES) {
      const ratio = utilization.get(state);
      const bytes = usage?.get(state);
      if (ratio != null && ratio > 0 && bytes != null) totals.push(bytes / ratio);
    }
    return {
      pct: usedRatio * 100,
      usedBytes,
      totalBytes: totals.length ? median(totals) : null,
    };
  }
  if (usage == null || usedBytes == null) return EMPTY_MEMORY;
  let total = 0;
  for (const bytes of usage.values()) total += bytes;
  if (!(total > 0)) return EMPTY_MEMORY;
  return { pct: (usedBytes / total) * 100, usedBytes, totalBytes: total };
}

/** Threshold tint for the % columns — value is always printed alongside. */
export function utilizationTint(value: number | null): "" | "warn" | "critical" {
  if (value == null) return "";
  if (value >= 90) return "critical";
  if (value >= 70) return "warn";
  return "";
}

export function useHostsList() {
  const store = useStore();

  const rows = ref<HostRow[]>([]);
  const banners = ref({ liveness: false, lastSeen: false });
  const pageError = ref<string | null>(null);

  const nameFilter = ref("");
  const statusFilter = ref<string[]>([]);
  const osFilter = ref<string[]>([]);
  const sortBy = ref("cpu");
  const sortDesc = ref(true);
  const page = ref(1);

  // metrics_query takes no AbortSignal — superseded responses are generation-dropped, not cancelled.
  let generation = 0;

  const vectorToMap = (settled: PromiseSettledResult<any>): Map<string, number> | null => {
    if (settled.status !== "fulfilled") return null;
    const out = new Map<string, number>();
    const result: any[] = settled.value?.data?.data?.result ?? [];
    for (const entry of result) {
      const host = entry?.metric?.host_name;
      if (!host) continue;
      const value = Number(entry.value?.[1]);
      // Prometheus emits "NaN" for 0/0 — a non-finite sample must blank the cell, not render "NaN%".
      if (!Number.isFinite(value)) continue;
      out.set(host, value);
    }
    return out;
  };

  const vectorToStateMap = (
    settled: PromiseSettledResult<any>,
  ): Map<string, Map<string, number>> | null => {
    if (settled.status !== "fulfilled") return null;
    const out = new Map<string, Map<string, number>>();
    const result: any[] = settled.value?.data?.data?.result ?? [];
    for (const entry of result) {
      const host = entry?.metric?.host_name;
      const state = entry?.metric?.state;
      if (!host || !state) continue;
      const value = Number(entry.value?.[1]);
      if (!Number.isFinite(value)) continue;
      let states = out.get(host);
      if (!states) out.set(host, (states = new Map()));
      states.set(state, value);
    }
    return out;
  };

  const refresh = async ({ orgId, start, end }: HostsRefreshArgs) => {
    const gen = ++generation;
    // Utilization is the latest sample at the window's END, not an aggregate:
    // /api/v1/query takes no range, and this engine cannot evaluate the
    // subquery that wrapping `irate`/ratio expressions in max_over_time needs.
    const instant = (query: string) =>
      searchService.metrics_query({
        org_identifier: orgId,
        // metrics_query interpolates the query RAW into the URL — encode here.
        query: encodeURIComponent(query),
        end_time: end,
      });
    const results = await Promise.allSettled([
      instant(HOSTS_LIVENESS_QUERY),
      instant(HOSTS_CPU_QUERY),
      instant(HOSTS_MEMORY_UTILIZATION_QUERY),
      instant(HOSTS_MEMORY_USAGE_QUERY),
      instant(HOSTS_DISK_QUERY),
      instant(HOSTS_LOAD_QUERY),
      instant(HOSTS_CORES_QUERY),
      searchService.search(
        {
          org_identifier: orgId,
          query: {
            query: {
              sql: HOSTS_LAST_SEEN_SQL,
              start_time: start,
              end_time: end,
              from: 0,
              // Silent ceiling: hosts beyond 10k rows drop from last-seen with no error surfaced.
              size: 10000,
            },
          },
          page_type: "metrics",
        },
        "ui",
      ),
    ]);
    if (gen !== generation) return;

    const [liveness, cpu, memUtilization, memUsage, disk, load, cores, lastSeen] = results;

    if (results.every((r) => r.status === "rejected")) {
      rows.value = [];
      banners.value = { liveness: false, lastSeen: false };
      pageError.value = (results[0] as PromiseRejectedResult).reason?.message ?? "error";
      return;
    }
    pageError.value = null;
    banners.value = {
      liveness: liveness.status === "rejected",
      lastSeen: lastSeen.status === "rejected",
    };

    // Liveness reduces per host_name: first non-empty os_type wins.
    const liveHosts = new Map<string, string | null>();
    const nodeByHost = new Map<string, string>();
    if (liveness.status === "fulfilled") {
      const result: any[] = liveness.value?.data?.data?.result ?? [];
      for (const entry of result) {
        const host = entry?.metric?.host_name;
        if (!host) continue;
        const osType = entry?.metric?.os_type || null;
        if (!liveHosts.has(host) || (liveHosts.get(host) == null && osType != null)) {
          liveHosts.set(host, osType);
        }
        const node = entry?.metric?.k8s_node_name;
        if (node && !nodeByHost.has(host)) nodeByHost.set(host, node);
      }
    }

    const lastSeenByHost = new Map<string, number>();
    // Grouping by node can emit >1 row per host; the most recent one wins so the row count cannot grow.
    const lastSeenNodeByHost = new Map<string, string>();
    if (lastSeen.status === "fulfilled") {
      for (const hit of lastSeen.value?.data?.hits ?? []) {
        if (!hit?.host_name) continue;
        const seen = Number(hit.last_seen);
        const previous = lastSeenByHost.get(hit.host_name);
        if (previous != null && !(seen > previous)) continue;
        lastSeenByHost.set(hit.host_name, seen);
        if (hit.k8s_node_name) lastSeenNodeByHost.set(hit.host_name, hit.k8s_node_name);
      }
    }

    const cpuMap = vectorToMap(cpu);
    const diskMap = vectorToMap(disk);
    const loadMap = vectorToMap(load);
    const coresMap = vectorToMap(cores);
    // Utilization alone rejecting only costs the primary path; usage carries the fallback.
    const memUtilizationMap = vectorToStateMap(memUtilization);
    const memUsageMap = vectorToStateMap(memUsage);

    // loadscraper's cpu_average pre-divides by cores under the same metric name, and only a raw fleet exceeds 1.0.
    const fleetReportsRawLoad = [...(loadMap?.values() ?? [])].some((value) => value > 1);

    const hostNames = new Set<string>([...liveHosts.keys(), ...lastSeenByHost.keys()]);
    const timezone = store.state.timezone;
    const joined: HostRow[] = [];
    for (const host of hostNames) {
      // Liveness down must read UNKNOWN, never a false fleet-wide INACTIVE.
      const status: HostStatus =
        liveness.status === "rejected" ? "UNKNOWN" : liveHosts.has(host) ? "ACTIVE" : "INACTIVE";
      const memory = readMemory(memUtilizationMap?.get(host), memUsageMap?.get(host));
      const hostLoad = loadMap?.get(host) ?? null;
      const hostCores = coresMap?.get(host) ?? null;
      const lastSeenRaw = lastSeenByHost.get(host);
      // Liveness wins: it is the live label, and last-seen only fills the gap for hosts it never covers.
      const nodeName = nodeByHost.get(host) ?? lastSeenNodeByHost.get(host) ?? null;
      joined.push({
        host_name: host,
        os_type: liveHosts.get(host) ?? null,
        k8s_node_name: nodeName,
        // A pod name identifies the collector, not the machine — prefer the node.
        display_name: nodeName ?? host,
        status,
        cpu: cpuMap?.get(host) ?? null,
        memoryPct: memory.pct,
        memoryUsedBytes: memory.usedBytes,
        memoryTotalBytes: memory.totalBytes,
        disk: diskMap?.get(host) ?? null,
        load: hostLoad,
        cores: hostCores,
        loadPerCore:
          hostLoad != null && hostCores != null && hostCores > 0 && fleetReportsRawLoad
            ? hostLoad / hostCores
            : null,
        lastSeen:
          lastSeenRaw != null
            ? timestampToTimezoneDate(lastSeenRaw, timezone, LAST_SEEN_FORMAT)
            : null,
        lastSeenUs: lastSeenRaw ?? null,
      });
    }
    rows.value = joined;
  };

  const fleetCount = computed(() => ({
    total: rows.value.length,
    active: rows.value.filter((r) => r.status === "ACTIVE").length,
  }));

  const facets = computed(() => {
    const statusCount = (status: HostStatus) =>
      rows.value.filter((r) => r.status === status).length;
    // Fixed order, UNKNOWN appended last only when present — the rail never shifts.
    const status = [
      { value: "ACTIVE", count: statusCount("ACTIVE") },
      { value: "INACTIVE", count: statusCount("INACTIVE") },
    ];
    const unknown = statusCount("UNKNOWN");
    if (unknown > 0) status.push({ value: "UNKNOWN", count: unknown });

    const osCounts = new Map<string, number>();
    for (const row of rows.value) {
      if (row.os_type) osCounts.set(row.os_type, (osCounts.get(row.os_type) ?? 0) + 1);
    }
    return {
      status,
      os: [...osCounts.entries()].map(([value, count]) => ({ value, count })),
    };
  });

  const debouncedName = ref("");
  let nameTimer: ReturnType<typeof setTimeout> | null = null;
  watch(nameFilter, (value) => {
    if (nameTimer) clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      debouncedName.value = value;
    }, NAME_FILTER_DEBOUNCE_MS);
  });
  onScopeDispose(() => {
    if (nameTimer) clearTimeout(nameTimer);
  });

  const filteredRows = computed(() => {
    const name = debouncedName.value.toLowerCase();
    const filtered = rows.value.filter((row) => {
      if (
        name &&
        !row.display_name.toLowerCase().includes(name) &&
        !row.host_name.toLowerCase().includes(name)
      )
        return false;
      if (statusFilter.value.length && !statusFilter.value.includes(row.status)) return false;
      if (osFilter.value.length && !osFilter.value.includes(row.os_type ?? "")) return false;
      return true;
    });
    const key = sortBy.value as keyof HostRow;
    const dir = sortDesc.value ? -1 : 1;
    // A raw {thread} count is incomparable across a fleet of 1–32 cores, so Load ranks per-core.
    const sortValue = (row: HostRow) => (key === "load" ? (row.loadPerCore ?? row.load) : row[key]);
    return [...filtered].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      // A blanked sort column sorts last regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  });

  const pagedRows = computed(() =>
    filteredRows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE),
  );

  // A refresh/filter that shrinks the list must never strand the pager on an empty page.
  watch(filteredRows, (current) => {
    const lastPage = Math.max(1, Math.ceil(current.length / PAGE_SIZE));
    if (page.value > lastPage) page.value = lastPage;
  });

  return {
    rows,
    filteredRows,
    pagedRows,
    facets,
    fleetCount,
    banners,
    pageError,
    nameFilter,
    statusFilter,
    osFilter,
    sortBy,
    sortDesc,
    page,
    refresh,
  };
}
