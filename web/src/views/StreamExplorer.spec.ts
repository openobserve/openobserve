// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import StreamExplorer from "./StreamExplorer.vue";
import stream from "@/services/stream";
import search from "@/services/search";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

vi.mock("@/services/stream");
vi.mock("@/services/search");

vi.mock("vue-router", () => ({
  useRouter: () => ({
    currentRoute: {
      value: {
        query: {
          stream_name: "test_stream",
          stream_type: "logs",
        },
      },
    },
  }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "default" },
      zoConfig: { sql_base64_enabled: false },
    },
  }),
}));

vi.mock("@/components/logstream/explore/SearchBar.vue", () => ({
  default: {
    name: "SearchBar",
    template: "<div>SearchBar</div>",
    methods: { updateQuery: vi.fn() },
  },
}));

vi.mock("@/lib/core/Table/OTable.vue", () => ({
  default: {
    name: "OTable",
    template: "<div>OTable</div>",
  },
}));

vi.mock("@/components/shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: "<div>NoData</div>",
  },
}));

describe("StreamExplorer", () => {
  const mockStreamSchema = {
    data: {
      stream_type: "logs",
      schema: [
        { name: "_timestamp", type: "Int64" },
        { name: "log", type: "Utf8" },
      ],
    },
  };

  const mockSearchResponse = {
    data: {
      from: 0,
      hits: [{ _timestamp: 1609459200000, log: "test log" }],
      total: 1,
      scan_size: 1000,
      took: 50,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (stream.schema as any).mockResolvedValue(mockStreamSchema);
    (search.search as any).mockResolvedValue(mockSearchResponse);
  });

  it("should render the component", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { OTable: true },
      },
    });

    expect(wrapper.exists()).toBe(true);
    wrapper.unmount();
  });

  it("should fetch stream schema on mount", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { OTable: true },
      },
    });

    await flushPromises();

    expect(stream.schema).toHaveBeenCalledWith("default", "test_stream", "logs");
    wrapper.unmount();
  });

  it("should generate table columns from schema", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { OTable: true },
      },
    });

    await flushPromises();

    expect(wrapper.vm.tableColumns).toHaveLength(2);
    expect(wrapper.vm.tableColumns[0].id).toBe("_timestamp");
    wrapper.unmount();
  });

  it("should fetch search results", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { OTable: true },
      },
    });

    await flushPromises();

    expect(search.search).toHaveBeenCalled();
    expect(wrapper.vm.rows).toHaveLength(1);
    wrapper.unmount();
  });

  it("should update query value", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { OTable: true },
      },
    });

    const newQuery = 'SELECT * FROM "another_stream"';
    wrapper.vm.updateQuery(newQuery);

    expect(wrapper.vm.queryData.query).toBe(newQuery);
    wrapper.unmount();
  });

  it("should update currentPage on pagination change", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { OTable: true },
      },
    });

    wrapper.vm.onPaginationChange({ page: 3, size: 100 });

    expect(wrapper.vm.currentPage).toBe(3);
    expect(wrapper.vm.pageSize).toBe(100);
    wrapper.unmount();
  });

  it("should reset to page 1 when time range changes", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { OTable: true },
      },
    });

    await flushPromises();

    wrapper.vm.currentPage = 5;
    wrapper.vm.updateDateTime({
      startTime: 1000,
      endTime: 2000,
      relativeTimePeriod: "1h",
      type: "relative",
      valueType: "relative",
    });

    expect(wrapper.vm.currentPage).toBe(1);
    wrapper.unmount();
  });
});
