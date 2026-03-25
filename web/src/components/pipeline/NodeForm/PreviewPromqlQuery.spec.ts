// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

vi.mock("vue-router", async () => {
  const actual = await vi.importActual("vue-router");
  return {
    ...actual,
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
    useRoute: () => ({ params: {}, query: {} }),
  };
});

// Stub PanelSchemaRenderer – it is a heavy charting component that should
// not be instantiated in unit tests.
const PanelSchemaRendererStub = {
  name: "PanelSchemaRenderer",
  template: '<div data-test="panel-schema-renderer-stub"></div>',
  props: ["panelSchema", "selectedTimeObj", "variablesData", "searchType"],
};

import PreviewPromqlQuery from "./PreviewPromqlQuery.vue";

const defaultDateTime = {
  startTime: new Date("2024-01-01T00:00:00Z").getTime(),
  endTime: new Date("2024-01-01T01:00:00Z").getTime(),
};

function createWrapper(props: Record<string, any> = {}): VueWrapper<any> {
  return mount(PreviewPromqlQuery, {
    props: {
      query: "",
      formData: {},
      isAggregationEnabled: false,
      selectedTab: "",
      stream_name: "",
      stream_type: "",
      dateTime: defaultDateTime,
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        PanelSchemaRenderer: PanelSchemaRendererStub,
      },
    },
  });
}

describe("PreviewPromqlQuery - rendering", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    wrapper = createWrapper();
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("mounts without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the outer chart panel container", () => {
    // The template wraps everything in a div with ref="chartPanelRef"
    const root = wrapper.find("div");
    expect(root.exists()).toBe(true);
  });

  it("renders the data-test='alert-preview-chart' element", () => {
    expect(wrapper.find('[data-test="alert-preview-chart"]').exists()).toBe(
      true
    );
  });

  it("renders the PanelSchemaRenderer stub inside the chart container", () => {
    expect(
      wrapper.find('[data-test="panel-schema-renderer-stub"]').exists()
    ).toBe(true);
  });

  it("passes searchType='ui' to PanelSchemaRenderer", () => {
    const renderer = wrapper.findComponent(PanelSchemaRendererStub);
    expect(renderer.props("searchType")).toBe("ui");
  });

  it("passes an empty variablesData object to PanelSchemaRenderer", () => {
    const renderer = wrapper.findComponent(PanelSchemaRendererStub);
    expect(renderer.props("variablesData")).toEqual({});
  });
});

describe("PreviewPromqlQuery - props", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts query prop as string (default empty string)", () => {
    const wrapper = createWrapper({ query: "" });
    expect(wrapper.props("query")).toBe("");
    wrapper.unmount();
  });

  it("accepts a non-empty query prop", () => {
    const wrapper = createWrapper({ query: "rate(http_requests_total[5m])" });
    expect(wrapper.props("query")).toBe("rate(http_requests_total[5m])");
    wrapper.unmount();
  });

  it("accepts formData prop as object", () => {
    const formData = { threshold: 5, condition: ">" };
    const wrapper = createWrapper({ formData });
    expect(wrapper.props("formData")).toEqual(formData);
    wrapper.unmount();
  });

  it("accepts isAggregationEnabled prop as boolean", () => {
    const wrapper = createWrapper({ isAggregationEnabled: true });
    expect(wrapper.props("isAggregationEnabled")).toBe(true);
    wrapper.unmount();
  });

  it("accepts selectedTab prop as string", () => {
    const wrapper = createWrapper({ selectedTab: "promql" });
    expect(wrapper.props("selectedTab")).toBe("promql");
    wrapper.unmount();
  });

  it("accepts stream_name prop as string", () => {
    const wrapper = createWrapper({ stream_name: "my-stream" });
    expect(wrapper.props("stream_name")).toBe("my-stream");
    wrapper.unmount();
  });

  it("accepts stream_type prop as string", () => {
    const wrapper = createWrapper({ stream_type: "metrics" });
    expect(wrapper.props("stream_type")).toBe("metrics");
    wrapper.unmount();
  });

  it("accepts dateTime prop as object", () => {
    const wrapper = createWrapper({ dateTime: defaultDateTime });
    expect(wrapper.props("dateTime")).toEqual(defaultDateTime);
    wrapper.unmount();
  });

  it("defaults query to empty string when not provided", () => {
    const wrapper = createWrapper();
    expect(wrapper.props("query")).toBe("");
    wrapper.unmount();
  });

  it("defaults isAggregationEnabled to false when not provided", () => {
    const wrapper = createWrapper();
    expect(wrapper.props("isAggregationEnabled")).toBe(false);
    wrapper.unmount();
  });

  it("defaults stream_name to empty string when not provided", () => {
    const wrapper = createWrapper();
    expect(wrapper.props("stream_name")).toBe("");
    wrapper.unmount();
  });

  it("defaults stream_type to empty string when not provided", () => {
    const wrapper = createWrapper();
    expect(wrapper.props("stream_type")).toBe("");
    wrapper.unmount();
  });
});

describe("PreviewPromqlQuery - refreshData", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    wrapper = createWrapper({
      query: "up",
      stream_name: "test-stream",
      stream_type: "metrics",
      dateTime: defaultDateTime,
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("exposes refreshData method via defineExpose", () => {
    expect(typeof (wrapper.vm as any).refreshData).toBe("function");
  });

  it("refreshData does not throw", async () => {
    expect(() => (wrapper.vm as any).refreshData()).not.toThrow();
  });

  it("refreshData populates chartData.value as an object", async () => {
    (wrapper.vm as any).refreshData();
    await nextTick();
    expect(typeof (wrapper.vm as any).chartData).toBe("object");
  });

  it("refreshData sets queryType to 'promql' in chart data", async () => {
    (wrapper.vm as any).refreshData();
    await nextTick();
    const chartData = (wrapper.vm as any).chartData;
    expect(chartData.queryType).toBe("promql");
  });

  it("refreshData sets type to 'line' in chart data", async () => {
    (wrapper.vm as any).refreshData();
    await nextTick();
    const chartData = (wrapper.vm as any).chartData;
    expect(chartData.type).toBe("line");
  });

  it("refreshData carries over the current query prop into chart data", async () => {
    (wrapper.vm as any).refreshData();
    await nextTick();
    const chartData = (wrapper.vm as any).chartData;
    expect(chartData.queries[0].query).toBe("up");
  });

  it("refreshData carries over stream_name into chart data", async () => {
    (wrapper.vm as any).refreshData();
    await nextTick();
    const chartData = (wrapper.vm as any).chartData;
    expect(chartData.queries[0].fields.stream).toBe("test-stream");
  });

  it("refreshData carries over stream_type into chart data", async () => {
    (wrapper.vm as any).refreshData();
    await nextTick();
    const chartData = (wrapper.vm as any).chartData;
    expect(chartData.queries[0].fields.stream_type).toBe("metrics");
  });

  it("refreshData sets customQuery to true", async () => {
    (wrapper.vm as any).refreshData();
    await nextTick();
    const chartData = (wrapper.vm as any).chartData;
    expect(chartData.queries[0].customQuery).toBe(true);
  });
});

describe("PreviewPromqlQuery - emits", () => {
  it("does not define any emits (no events emitted)", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    // The component uses defineExpose only; no emits are declared
    expect(Object.keys(wrapper.emitted())).toHaveLength(0);
    wrapper.unmount();
  });
});
