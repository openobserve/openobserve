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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import IndexList from "@/plugins/logs/IndexList.vue";
import { searchState } from "@/composables/useLogs/searchState";
import { useStreamFields } from "@/composables/useLogs/useStreamFields";
import { defineComponent } from "vue";
import FeatureLockBoundary from "@/components/common/FeatureLockBoundary.vue";

const getStreamsMock = vi.hoisted(() => vi.fn());
const onStreamChangeMock = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useStreams", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: (...args: any[]) => ({ ...actual.default(...args), getStreams: getStreamsMock }),
  };
});

vi.mock("@/composables/useLogs/useSearchBar", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useSearchBar: () => ({ onStreamChange: onStreamChangeMock, handleQueryData: vi.fn() }),
  };
});

const listOf = (names: string[]) => ({
  list: names.map((name, i) => ({ name, stats: { doc_time_max: i + 1 } })),
});

const deferred = () => {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("IndexList stream type switch with out-of-order list responses (F3)", () => {
  const { searchObj } = searchState();
  const zoConfig = { ...store.state.zoConfig };
  let wrapper: any;

  beforeEach(async () => {
    localStorage.clear();
    store.state.zoConfig = {
      ...zoConfig,
      auto_query_enabled: true,
      query_on_stream_selection: true,
      auto_query_max_scan_mb: 1024,
    };
    searchObj.data.stream.streamType = "traces";
    searchObj.data.stream.selectedStream = [];
    searchObj.data.streamResults = listOf([]) as any;
    wrapper = mount(IndexList, {
      global: { provide: { store }, plugins: [i18n, router] },
    });
    await flushPromises();
    onStreamChangeMock.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    store.state.zoConfig = zoConfig;
    vi.clearAllMocks();
  });

  it("drops a delayed Logs list that arrives after the switch to Metrics", async () => {
    const logs = deferred();
    getStreamsMock.mockImplementation((type: string) =>
      type === "logs" ? logs.promise : Promise.resolve(listOf(["metric_A"])),
    );

    const first = wrapper.vm.onStreamTypeChange("logs");
    const second = wrapper.vm.onStreamTypeChange("metrics");
    await second;
    expect(searchObj.data.stream.selectedStream).toEqual(["metric_A"]);

    logs.resolve(listOf(["log_A"]));
    await first;
    await flushPromises();

    expect(searchObj.data.stream.streamType).toBe("metrics");
    expect(searchObj.data.stream.selectedStream).toEqual(["metric_A"]);
    expect(searchObj.data.streamResults.list.map((s: any) => s.name)).toEqual(["metric_A"]);
    expect(searchObj.data.stream.streamLists.map((s: any) => s.value)).toEqual(["metric_A"]);
    expect(onStreamChangeMock).toHaveBeenCalledTimes(1);
  });

  it("stops before selecting when the selection moves on during the post-write tick", async () => {
    getStreamsMock.mockResolvedValue(listOf(["log_A"]));
    const Loader = defineComponent({
      setup: () => ({ getStreamList: useStreamFields().getStreamList }),
      template: "<div />",
    });
    const loader: any = mount(Loader, { global: { plugins: [store, i18n, router] } });
    searchObj.data.stream.streamType = "logs";
    searchObj.data.stream.selectedStream = ["kept"];
    const answers = [true, false];
    await loader.vm.getStreamList(true, { isCurrent: () => answers.shift() ?? false });
    expect(searchObj.data.streamResults.list.map((s: any) => s.name)).toEqual(["log_A"]);
    expect(searchObj.data.stream.selectedStream).toEqual(["kept"]);
    loader.unmount();
  });

  it("still selects and runs the list of the latest switch", async () => {
    getStreamsMock.mockResolvedValue(listOf(["log_A", "log_B"]));
    await wrapper.vm.onStreamTypeChange("logs");
    expect(searchObj.data.stream.selectedStream).toEqual(["log_B"]);
    expect(onStreamChangeMock).toHaveBeenCalledTimes(1);
    expect(onStreamChangeMock).toHaveBeenCalledWith("", { origin: "selector" });
  });

  it("leaves the URL to the search on an unlocked page", async () => {
    getStreamsMock.mockResolvedValue(listOf(["log_A"]));
    await router.replace({ query: { stream_type: "traces", stream: "trace_A" } });
    await wrapper.vm.onStreamTypeChange("logs");
    await flushPromises();
    expect(router.currentRoute.value.query.stream_type).toBe("traces");
    expect(router.currentRoute.value.query.stream).toBe("trace_A");
  });
});

describe("IndexList switch-to-logs on a license-locked page", () => {
  const { searchObj } = searchState();
  const BACK_TO_LOGS = '[data-test="log-search-index-list-back-to-logs-btn"]';

  const mountUnderLock = (feature: string | null) =>
    mount(
      defineComponent({
        components: { IndexList, FeatureLockBoundary },
        setup: () => ({ feature }),
        template: '<FeatureLockBoundary :feature="feature"><IndexList /></FeatureLockBoundary>',
      }),
      { global: { provide: { store }, plugins: [i18n, router] } },
    );

  beforeEach(() => {
    getStreamsMock.mockResolvedValue(listOf([]));
    searchObj.data.stream.streamType = "metrics";
    searchObj.data.stream.selectedStream = [];
  });

  it.each([
    ["locked", "metrics"],
    ["unlocked", null],
  ])("switches to logs while the page is %s", async (_state, feature) => {
    await router.replace({ query: { stream_type: "metrics", stream: "metric_A" } });
    const wrapper = mountUnderLock(feature);
    await flushPromises();
    getStreamsMock.mockClear();
    await wrapper.find(BACK_TO_LOGS).trigger("click");
    await flushPromises();
    expect(searchObj.data.stream.streamType).toBe("logs");
    expect(getStreamsMock).toHaveBeenCalled();
    expect(router.currentRoute.value.query.stream_type).toBe(feature ? "logs" : "metrics");
    wrapper.unmount();
  });
});
