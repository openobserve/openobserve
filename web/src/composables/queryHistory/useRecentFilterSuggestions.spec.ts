// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref, type Ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { QueryHistoryEntry } from "@/services/query_history";

const api = vi.hoisted(() => ({ list: vi.fn(), count: vi.fn(), record: vi.fn() }));
vi.mock("@/services/query_history", () => ({ default: api }));

import { queryClient } from "@/composables/query/queryClient";
import { useRecentFilterSuggestions } from "./useRecentFilterSuggestions";

enableAutoUnmount(afterEach);

const NOW_US = Date.now() * 1000;

const entry = (id: string, age: number, extra: Partial<QueryHistoryEntry> = {}) =>
  ({
    id,
    source: "logs",
    query: `level = '${id}'`,
    status: "ok",
    starred: false,
    context: {},
    updated_at: NOW_US - age * 60_000_000,
    created_at: NOW_US - age * 60_000_000,
    run_count: 1,
    ...extra,
  }) as QueryHistoryEntry;

const serve = (entries: QueryHistoryEntry[], failedCount = 0) => {
  api.list.mockImplementation(async (_org: string, params: { status?: string; limit: number }) => ({
    data: (params.status ? entries.filter((e) => e.status === params.status) : entries).slice(
      0,
      params.limit,
    ),
  }));
  api.count.mockResolvedValue({ data: { count: failedCount } });
};

const setup = (examples: Ref<string[]> = ref([])) => {
  const handlers = {
    run: vi.fn(),
    load: vi.fn(),
    viewAll: vi.fn(),
    example: vi.fn(),
  };
  let api_: ReturnType<typeof useRecentFilterSuggestions>;
  const Host = defineComponent({
    setup() {
      api_ = useRecentFilterSuggestions("logs", { active: ref(true), examples, ...handlers });
      return () => h("div");
    },
  });
  mount(Host, { global: { plugins: [i18n, store] } });
  return { handlers, recent: api_! };
};

const keys = (recent: ReturnType<typeof useRecentFilterSuggestions>) =>
  recent.section.value?.rows.map((row) => row.key);
const click = (shiftKey = false) => new MouseEvent("click", { shiftKey });

beforeEach(() => {
  store.state.zoConfig.query_history_enabled = true;
  queryClient.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  delete store.state.zoConfig.query_history_enabled;
});

describe("useRecentFilterSuggestions", () => {
  it("lists main's rows, newest first and capped at eight, then View all", async () => {
    serve(Array.from({ length: 9 }, (_, i) => entry(`e${i}`, i + 1)));
    const { recent } = setup();
    await flushPromises();
    expect(recent.section.value?.title).toBe("Recent searches");
    expect(keys(recent)).toEqual([
      ...Array.from({ length: 8 }, (_, i) => `recent-e${i}`),
      "recent-view-all",
    ]);
    expect(recent.section.value?.rows[0].label).toBe("level = 'e0'");
  });

  it("runs a row, and only loads it with Shift", async () => {
    serve([entry("a", 1)]);
    const { recent, handlers } = setup();
    await flushPromises();
    recent.pick("recent-a", click());
    expect(handlers.run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "a" }),
      "now",
    );
    recent.pick("recent-a", click(true));
    expect(handlers.load).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "a" }),
      "now",
    );
  });

  it("pins the newest failure on top, and it only ever loads", async () => {
    serve([entry("bad", 1, { status: "error" }), entry("a", 2)], 3);
    const { recent, handlers } = setup();
    await flushPromises();
    expect(keys(recent)).toEqual([
      "recent-bad",
      "recent-a",
      "recent-view-all",
      "recent-view-failed",
    ]);
    expect(recent.section.value?.rows[0].detail).toBe("Failed");
    recent.pick("recent-bad", click());
    expect(handlers.load).toHaveBeenCalledOnce();
    expect(handlers.run).not.toHaveBeenCalled();
  });

  it("opens the drawer from View all and from the failed count", async () => {
    serve([entry("bad", 1, { status: "error" }), entry("a", 2)], 3);
    const { recent, handlers } = setup();
    await flushPromises();
    recent.pick("recent-view-all", click());
    recent.pick("recent-view-failed", click());
    expect(handlers.viewAll.mock.calls).toEqual([[null], ["error"]]);
  });

  it("offers the examples while there is no history", async () => {
    serve([]);
    const { recent, handlers } = setup(ref(["match_all('error')"]));
    await flushPromises();
    expect(keys(recent)).toEqual(["recent-example-0"]);
    recent.pick("recent-example-0", click());
    expect(handlers.example).toHaveBeenCalledExactlyOnceWith("match_all('error')");
  });

  it("adds no section with no history and no examples", async () => {
    serve([]);
    const { recent } = setup();
    await flushPromises();
    expect(recent.section.value).toBeUndefined();
  });

  it("stays off when the server disables history", async () => {
    delete store.state.zoConfig.query_history_enabled;
    serve([entry("a", 1)]);
    const { recent } = setup();
    await flushPromises();
    expect(recent.section.value).toBeUndefined();
    expect(api.list).not.toHaveBeenCalled();
  });
});
