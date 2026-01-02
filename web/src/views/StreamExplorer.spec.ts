// Simplified test file for StreamExplorer.vue
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import { createI18n } from "vue-i18n";
import StreamExplorer from "./StreamExplorer.vue";
import stream from "@/services/stream";
import search from "@/services/search";

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

installQuasar({ plugins: [Notify] });

// Mock services
vi.mock("@/services/stream");
vi.mock("@/services/search");

// Mock router
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

// Mock vuex store
vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: { identifier: "default" },
      zoConfig: { sql_base64_enabled: false },
    },
  }),
}));

// Mock child components
vi.mock("@/components/logstream/explore/SearchBar.vue", () => ({
  default: {
    name: "SearchBar",
    template: "<div>SearchBar</div>",
    methods: { updateQuery: vi.fn() },
  },
}));

vi.mock("@/components/logstream/explore/StreamDataTable.vue", () => ({
  default: {
    name: "StreamDataTable",
    template: "<div>StreamDataTable</div>",
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
        stubs: { QPage: true, SearchBar: true, StreamDataTable: true, QSpinnerHourglass: true },
      },
    });

    expect(wrapper.exists()).toBe(true);
    wrapper.unmount();
  });

  it("should fetch stream schema on mount", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { QPage: true, SearchBar: true, StreamDataTable: true, QSpinnerHourglass: true },
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
        stubs: { QPage: true, SearchBar: true, StreamDataTable: true, QSpinnerHourglass: true },
      },
    });

    await flushPromises();

    expect(wrapper.vm.tableData.columns).toHaveLength(2);
    expect(wrapper.vm.tableData.columns[0].name).toBe("_timestamp");
    wrapper.unmount();
  });

  it("should fetch search results", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { QPage: true, SearchBar: true, StreamDataTable: true, QSpinnerHourglass: true },
      },
    });

    await flushPromises();

    expect(search.search).toHaveBeenCalled();
    expect(wrapper.vm.tableData.rows).toHaveLength(1);
    wrapper.unmount();
  });

  it("should update query value", async () => {
    const wrapper = mount(StreamExplorer, {
      global: {
        plugins: [i18n],
        stubs: { QPage: true, SearchBar: true, StreamDataTable: true, QSpinnerHourglass: true },
      },
    });

    const newQuery = 'SELECT * FROM "another_stream"';
    wrapper.vm.updateQuery(newQuery);

    expect(wrapper.vm.queryData.query).toBe(newQuery);
    wrapper.unmount();
  });
});
