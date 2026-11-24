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
    getStream: vi.fn().mockResolvedValue({ schema: [{ name: "service_name" }] }),
  }),
}));
const resolve = vi.fn((to: any) => ({ href: `/web/${to.name}?${new URLSearchParams(to.query)}` }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ resolve, push: vi.fn(), replace: vi.fn(), currentRoute: { value: {} } }),
  useRoute: () => ({ query: {} }),
}));

import DashboardTraceExplorer from "./DashboardTraceExplorer.vue";

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

  beforeEach(() => {
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

  it("the Filter editor runs its WHERE on Enter", async () => {
    mountExplorer();
    await flushPromises();
    await wrapper.find("[data-test='trace-explorer-query-toggle']").trigger("click");
    const input = wrapper.find("[data-test='trace-explorer-filter-input'] input");
    await input.setValue("status_code = 'ERROR'");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(lastRequest().queryReq.filter).toBe("status_code = 'ERROR'");
  });

  const runFilter = async (where: string) => {
    if (!wrapper.find("[data-test='trace-explorer-filter-input']").exists()) {
      await wrapper.find("[data-test='trace-explorer-query-toggle']").trigger("click");
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
    await wrapper.find("[data-test='trace-explorer-query-toggle']").trigger("click");
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
