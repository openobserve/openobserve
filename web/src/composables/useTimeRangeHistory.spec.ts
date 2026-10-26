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
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import useTimeRangeHistory, {
  TIME_RANGE_HISTORY_LIMIT,
  readTimeRangeHistory,
  timeRangeHistoryKey,
} from "./useTimeRangeHistory";

const KEY = timeRangeHistoryKey("default", "example@gmail.com");
const range = (n: number) => ({ startUs: n * 1_000_000, endUs: (n + 60) * 1_000_000 });

const setup = () => {
  let api!: ReturnType<typeof useTimeRangeHistory>;
  const Host = defineComponent({
    setup() {
      api = useTimeRangeHistory();
      return () => h("div");
    },
  });
  const wrapper = mount(Host, { global: { plugins: [store] } });
  return { api, wrapper };
};

describe("useTimeRangeHistory", () => {
  const originalOrg = store.state.selectedOrganization;

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    store.state.selectedOrganization = originalOrg;
    localStorage.clear();
  });

  it("keys the list per org and user", () => {
    expect(KEY).toBe("o2.timeRangeHistory.default.example@gmail.com");
  });

  it("adds newest first, dedupes on start and end, and keeps at most the limit", () => {
    const { api } = setup();
    for (let n = 1; n <= TIME_RANGE_HISTORY_LIMIT + 3; n++)
      api.add(range(n).startUs, range(n).endUs);
    api.add(range(10).startUs, range(10).endUs);

    const list = api.entries.value;
    expect(list).toHaveLength(TIME_RANGE_HISTORY_LIMIT);
    expect(list[0]).toEqual(range(10));
    expect(list[1]).toEqual(range(TIME_RANGE_HISTORY_LIMIT + 3));
    expect(list.filter((e) => e.startUs === range(10).startUs)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(list);
  });

  it("ignores empty or reversed ranges", () => {
    const { api } = setup();
    api.add(5, 5);
    api.add(10, 5);
    api.add(Number.NaN, 5);
    expect(api.entries.value).toEqual([]);
  });

  it("removes one range", () => {
    const { api } = setup();
    api.add(range(1).startUs, range(1).endUs);
    api.add(range(2).startUs, range(2).endUs);
    api.remove(range(1));
    expect(api.entries.value).toEqual([range(2)]);
  });

  it("shares one list between pickers", () => {
    const first = setup().api;
    const second = setup().api;
    first.add(range(1).startUs, range(1).endUs);
    expect(second.entries.value).toEqual([range(1)]);
  });

  it("keeps lists of different orgs apart", () => {
    const { api } = setup();
    api.add(range(1).startUs, range(1).endUs);
    store.state.selectedOrganization = { ...originalOrg, identifier: "other" };
    expect(api.entries.value).toEqual([]);
  });

  it("drops malformed stored data instead of failing", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readTimeRangeHistory(KEY)).toEqual([]);
    localStorage.setItem(KEY, JSON.stringify([range(1), { startUs: "x" }, null, range(2)]));
    expect(readTimeRangeHistory(KEY)).toEqual([range(1), range(2)]);
  });

  it("works for the session when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { api } = setup();

    expect(api.entries.value).toEqual([]);
    api.add(range(1).startUs, range(1).endUs);
    expect(api.entries.value).toEqual([range(1)]);
    api.remove(range(1));
    expect(api.entries.value).toEqual([]);
  });
});
