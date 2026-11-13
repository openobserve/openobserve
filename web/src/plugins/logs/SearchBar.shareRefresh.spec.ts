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
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import SearchBar from "@/plugins/logs/SearchBar.vue";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const START_US = Date.UTC(2026, 10, 11, 12, 27) * 1000;
const END_US = Date.UTC(2026, 10, 11, 12, 42) * 1000;

describe("SearchBar share kinds and auto-refresh pause", () => {
  let wrapper: VueWrapper<any> | undefined;

  const setRange = (type: "relative" | "absolute") => {
    wrapper!.vm.searchObj.data.datetime = {
      ...wrapper!.vm.searchObj.data.datetime,
      type,
      startTime: START_US,
      endTime: END_US,
      relativeTimePeriod: "15m",
    };
  };

  beforeEach(() => {
    wrapper = mount(SearchBar, {
      props: { retentionDays: 7 },
      global: {
        provide: { store },
        plugins: [i18n, router],
        stubs: { QueryEditor: true, DateTime: true },
      },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
  });

  it("offers a rolling link next to the fixed one for a relative range", () => {
    setRange("relative");
    const rolling = new URL(wrapper!.vm.shareRollingURL);
    expect(rolling.searchParams.get("period")).toBe("15m");
    expect(rolling.searchParams.has("from")).toBe(false);
    const fixed = new URL(wrapper!.vm.shareURL);
    expect(fixed.searchParams.get("from")).toBe(String(START_US));
    expect(wrapper!.vm.shareRollingLabel).toBe("Last 15 minutes");
    expect(wrapper!.vm.shareFixedLabel).not.toBe("");
  });

  it("offers only the fixed link for an absolute range, even with a stale period", () => {
    setRange("absolute");
    expect(wrapper!.vm.shareRollingURL).toBe("");
    expect(wrapper!.vm.shareRollingLabel).toBe("");
  });

  it("gives auto-refresh the end of a fixed range and nothing for a rolling one", () => {
    setRange("absolute");
    expect(wrapper!.vm.refreshRangeEndUs).toBe(END_US);
    setRange("relative");
    expect(wrapper!.vm.refreshRangeEndUs).toBeNull();
  });

  it("turns the range live through the picker when auto-refresh asks", () => {
    const goLive = vi.fn();
    wrapper!.vm.dateTimeRef = { goLive };
    wrapper!.vm.goLiveRange();
    expect(goLive).toHaveBeenCalledOnce();
  });

  it("names the page and streams for the copied range line", () => {
    wrapper!.vm.searchObj.data.stream.selectedStream = ["default", "k8s"];
    expect(wrapper!.vm.shareRangeContext).toBe("Logs · default, k8s");
    setRange("absolute");
    expect(wrapper!.vm.shareFixedCopyLabel).toMatch(/12:27 – 12:42 UTC$/);
  });

  it.each([true, false])(
    "asks the page to redraw rows in the new zone (query_on_stream_selection %s)",
    async (queryOnSelection) => {
      const before = store.state.zoConfig.query_on_stream_selection;
      store.state.zoConfig.query_on_stream_selection = queryOnSelection;
      const picker = wrapper!.findComponent({ name: "DateTime" });
      picker.vm.$emit("on:timezone-change", "Asia/Tokyo");
      await wrapper!.vm.$nextTick();
      store.state.zoConfig.query_on_stream_selection = before;
      expect(wrapper!.emitted("onChangeTimezone")).toHaveLength(1);
    },
  );

  it("hands the picker the window a SQL timestamp filter keeps", () => {
    setRange("absolute");
    wrapper!.vm.searchObj.meta.sqlMode = false;
    wrapper!.vm.searchObj.data.query = `SELECT * FROM "default" WHERE _timestamp >= ${START_US + 60_000_000}`;
    expect(wrapper!.vm.narrowedByQuery).toBeNull();
    wrapper!.vm.searchObj.meta.sqlMode = true;
    expect(wrapper!.vm.narrowedByQuery).toEqual({ startUs: START_US + 60_000_000, endUs: END_US });
  });
});
