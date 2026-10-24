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
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, reactive } from "vue";
import { queryClient } from "@/composables/query/queryClient";
import searchService from "@/services/search";
import { useThresholdSuggestion, type ThresholdRule } from "./useThresholdSuggestion";

const { getStream, store } = vi.hoisted(() => ({
  getStream: vi.fn(),
  store: {
    state: {
      selectedOrganization: { identifier: "acme" },
      zoConfig: { max_query_range: 0, sql_base64_enabled: false },
    },
  },
}));

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStream }) }));
vi.mock("vuex", async () => {
  const actual = await vi.importActual<typeof import("vuex")>("vuex");
  return { ...actual, useStore: () => store };
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const STEP = 10 * MIN;

/** A week of 10-minute counts: 1..10 on the older days, four spikes of 40 yesterday. */
const weekHits = () =>
  Array.from({ length: (7 * DAY) / STEP }, (_, i) => {
    const time = NOW - 7 * DAY + i * STEP;
    const yesterday = time >= NOW - DAY;
    const value = yesterday && i % 36 === 0 ? 40 : (i % 10) + 1;
    return { zo_sql_key: new Date(time).toISOString().slice(0, 19), zo_sql_num: value };
  });

const baseRule = (): ThresholdRule => ({
  enabled: true,
  streamName: "app",
  streamType: "logs",
  query: `SELECT * FROM "app" WHERE level = 'error'`,
  kind: "count",
  operator: ">=",
  threshold: 3,
  periodMinutes: 10,
  silenceMinutes: 10,
});

const mountRule = (over: Partial<ThresholdRule> = {}) => {
  const rule = reactive({ ...baseRule(), ...over });
  const Host = defineComponent({
    setup: () => useThresholdSuggestion(() => rule),
    template: "<div />",
  });
  const wrapper = mount(Host);
  return { rule, vm: wrapper.vm as any };
};

describe("useThresholdSuggestion", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    queryClient.clear();
    store.state.zoConfig.max_query_range = 0;
    getStream.mockReset().mockResolvedValue({
      settings: { max_query_range: 0 },
      stats: { doc_time_min: (NOW - 30 * DAY) * 1000 },
    });
    vi.mocked(searchService.search)
      .mockReset()
      .mockResolvedValue({ data: { hits: weekHits() } } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for one bucketed week of the rule and suggests from it", async () => {
    const { vm } = mountRule();
    await flushPromises();

    expect(searchService.search).toHaveBeenCalledTimes(1);
    const [args] = vi.mocked(searchService.search).mock.calls[0] as any[];
    expect(args.org_identifier).toBe("acme");
    expect(args.page_type).toBe("logs");
    expect(args.query.query.sql).toContain("histogram(_timestamp, '10 minute')");
    expect(args.query.query.sql).toMatch(/LIMIT \d+$/);
    expect(args.query.query.end_time - args.query.query.start_time).toBe(7 * DAY * 1000);
    expect(vm.suggested).toBe(23);
    expect(vm.usualHigh).toBe(9);
    expect(vm.truncatedDays).toBeNull();
    expect(vm.history).toBe("ok");
  });

  it("re-scores a threshold edit without a new query", async () => {
    const { vm, rule } = mountRule();
    await flushPromises();
    expect(vm.backtest.episodes).toBeGreaterThan(4);

    rule.threshold = 23;
    await flushPromises();
    expect(vm.backtest.episodes).toBe(4);
    expect(vm.backtest.at).toHaveLength(4);
    expect(searchService.search).toHaveBeenCalledTimes(1);
  });

  it("queries again when the filter or the period changes", async () => {
    const { rule } = mountRule();
    await flushPromises();

    rule.query = `SELECT * FROM "app" WHERE level = 'warn'`;
    await flushPromises();
    rule.periodMinutes = 5;
    await flushPromises();
    expect(searchService.search).toHaveBeenCalledTimes(3);
  });

  it("stays inert when disabled, as in edit mode", async () => {
    const { vm } = mountRule({ enabled: false });
    await flushPromises();

    expect(searchService.search).not.toHaveBeenCalled();
    expect(getStream).not.toHaveBeenCalled();
    expect(vm.suggested).toBeNull();
    expect(vm.backtest).toBeNull();
    expect(vm.loading).toBe(false);
  });

  it("caps the window at the stream's max query range and says how many days it used", async () => {
    getStream.mockResolvedValue({
      settings: { max_query_range: 72 },
      stats: { doc_time_min: (NOW - 30 * DAY) * 1000 },
    });
    const { vm } = mountRule();
    await flushPromises();

    const [args] = vi.mocked(searchService.search).mock.calls[0] as any[];
    expect(args.query.query.end_time - args.query.query.start_time).toBe(3 * DAY * 1000);
    expect(vm.truncatedDays).toBe(3);
  });

  it("falls back to the org's max query range", async () => {
    store.state.zoConfig.max_query_range = 48;
    const { vm } = mountRule();
    await flushPromises();
    expect(vm.truncatedDays).toBe(2);
  });

  it("fits a young stream on what it has and skips the back-test", async () => {
    getStream.mockResolvedValue({
      settings: {},
      stats: { doc_time_min: (NOW - 30 * 60 * MIN) * 1000 },
    });
    const { vm } = mountRule();
    await flushPromises();
    expect(vm.history).toBe("short");
    expect(vm.suggested).not.toBeNull();
    expect(vm.backtest).toBeNull();
  });

  it("suggests nothing for a stream under an hour old", async () => {
    getStream.mockResolvedValue({
      settings: {},
      stats: { doc_time_min: (NOW - 30 * MIN) * 1000 },
    });
    const { vm } = mountRule();
    await flushPromises();
    expect(vm.history).toBe("none");
    expect(vm.suggested).toBeNull();
  });

  it("surfaces a failed query as an error and suggests nothing", async () => {
    vi.mocked(searchService.search).mockRejectedValue(new Error("boom"));
    const { vm } = mountRule();
    await flushPromises();
    expect(vm.error).toBe(true);
    expect(vm.suggested).toBeNull();
    expect(vm.loading).toBe(false);
  });
});
