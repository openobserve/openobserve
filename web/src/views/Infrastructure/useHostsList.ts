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
  HOSTS_CPU_QUERY,
  HOSTS_DISK_QUERY,
  HOSTS_LAST_SEEN_SQL,
  HOSTS_LIVENESS_QUERY,
  HOSTS_LOAD_QUERY,
  HOSTS_MEMORY_TOTAL_QUERY,
  HOSTS_MEMORY_USED_QUERY,
} from "./hostsQueries";

export type HostStatus = "ACTIVE" | "INACTIVE" | "UNKNOWN";

export interface HostRow {
  host_name: string;
  os_type: string | null;
  status: HostStatus;
  cpu: number | null;
  memoryPct: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
  disk: number | null;
  load: number | null;
  lastSeen: string | null;
  /** The raw µs behind `lastSeen` — the curated drawer badges off THIS host's
   * own last-seen, which a formatted string cannot be compared against. */
  lastSeenUs: number | null;
  /** This host's OWN first sample, µs. Stream stats carry a fleet-wide doc_time_min,
   * which says nothing about when an ephemeral pod started reporting. */
  firstSeenUs: number | null;
}

export interface HostsRefreshArgs {
  orgId: string;
  start: number;
  end: number;
}

const PAGE_SIZE = 50;
const NAME_FILTER_DEBOUNCE_MS = 300;
const LAST_SEEN_FORMAT = "yyyy-MM-dd HH:mm:ss";

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
      instant(HOSTS_MEMORY_USED_QUERY),
      instant(HOSTS_MEMORY_TOTAL_QUERY),
      instant(HOSTS_DISK_QUERY),
      instant(HOSTS_LOAD_QUERY),
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

    const [liveness, cpu, memUsed, memTotal, disk, load, lastSeen] = results;

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
    if (liveness.status === "fulfilled") {
      const result: any[] = liveness.value?.data?.data?.result ?? [];
      for (const entry of result) {
        const host = entry?.metric?.host_name;
        if (!host) continue;
        const osType = entry?.metric?.os_type || null;
        if (!liveHosts.has(host) || (liveHosts.get(host) == null && osType != null)) {
          liveHosts.set(host, osType);
        }
      }
    }

    const lastSeenByHost = new Map<string, number>();
    const firstSeenByHost = new Map<string, number>();
    if (lastSeen.status === "fulfilled") {
      for (const hit of lastSeen.value?.data?.hits ?? []) {
        if (!hit?.host_name) continue;
        lastSeenByHost.set(hit.host_name, Number(hit.last_seen));
        // A missing or 0 first_seen would format as the Unix epoch, so it must stay absent.
        const first = Number(hit.first_seen);
        if (Number.isFinite(first) && first > 0) firstSeenByHost.set(hit.host_name, first);
      }
    }

    const cpuMap = vectorToMap(cpu);
    const diskMap = vectorToMap(disk);
    const loadMap = vectorToMap(load);
    // Either memory query failing blanks the whole memory column.
    const memOk = memUsed.status === "fulfilled" && memTotal.status === "fulfilled";
    const memUsedMap = memOk ? vectorToMap(memUsed) : null;
    const memTotalMap = memOk ? vectorToMap(memTotal) : null;

    const hostNames = new Set<string>([...liveHosts.keys(), ...lastSeenByHost.keys()]);
    const timezone = store.state.timezone;
    const joined: HostRow[] = [];
    for (const host of hostNames) {
      // Liveness down must read UNKNOWN, never a false fleet-wide INACTIVE.
      const status: HostStatus =
        liveness.status === "rejected" ? "UNKNOWN" : liveHosts.has(host) ? "ACTIVE" : "INACTIVE";
      const usedBytes = memUsedMap?.get(host) ?? null;
      const totalBytes = memTotalMap?.get(host) ?? null;
      const lastSeenRaw = lastSeenByHost.get(host);
      joined.push({
        host_name: host,
        os_type: liveHosts.get(host) ?? null,
        status,
        cpu: cpuMap?.get(host) ?? null,
        memoryPct:
          usedBytes != null && totalBytes != null && totalBytes > 0
            ? (usedBytes / totalBytes) * 100
            : null,
        memoryUsedBytes: usedBytes,
        memoryTotalBytes: totalBytes,
        disk: diskMap?.get(host) ?? null,
        load: loadMap?.get(host) ?? null,
        lastSeen:
          lastSeenRaw != null
            ? timestampToTimezoneDate(lastSeenRaw, timezone, LAST_SEEN_FORMAT)
            : null,
        lastSeenUs: lastSeenRaw ?? null,
        firstSeenUs: firstSeenByHost.get(host) ?? null,
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
      if (name && !row.host_name.toLowerCase().includes(name)) return false;
      if (statusFilter.value.length && !statusFilter.value.includes(row.status)) return false;
      if (osFilter.value.length && !osFilter.value.includes(row.os_type ?? "")) return false;
      return true;
    });
    const key = sortBy.value as keyof HostRow;
    const dir = sortDesc.value ? -1 : 1;
    return [...filtered].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
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
