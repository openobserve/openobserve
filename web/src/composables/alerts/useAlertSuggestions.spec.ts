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
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import searchService from "@/services/search";
import { clearCachedBacktests, SUGGESTION_BACKTEST_TTL_MS } from "@/utils/alerts/startSuggestions";
import { useAlertSuggestions, useSuggestionBacktest } from "./useAlertSuggestions";

const { getStreams, getStream, store } = vi.hoisted(() => ({
  getStreams: vi.fn(),
  getStream: vi.fn(),
  store: {
    state: {
      selectedOrganization: { identifier: "acme" },
      zoConfig: { anomaly_detection_enabled: false as unknown, sql_base64_enabled: false },
    },
  },
}));

vi.mock("@/services/search", () => ({ default: { search: vi.fn() } }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({ getStreams, getStream }) }));
vi.mock("vuex", async () => {
  const actual = await vi.importActual<typeof import("vuex")>("vuex");
  return { ...actual, useStore: () => store };
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

const listed: Record<string, any[]> = {
  logs: [{ name: "app", stream_type: "logs", stats: { doc_num: 900, doc_time_max: NOW * 1000 } }],
  traces: [],
  metrics: [],
};

const setup = (initialStream?: { name: string; type: string }) => {
  let api: any;
  const Host = defineComponent({
    setup: () => {
      api = { ...useAlertSuggestions(() => initialStream), ...useSuggestionBacktest() };
      return {};
    },
    template: "<div />",
  });
  mount(Host);
  return api;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearCachedBacktests();
  store.state.zoConfig.anomaly_detection_enabled = false;
  getStreams
    .mockReset()
    .mockImplementation((type: string) => Promise.resolve({ list: listed[type] ?? [] }));
  getStream
    .mockReset()
    .mockImplementation((_name: string, _type: string, schema: boolean) =>
      Promise.resolve(
        schema
          ? { schema: [{ name: "level", type: "Utf8" }] }
          : { stats: { doc_time_min: (NOW - 30 * DAY) * 1000 } },
      ),
    );
  vi.mocked(searchService.search)
    .mockReset()
    .mockResolvedValue({ data: { hits: [] } } as any);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAlertSuggestions", () => {
  it("hides Something unusual unless anomaly detection is on", async () => {
    const off = setup();
    await off.load();
    expect(off.choices.value.map((c: any) => c.intent.id)).not.toContain("something_unusual");

    store.state.zoConfig.anomaly_detection_enabled = true;
    const on = setup();
    await on.load();
    expect(on.choices.value.map((c: any) => c.intent.id)).toContain("something_unusual");
  });

  it("treats a non-boolean anomaly flag as off", async () => {
    store.state.zoConfig.anomaly_detection_enabled = "true";
    const api = setup();
    await api.load();
    expect(api.choices.value.map((c: any) => c.intent.id)).not.toContain("something_unusual");
  });

  it("reports no data when the org has no user streams", async () => {
    getStreams.mockResolvedValue({ list: [] });
    const api = setup();
    expect(api.hasData.value).toBeNull();
    await api.load();
    expect(api.hasData.value).toBe(false);
    expect(api.suggestions.value).toEqual([]);
  });

  it("leaves data unknown when a stream type fails to load and the rest are empty", async () => {
    getStreams.mockImplementation((type: string) =>
      type === "traces" ? Promise.reject(new Error("forbidden")) : Promise.resolve({ list: [] }),
    );
    const api = setup();
    await api.load();
    expect(api.hasData.value).toBeNull();
  });

  it("still reports data when a failed type sits beside one with streams", async () => {
    getStreams.mockImplementation((type: string) =>
      type === "traces"
        ? Promise.reject(new Error("forbidden"))
        : Promise.resolve({ list: listed[type] ?? [] }),
    );
    const api = setup();
    await api.load();
    expect(api.hasData.value).toBe(true);
    expect(api.suggestions.value.length).toBeGreaterThan(0);
  });

  it("ranks only the pinned stream when one is given", async () => {
    getStreams.mockImplementation((type: string) =>
      Promise.resolve({
        list:
          type === "logs"
            ? [
                ...listed.logs,
                {
                  name: "other",
                  stream_type: "logs",
                  stats: { doc_num: 5000, doc_time_max: NOW * 1000 },
                },
              ]
            : [],
      }),
    );
    const api = setup({ name: "app", type: "logs" });
    await api.load();
    const streams = api.choices.value.map((c: any) => c.stream?.name).filter(Boolean);
    expect(new Set(streams)).toEqual(new Set(["app"]));
  });
});

describe("useSuggestionBacktest", () => {
  it("runs a card's back-test once an hour per org", async () => {
    const api = setup();
    await api.load();
    const [suggestion] = api.suggestions.value;
    expect(suggestion.intent.id).toBe("errors_increase");

    await api.run(suggestion);
    await api.run(suggestion);
    expect(searchService.search).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + SUGGESTION_BACKTEST_TTL_MS + 1);
    await api.run(suggestion);
    expect(searchService.search).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed back-test", async () => {
    vi.mocked(searchService.search).mockRejectedValueOnce(new Error("timeout"));
    const api = setup();
    await api.load();
    const [suggestion] = api.suggestions.value;
    await expect(api.run(suggestion)).resolves.toEqual({ state: "failed" });
    await api.run(suggestion);
    expect(searchService.search).toHaveBeenCalledTimes(2);
  });
});
