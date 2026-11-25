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

import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import useTraces from "@/composables/useTraces";

// Each call answers like traces/latest_stream: one chunk of hits, then the end.
const stream = vi.hoisted(() => ({ hits: [] as any[] }));
const fetchQueryDataWithHttpStream = vi.fn((req: any, h: any) => {
  h.data(req, { type: "search_response_hits", content: { results: { hits: stream.hits } } });
  h.complete(req, { type: "end" });
});
const cancelStreamQueryBasedOnRequestId = vi.fn();
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({ fetchQueryDataWithHttpStream, cancelStreamQueryBasedOnRequestId }),
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: vi.fn().mockResolvedValue({ schema: [{ name: "service_name", type: "Utf8" }] }),
  }),
}));
const resolve = vi.fn((to: any) => ({ href: `/web/${to.name}?${new URLSearchParams(to.query)}` }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ resolve, push: vi.fn(), replace: vi.fn(), currentRoute: { value: {} } }),
  useRoute: () => ({ query: {} }),
}));

import DashboardTraceExplorer from "./DashboardTraceExplorer.vue";
import { EXPLORER_FILTER_MODE_KEY } from "@/utils/dashboard/pointExplorers";

const MIN = 60_000_000;
const rawTrace = (id: string, startUs: number) => ({
  trace_id: id,
  start_time: startUs * 1000,
  end_time: (startUs + 1000) * 1000,
  duration: 1000,
  spans: [3, 0],
  service_name: [{ service_name: "cart", count: 3, duration: 1000 }],
  first_event: { service_name: "cart", operation_name: "GET /cart" },
});

const TraceDetailsStub = {
  name: "TraceDetails",
  props: [
    "traceIdProp",
    "streamNameProp",
    "startTimeProp",
    "endTimeProp",
    "spanIdProp",
    "openLinksInNewTab",
    "ownStreamName",
    "ignoreSavedTab",
    "mode",
  ],
  template: "<div data-test='trace-details-stub' />",
};

describe("DashboardTraceExplorer", () => {
  let wrapper: VueWrapper<any>;
  const { searchObj } = useTraces();

  // The explorers' shared chips-or-text key, as the Traces page keeps its own: text unless "builder" is stored.
  const FILTER_KEY = EXPLORER_FILTER_MODE_KEY;
  const openTextFilter = async () => {
    await wrapper.find("[data-test='trace-explorer-query-toggle']").trigger("click");
    if (!wrapper.find("[data-test='trace-explorer-filter-input']").exists()) {
      await wrapper.find("[data-test='trace-explorer-filter-builder-toggle']").trigger("click");
    }
  };

  beforeEach(() => {
    localStorage.removeItem(FILTER_KEY);
    localStorage.removeItem("o2.traces.queryInput");
    stream.hits = [rawTrace("t1", 100 * MIN), rawTrace("t2", 99 * MIN)];
    fetchQueryDataWithHttpStream.mockClear();
    cancelStreamQueryBasedOnRequestId.mockClear();
  });
  afterEach(() => {
    wrapper?.unmount();
    document.body.innerHTML = "";
  });

  const mountExplorer = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DashboardTraceExplorer, {
      props: {
        stream: "otel",
        filters: [{ field: "service_name", value: "cart" }],
        startTime: 100 * MIN,
        endTime: 105 * MIN,
        ...props,
      },
      attachTo: document.body,
      global: {
        plugins: [i18n, store],
        stubs: { TraceDetails: TraceDetailsStub, DateTime: true },
      },
    });
    return wrapper;
  };
  const lastRequest = () => fetchQueryDataWithHttpStream.mock.calls.at(-1)![0];

  it("asks latest_stream for the slice's traces, newest first, a page of 25", async () => {
    mountExplorer();
    await flushPromises();
    expect(lastRequest()).toMatchObject({
      type: "traces",
      queryReq: {
        stream_name: "otel",
        filter: "service_name = 'cart'",
        start_time: 100 * MIN,
        end_time: 105 * MIN,
        from: 0,
        size: 25,
        sort_by: "start_time",
        sort_order: "desc",
      },
    });
    const list = wrapper.findComponent({ name: "TracesSearchResultList" });
    expect(list.props("hits").map((h: any) => h.trace_id)).toEqual(["t1", "t2"]);
  });

  it("gives the list its own columns, so the Traces page columns never change", async () => {
    const before = [...searchObj.data.resultGrid.columns];
    mountExplorer();
    await flushPromises();
    const list = wrapper.findComponent({ name: "TracesSearchResultList" });
    expect(list.props("columns").length).toBeGreaterThan(0);
    list.vm.$emit("add-filter", "duration > 5");
    await flushPromises();
    expect(searchObj.data.resultGrid.columns).toEqual(before);
    expect(searchObj.data.stream.addToFilter).toBe("");
    expect(lastRequest().queryReq.filter).toBe("service_name = 'cart' AND duration > 5");
  });

  it("pages forward with no total while each page comes back full", async () => {
    stream.hits = Array.from({ length: 25 }, (_, i) => rawTrace(`t${i}`, 100 * MIN - i));
    mountExplorer();
    await flushPromises();
    expect(wrapper.find("[data-test='trace-explorer-page-range']").text()).toBe("1–25");
    const next = wrapper.find("[data-test='trace-explorer-next-page']");
    expect(next.attributes("disabled")).toBeUndefined();

    stream.hits = [rawTrace("last", 1)];
    await next.trigger("click");
    await flushPromises();
    expect(lastRequest().queryReq.from).toBe(25);
    expect(cancelStreamQueryBasedOnRequestId).not.toHaveBeenCalled();
    expect(wrapper.find("[data-test='trace-explorer-page-range']").text()).toBe("26–26");
    expect(wrapper.find("[data-test='trace-explorer-next-page']").attributes("disabled")).toBe("");
  });

  it("applies correlation filters, and shows no Applied row", async () => {
    mountExplorer({ filters: [{ field: "service_name", value: "pt-checkout" }] });
    await flushPromises();
    expect(lastRequest().queryReq.filter).toBe("service_name = 'pt-checkout'");
    expect(wrapper.find("[data-test='trace-explorer-applied']").exists()).toBe(false);
  });

  describe("chip filter builder", () => {
    // These tests start from a browser that chose chips here before.
    beforeEach(() => localStorage.setItem(FILTER_KEY, "builder"));
    const openFilter = async () => {
      mountExplorer();
      await flushPromises();
      await wrapper.find("[data-test='trace-explorer-query-toggle']").trigger("click");
      await flushPromises();
    };
    const builder = () => wrapper.findComponent({ name: "SqlFilterBuilder" });
    // Auto run as on the Logs/Traces pages: the server setting AND the user's Auto Run toggle.
    const autoRun = (on: boolean) => {
      const zoConfig = store.state.zoConfig as any;
      const previous = zoConfig.auto_query_enabled;
      zoConfig.auto_query_enabled = on;
      if (on) localStorage.setItem("oo_toggle_auto_run", "true");
      else localStorage.removeItem("oo_toggle_auto_run");
      onTestFinished(() => {
        zoConfig.auto_query_enabled = previous;
        localStorage.removeItem("oo_toggle_auto_run");
      });
    };

    it("shows the chips by default, with the clicked filter as a chip", async () => {
      await openFilter();
      expect(builder().exists()).toBe(true);
      expect(wrapper.find("[data-test='trace-explorer-filter-input']").exists()).toBe(false);
      expect(builder().props("query")).toBe("service_name = 'cart'");
      const bar = wrapper.find("[data-test='trace-explorer-filter-builder']");
      expect(bar.find("[data-test='trace-explorer-filter-builder-unparsable']").exists()).toBe(
        false,
      );
      expect(bar.text()).toContain("service_name");
      expect(bar.text()).toContain("cart");
      expect(builder().props("fields")).toEqual([{ name: "service_name", type: "string" }]);
    });

    it("follows the Traces page's rule: text unless 'builder' is stored; <> saves; a reopen keeps it", async () => {
      localStorage.removeItem(FILTER_KEY);
      await openFilter();
      expect(wrapper.find("[data-test='trace-explorer-filter-input']").exists()).toBe(true);
      expect(builder().exists()).toBe(false);
      await wrapper.find("[data-test='trace-explorer-filter-builder-toggle']").trigger("click");
      expect(builder().exists()).toBe(true);
      expect(localStorage.getItem(FILTER_KEY)).toBe("builder");
      wrapper.unmount();
      await openFilter();
      expect(builder().exists()).toBe(true);
      await wrapper.find("[data-test='trace-explorer-filter-builder-toggle']").trigger("click");
      expect(localStorage.getItem(FILTER_KEY)).toBe("query");
      // The Traces page's own key is never written.
      expect(localStorage.getItem("o2.traces.queryInput")).toBeNull();
    });

    it("with auto-run on, a chip edit reruns the search once, with the new WHERE, after it settles", async () => {
      autoRun(true);
      await openFilter();
      vi.useFakeTimers();
      try {
        const before = fetchQueryDataWithHttpStream.mock.calls.length;
        builder().vm.$emit("update:query", "service_name = 'pay'");
        vi.advanceTimersByTime(299);
        expect(fetchQueryDataWithHttpStream.mock.calls.length).toBe(before);
        vi.advanceTimersByTime(1);
        expect(fetchQueryDataWithHttpStream.mock.calls.length).toBe(before + 1);
        expect(lastRequest().queryReq.filter).toBe("service_name = 'pay'");
      } finally {
        vi.useRealTimers();
      }
    });

    it("with auto-run off, a chip edit only writes the filter; Run searches it", async () => {
      autoRun(false);
      await openFilter();
      vi.useFakeTimers();
      try {
        const before = fetchQueryDataWithHttpStream.mock.calls.length;
        builder().vm.$emit("update:query", "service_name = 'pay'");
        vi.advanceTimersByTime(1000);
        expect(fetchQueryDataWithHttpStream.mock.calls.length).toBe(before);
        await wrapper.find("[data-test='trace-explorer-run']").trigger("click");
        expect(fetchQueryDataWithHttpStream.mock.calls.length).toBe(before + 1);
        expect(lastRequest().queryReq.filter).toBe("service_name = 'pay'");
      } finally {
        vi.useRealTimers();
      }
    });

    it("rapid chip edits make one search, with the last WHERE", async () => {
      autoRun(true);
      await openFilter();
      vi.useFakeTimers();
      try {
        const before = fetchQueryDataWithHttpStream.mock.calls.length;
        builder().vm.$emit("update:query", "service_name = 'a'");
        vi.advanceTimersByTime(200);
        builder().vm.$emit("update:query", "service_name = 'a' AND duration > 5");
        vi.advanceTimersByTime(200);
        builder().vm.$emit("update:query", "duration > 5");
        vi.advanceTimersByTime(300);
        expect(fetchQueryDataWithHttpStream.mock.calls.length).toBe(before + 1);
        expect(lastRequest().queryReq.filter).toBe("duration > 5");
      } finally {
        vi.useRealTimers();
      }
    });

    it("Run or submit searches at once and drops the pending chip rerun", async () => {
      autoRun(true);
      await openFilter();
      vi.useFakeTimers();
      try {
        const before = fetchQueryDataWithHttpStream.mock.calls.length;
        builder().vm.$emit("update:query", "service_name = 'pay'");
        builder().vm.$emit("submit");
        expect(fetchQueryDataWithHttpStream.mock.calls.length).toBe(before + 1);
        vi.advanceTimersByTime(1000);
        expect(fetchQueryDataWithHttpStream.mock.calls.length).toBe(before + 1);
        expect(lastRequest().queryReq.filter).toBe("service_name = 'pay'");
      } finally {
        vi.useRealTimers();
      }
    });

    it("the filter row holds the chips and the <> toggle, in both modes, with no Run of its own", async () => {
      await openFilter();
      const row = wrapper.find("[data-test='trace-explorer-filter-box']");
      expect(row.find("[data-test='trace-explorer-filter-builder-toggle']").exists()).toBe(true);
      expect(row.find("[data-test='trace-explorer-filter-builder']").exists()).toBe(true);
      expect(wrapper.find("[data-test='trace-explorer-filter-run']").exists()).toBe(false);
      await row.find("[data-test='trace-explorer-filter-builder-toggle']").trigger("click");
      const sameRow = wrapper.find("[data-test='trace-explorer-filter-box']");
      expect(sameRow.find("[data-test='trace-explorer-filter-input']").exists()).toBe(true);
      expect(sameRow.find("[data-test='trace-explorer-filter-builder-toggle']").exists()).toBe(
        true,
      );
    });

    it("text mode still searches only on Enter or Run", async () => {
      mountExplorer();
      await flushPromises();
      await openTextFilter();
      vi.useFakeTimers();
      try {
        const before = fetchQueryDataWithHttpStream.mock.calls.length;
        await wrapper
          .find("[data-test='trace-explorer-filter-input'] input")
          .setValue("duration > 5");
        vi.advanceTimersByTime(1000);
        expect(fetchQueryDataWithHttpStream.mock.calls.length).toBe(before);
        await wrapper.find("[data-test='trace-explorer-run']").trigger("click");
        expect(lastRequest().queryReq.filter).toBe("duration > 5");
      } finally {
        vi.useRealTimers();
      }
    });

    it("a filter the chips cannot show is kept, and 'keep as text' switches to text", async () => {
      mountExplorer({ filters: [] });
      await flushPromises();
      await openTextFilter();
      const input = wrapper.find("[data-test='trace-explorer-filter-input'] input");
      await input.setValue("upper(service_name) = 'CART'");
      await wrapper.find("[data-test='trace-explorer-filter-builder-toggle']").trigger("click");
      await flushPromises();
      const banner = "[data-test='trace-explorer-filter-builder-unparsable']";
      expect(wrapper.find(banner).exists()).toBe(true);
      await wrapper.find("[data-test='trace-explorer-filter-builder-keep-query']").trigger("click");
      expect(
        wrapper.find("[data-test='trace-explorer-filter-input'] input").element,
      ).toHaveProperty("value", "upper(service_name) = 'CART'");
    });

    it("Escape inside the chip bar never closes the drawer", async () => {
      const drawerEscape = vi.fn();
      window.addEventListener("keydown", drawerEscape);
      await openFilter();
      const field = wrapper.find("[data-test='trace-explorer-filter-builder'] input")
        .element as HTMLInputElement;
      field.focus();
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flushPromises();
      expect(drawerEscape).not.toHaveBeenCalled();
      window.removeEventListener("keydown", drawerEscape);
    });
  });

  it("the Filter editor runs its WHERE on Enter", async () => {
    mountExplorer();
    await flushPromises();
    await openTextFilter();
    const input = wrapper.find("[data-test='trace-explorer-filter-input'] input");
    await input.setValue("status_code = 'ERROR'");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(lastRequest().queryReq.filter).toBe("status_code = 'ERROR'");
  });

  const runFilter = async (where: string) => {
    if (!wrapper.find("[data-test='trace-explorer-filter-input']").exists()) {
      await openTextFilter();
    }
    const input = wrapper.find("[data-test='trace-explorer-filter-input'] input");
    await input.setValue(where);
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
  };

  it("the Filter box starts from the clicked filters and runs what it holds", async () => {
    mountExplorer();
    await flushPromises();
    await runFilter("service_name = 'pt-payments' AND duration > 5");
    expect(lastRequest().queryReq.filter).toBe("service_name = 'pt-payments' AND duration > 5");
  });

  it("a new time range reruns the list over it", async () => {
    mountExplorer();
    await flushPromises();
    const toolbar = wrapper.findComponent({ name: "ExplorerToolbar" });
    toolbar.vm.$emit("dateChange", { startTime: 90 * MIN, endTime: 110 * MIN });
    await flushPromises();
    expect(lastRequest().queryReq).toMatchObject({ start_time: 90 * MIN, end_time: 110 * MIN });
  });

  it("Escape in the filter box leaves the box; only the next Escape reaches the drawer", async () => {
    const drawerEscape = vi.fn();
    window.addEventListener("keydown", drawerEscape);
    mountExplorer();
    await flushPromises();
    await openTextFilter();
    const input = wrapper.find("[data-test='trace-explorer-filter-input'] input")
      .element as HTMLInputElement;
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).not.toBe(input);
    expect(drawerEscape).not.toHaveBeenCalled();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(drawerEscape).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", drawerEscape);
  });

  it("a row opens the embedded trace over its own window ±1 min, with links in new tabs", async () => {
    mountExplorer();
    await flushPromises();
    wrapper
      .findComponent({ name: "TracesSearchResultList" })
      .vm.$emit("row-click", wrapper.vm.hits[0]);
    await flushPromises();
    const details = wrapper.findComponent({ name: "TraceDetails" });
    expect(details.props()).toMatchObject({
      mode: "embedded",
      traceIdProp: "t1",
      streamNameProp: "otel",
      startTimeProp: 100 * MIN - MIN,
      endTimeProp: 100 * MIN + 1000 + MIN,
    });
    expect(details.props("openLinksInNewTab")).not.toBe(false);
    // The span tabs correlate on the drawer's stream, not the Traces page's.
    expect(details.props("ownStreamName")).not.toBe(false);
    expect(details.props("ownStreamName")).not.toBeUndefined();
    // It opens on Waterfall and never writes the Traces page's saved view.
    expect(details.props("ignoreSavedTab")).not.toBeUndefined();
    expect(details.props("ignoreSavedTab")).not.toBe(false);
    expect(wrapper.find("[data-test='trace-explorer-detail-position']").text()).toBe("1 / 2");
  });

  it("opens each trace with no span picked, as the Traces page does, including after next", async () => {
    mountExplorer();
    await flushPromises();
    wrapper
      .findComponent({ name: "TracesSearchResultList" })
      .vm.$emit("row-click", wrapper.vm.hits[0]);
    await flushPromises();
    const details = () => wrapper.findComponent({ name: "TraceDetails" });
    expect(details().props("spanIdProp") ?? "").toBe("");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await flushPromises();
    expect(details().props("traceIdProp")).toBe("t2");
    expect(details().props("spanIdProp") ?? "").toBe("");
  });

  it("arrow keys step traces, Escape goes back, and keys typed in a field are left alone", async () => {
    mountExplorer();
    await flushPromises();
    wrapper
      .findComponent({ name: "TracesSearchResultList" })
      .vm.$emit("row-click", wrapper.vm.hits[0]);
    await flushPromises();
    const press = (key: string, target: EventTarget = document.body) =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

    const field = document.createElement("input");
    document.body.appendChild(field);
    press("ArrowRight", field);
    await flushPromises();
    expect(wrapper.findComponent({ name: "TraceDetails" }).props("traceIdProp")).toBe("t1");

    press("ArrowRight");
    await flushPromises();
    expect(wrapper.findComponent({ name: "TraceDetails" }).props("traceIdProp")).toBe("t2");

    press("Escape");
    await flushPromises();
    expect(wrapper.findComponent({ name: "TraceDetails" }).exists()).toBe(false);
  });

  it("Open in Traces opens the Traces page on the slice and filter in a new tab", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    mountExplorer();
    await flushPromises();
    await wrapper.find("[data-test='trace-explorer-open']").trigger("click");
    expect(resolve).toHaveBeenCalledWith({
      name: "traces",
      query: {
        org_identifier: store.state.selectedOrganization.identifier,
        stream: "otel",
        from: String(100 * MIN),
        to: String(105 * MIN),
        filter: "service_name = 'cart'",
      },
    });
    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("/web/traces?"),
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("cancels the search in flight when closed", async () => {
    fetchQueryDataWithHttpStream.mockImplementationOnce(() => undefined);
    mountExplorer();
    await flushPromises();
    wrapper.unmount();
    expect(cancelStreamQueryBasedOnRequestId).toHaveBeenCalledTimes(1);
  });
});
