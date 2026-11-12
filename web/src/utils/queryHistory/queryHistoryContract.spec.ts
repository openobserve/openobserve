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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import http from "@/services/http";
import type { QueryHistoryEntry, QueryHistoryRecordBody } from "@/services/query_history";
import { queryHistoryCountQuery } from "@/services/query_history.queries";
import { queryHistoryKeys } from "@/services/query_history.querykeys";
import type { LogsSignature } from "@/composables/useLogs/useAutoRun";
import { useQueryHistoryRecorder } from "@/composables/metrics/useQueryHistoryRecorder";
import { buildLogsRecord, isRecordedLogsRun } from "./logs";
import { buildTracesRecord } from "./traces";
import { buildRecents, groupByDay } from "./recentSearches";

const recorded = vi.hoisted(() => [] as unknown[]);

vi.mock("@/services/http", () => ({ default: vi.fn() }));
vi.mock("@/composables/queryHistory/useRecentSearches", () => ({
  useRecentSearches: () => ({ record: (body: unknown) => body && recorded.push(body) }),
}));

const DAY_MS = 86_400_000;
const MONDAY_MS = new Date(2026, 9, 26, 10, 0, 0).getTime();

const signature = (overrides: Partial<LogsSignature> = {}): LogsSignature => ({
  query: "level = 'error'",
  sqlMode: false,
  streams: ["k8s_logs"],
  streamType: "logs",
  time: { type: "relative", period: "15m" },
  transform: null,
  quickMode: true,
  quickModeFields: [],
  regions: [],
  clusters: [],
  effectiveSortOrder: "desc",
  definedSchemas: "user_defined_schema",
  ...overrides,
});

const logsKey = (overrides: Partial<LogsSignature> = {}, atMs = MONDAY_MS) =>
  buildLogsRecord({
    signature: signature(overrides),
    startUs: (atMs - 15 * 60_000) * 1000,
    endUs: atMs * 1000,
    columns: [],
    result: { status: "ok" },
  })?.query_key;

const entry = (overrides: Partial<QueryHistoryEntry> = {}): QueryHistoryEntry => ({
  id: "e",
  source: "logs",
  query: "level = 'error'",
  query_key: "k",
  streams: ["k8s_logs"],
  context: {},
  status: "ok",
  starred: false,
  run_count: 1,
  created_at: MONDAY_MS * 1000,
  updated_at: MONDAY_MS * 1000,
  ...overrides,
});

describe("query_key: streams, stream type, mode, query and VRL, never a date", () => {
  afterEach(() => vi.useRealTimers());

  it("gives a Logs search the same key on two different days and at any clock time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(MONDAY_MS);
    const monday = logsKey({}, MONDAY_MS);
    vi.setSystemTime(MONDAY_MS + 40 * DAY_MS);
    const later = logsKey({}, MONDAY_MS + 40 * DAY_MS);
    expect(monday).toBe('[["k8s_logs"],"logs","filter","level = \'error\'",""]');
    expect(later).toBe(monday);
  });

  it("splits Logs searches that differ only in VRL or mode", () => {
    expect(logsKey({ transform: ".x = 1" })).toBe(
      '[["k8s_logs"],"logs","filter","level = \'error\'",".x = 1"]',
    );
    expect(logsKey({ sqlMode: true })).toBe('[["k8s_logs"],"logs","sql","level = \'error\'",""]');
    expect(
      new Set([logsKey(), logsKey({ transform: ".x = 1" }), logsKey({ sqlMode: true })]).size,
    ).toBe(3);
  });

  it("gives a Traces search the same key whatever window it ran over", () => {
    const key = (start: number) =>
      buildTracesRecord({
        stream: "default",
        searchMode: "traces",
        query: "duration > 10",
        time: { type: "absolute", start_time: start, end_time: start + 1 },
        result: { status: "ok" },
      })?.query_key;
    expect(key(1)).toBe('[["default"],"traces","traces","duration > 10",""]');
    expect(key(40 * DAY_MS * 1000)).toBe(key(1));
  });
});

describe("no client dedupe: each server row is one search", () => {
  it("shows two searches with the same text but different VRL as two rows", () => {
    const view = buildRecents([
      entry({ id: "plain", query_key: "plain-key" }),
      entry({
        id: "vrl",
        query_key: "vrl-key",
        updated_at: MONDAY_MS * 1000 - 1,
      }),
    ]);
    expect(view.rows.map((r) => r.entry.id)).toEqual(["plain", "vrl"]);
  });

  it("shows a search merged on the server across two days once, under the day it last ran", () => {
    const merged = entry({
      id: "merged",
      run_count: 2,
      created_at: (MONDAY_MS - 3 * DAY_MS) * 1000,
      updated_at: MONDAY_MS * 1000,
    });
    expect(buildRecents([merged]).rows.map((r) => r.entry.id)).toEqual(["merged"]);
    const groups = groupByDay([merged], MONDAY_MS);
    expect(groups.map((g) => [g.daysAgo, g.entries.map((e) => e.id)])).toEqual([[0, ["merged"]]]);
  });

  it("takes each row's starred flag as the truth, never a sibling's", () => {
    const view = buildRecents([
      entry({ id: "unstarred", query_key: "a", starred: false }),
      entry({ id: "starred", query_key: "b", starred: true, updated_at: MONDAY_MS * 1000 - 1 }),
    ]);
    expect(view.rows.map((r) => [r.entry.id, r.starred])).toEqual([
      ["unstarred", false],
      ["starred", true],
    ]);
  });
});

describe("recording: once per user-initiated run", () => {
  it("never records a Logs pagination, histogram or refresh run, however they coalesce", () => {
    expect(isRecordedLogsRun(["pagination", "histogram", "refresh", "page-size", "sort"])).toBe(
      false,
    );
  });

  describe("the Metrics recorder", () => {
    const panel = {
      data: { queryType: "promql", queries: [{ query: "up", fields: { stream: "up" } }] },
      layout: { hiddenQueries: [] as number[] },
    };
    const selectedDate = { valueType: "relative" as const, relativeTimePeriod: "15m" };
    const loading = ref(false);
    const cycle = async () => {
      loading.value = true;
      await nextTick();
      loading.value = false;
      await nextTick();
      await nextTick();
    };

    let scope: EffectScope;
    const recorder = () => scope.run(() => useQueryHistoryRecorder(() => loading.value))!;

    beforeEach(() => {
      recorded.length = 0;
      loading.value = false;
      scope = effectScope();
    });

    afterEach(() => scope.stop());

    it("records a Run once, and nothing for the refreshes that follow it", async () => {
      const metrics = recorder();
      metrics.record(panel, selectedDate);
      await cycle();
      expect(recorded).toHaveLength(1);
      expect((recorded[0] as QueryHistoryRecordBody).query_key).toBe(
        '[["up"],"metrics","promql","up",""]',
      );
      await cycle();
      await cycle();
      expect(recorded).toHaveLength(1);
    });

    it("records nothing for a refresh no user asked for, or a cancelled Run", async () => {
      const metrics = recorder();
      await cycle();
      metrics.record(panel, selectedDate);
      metrics.cancel();
      await cycle();
      expect(recorded).toHaveLength(0);
    });
  });
});

describe("the clear dialog's count", () => {
  const api = {
    get: vi.fn(),
  };

  beforeEach(() => {
    api.get.mockReset().mockResolvedValue({ data: { count: 7 } });
    vi.mocked(http).mockReturnValue(api as unknown as ReturnType<typeof http>);
  });

  it("asks the server for count_only with the scope and fetches no rows", async () => {
    const options = queryHistoryCountQuery("o1", "logs", false);
    const queryFn = options.queryFn as unknown as () => Promise<number>;
    await expect(queryFn()).resolves.toBe(7);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith("/api/o1/query_history", {
      params: { source: "logs", starred: false, count_only: true },
    });
    expect(options.queryKey).toEqual(
      queryHistoryKeys.list("o1", { source: "logs", starred: false, count_only: true }),
    );
  });

  it("counts starred rows the same way, and reads a missing count as 0", async () => {
    api.get.mockResolvedValue({ data: {} });
    const queryFn = queryHistoryCountQuery("o1", "logs,traces", true)
      .queryFn as unknown as () => Promise<number>;
    await expect(queryFn()).resolves.toBe(0);
    expect(api.get).toHaveBeenCalledWith("/api/o1/query_history", {
      params: { source: "logs,traces", starred: true, count_only: true },
    });
  });
});
