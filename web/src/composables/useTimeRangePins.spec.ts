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

import { beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import useTimeRangeHistory, {
  TIME_RANGE_HISTORY_LIMIT,
  timeRangeHistoryKey,
} from "./useTimeRangeHistory";
import useTimeRangePins, { readTimeRangePins, timeRangePinsKey } from "./useTimeRangePins";

const KEY = timeRangePinsKey("default", "example@gmail.com");

const setup = () => {
  let pins!: ReturnType<typeof useTimeRangePins>;
  let history!: ReturnType<typeof useTimeRangeHistory>;
  const Host = defineComponent({
    setup() {
      pins = useTimeRangePins();
      history = useTimeRangeHistory();
      return () => h("div");
    },
  });
  mount(Host, { global: { plugins: [store] } });
  return { pins, history };
};

describe("useTimeRangePins", () => {
  beforeEach(() => localStorage.clear());

  it("stores pins per org and user under their own key, newest first", () => {
    const { pins } = setup();
    pins.pin({ relative: "6h" });
    pins.pin({ startUs: 1_000_000, endUs: 2_000_000 });
    expect(KEY).toBe("o2.timeRangePins.default.example@gmail.com");
    expect(readTimeRangePins(KEY).map((pin) => pin.range)).toEqual([
      { startUs: 1_000_000, endUs: 2_000_000 },
      { relative: "6h" },
    ]);
  });

  it("re-reads pins and Recent when another tab writes them", () => {
    const { pins, history } = setup();
    expect(pins.pins.value).toEqual([]);
    expect(history.entries.value).toEqual([]);
    const historyKey = timeRangeHistoryKey("default", "example@gmail.com");
    const otherTab = (key: string, value: unknown) => {
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    };

    otherTab(KEY, [{ id: "a", name: "", range: { relative: "6h" } }]);
    otherTab(historyKey, [{ relative: "2d" }]);

    expect(pins.pins.value.map((pin) => pin.range)).toEqual([{ relative: "6h" }]);
    expect(history.entries.value).toEqual([{ relative: "2d" }]);
  });

  it("returns the existing pin rather than pinning a range twice", () => {
    const { pins } = setup();
    const first = pins.pin({ relative: "6h" });
    expect(pins.pin({ relative: "6h" })).toBe(first);
    expect(pins.pins.value).toHaveLength(1);
  });

  it("names a pin, trims the name and falls back to empty", () => {
    const { pins } = setup();
    const id = pins.pin({ relative: "6h" })!;
    pins.rename(id, "  Checkout outage  ");
    expect(pins.pins.value[0].name).toBe("Checkout outage");
    pins.rename(id, "   ");
    expect(pins.pins.value[0].name).toBe("");
  });

  it("unpins by id", () => {
    const { pins } = setup();
    const id = pins.pin({ relative: "6h" })!;
    pins.unpin(id);
    expect(pins.pins.value).toEqual([]);
  });

  it("is never evicted by Recent's limit", () => {
    const { pins, history } = setup();
    pins.pin({ relative: "6h" });
    for (let i = 0; i < TIME_RANGE_HISTORY_LIMIT + 5; i++) history.add(i * 1e6, (i + 60) * 1e6);
    expect(history.entries.value).toHaveLength(TIME_RANGE_HISTORY_LIMIT);
    expect(pins.pins.value.map((pin) => pin.range)).toEqual([{ relative: "6h" }]);
  });

  it("drops stored pins that are malformed", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ id: "a", name: "ok", range: { relative: "1h" } }, { id: "", name: 1 }, 5]),
    );
    expect(readTimeRangePins(KEY)).toEqual([{ id: "a", name: "ok", range: { relative: "1h" } }]);
  });
});
