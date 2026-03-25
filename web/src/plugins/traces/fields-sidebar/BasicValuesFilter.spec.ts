// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import BasicValuesFilter from "@/plugins/traces/fields-sidebar/BasicValuesFilter.vue";
import { b64DecodeUnicode } from "@/utils/zincutils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// ─── Module-level mocks (hoisted by Vitest) ───────────────────────────────────

const mockFetchFieldValues = vi.fn();
const mockCancelFieldStream = vi.fn();
const mockResetFieldValues = vi.fn();

vi.mock("@/composables/useFieldValuesStream", () => ({
  default: () => ({
    fieldValues: {},
    fetchFieldValues: mockFetchFieldValues,
    cancelFieldStream: mockCancelFieldStream,
    resetFieldValues: mockResetFieldValues,
  }),
}));

const mockFetchPercentiles = vi.fn();
const mockCancelPercentileFetch = vi.fn();
// Kept as a vi.fn() so individual tests can assert on calls or override the return value.
const mockParseDurationWhereClause = vi.fn((whereClause: string) => whereClause);

vi.mock("@/composables/useDurationPercentiles", () => ({
  default: () => ({
    percentiles: {
      value: { p25: null, p50: null, p75: null, p95: null, p99: null },
    },
    isLoading: { value: false },
    errMsg: { value: "" },
    fetchPercentiles: mockFetchPercentiles,
    cancelFetch: mockCancelPercentileFetch,
  }),
  // Delegates to the module-level vi.fn() so tests can inspect calls or change behaviour.
  parseDurationWhereClause: (...args: Parameters<typeof mockParseDurationWhereClause>) =>
    mockParseDurationWhereClause(...args),
}));

vi.mock("@/composables/useParser", () => ({
  default: () => ({
    sqlParser: vi.fn().mockResolvedValue(null),
  }),
}));

// Mutable searchObj shared across tests.
const mockSearchObj = {
  data: {
    editorValue: "",
    stream: {
      selectedStream: { label: "test_traces", value: "test_traces" },
      selectedStreamFields: [
        { name: "service_name" },
        { name: "status_code" },
        { name: "method" },
      ],
      addToFilter: "",
    },
    datetime: {
      startTime: 0,
      endTime: 1_000_000,
    },
  },
};

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
  }),
}));

// ─── Quasar + DOM setup ────────────────────────────────────────────────────────

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({});

// ─── Mount helper ─────────────────────────────────────────────────────────────

interface MountOptions {
  dataType?: string;
  selectedFields?: string[];
  showVisibilityToggle?: boolean;
}

const mountComponent = (fieldName: string, options: MountOptions = {}) => {
  const {
    dataType = "Utf8",
    selectedFields,
    showVisibilityToggle,
  } = options;

  const props: Record<string, unknown> = { row: { name: fieldName, dataType } };
  if (selectedFields !== undefined) props.selectedFields = selectedFields;
  if (showVisibilityToggle !== undefined)
    props.showVisibilityToggle = showVisibilityToggle;

  return mount(BasicValuesFilter, {
    attachTo: "#app",
    props,
    global: {
      provide: { store },
      plugins: [i18n],
      stubs: {
        FieldTypeBadge: true,
        FieldValuesPanel: true,
      },
    },
  });
};

// ─── buildSql() ───────────────────────────────────────────────────────────────

describe("BasicValuesFilter — buildSql()", () => {
  let wrapper: any;

  beforeEach(() => {
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.stream.selectedStream = {
      label: "test_traces",
      value: "test_traces",
    };
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  const getSql = () => b64DecodeUnicode(wrapper.vm.buildSql());

  it("should return SQL without WHERE when editorValue is empty", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "";

    const sql = getSql();

    expect(sql.toUpperCase()).not.toContain("WHERE");
    expect(sql).toContain("test_traces");
  });

  it("should include all active filters from editorValue in the SQL", async () => {
    // Mount with "method" so neither service_name nor status_code is the expanded
    // field — buildSql() only strips the *expanded* field's own filter from the SQL.
    wrapper = mountComponent("method");
    await flushPromises();
    mockSearchObj.data.editorValue =
      "service_name='svc-a' AND status_code='200'";

    const sql = getSql();

    expect(sql.toUpperCase()).toContain("WHERE");
    expect(sql).toContain("service_name");
    expect(sql).toContain("status_code");
  });

  it("should use the clause after '|' as WHERE for pipe-style editorValue", async () => {
    // Mount with "method" so neither filter term gets stripped by buildSql().
    wrapper = mountComponent("method");
    await flushPromises();
    mockSearchObj.data.editorValue =
      "match_all('trace') | service_name='svc-a' AND status_code='200'";

    const sql = getSql();

    expect(sql.toUpperCase()).toContain("WHERE");
    expect(sql).toContain("service_name");
    expect(sql).toContain("status_code");
  });

  it("should not mutate searchObj.data.editorValue", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    const original = "service_name='svc-a' AND status_code='200'";
    mockSearchObj.data.editorValue = original;

    getSql();

    expect(mockSearchObj.data.editorValue).toBe(original);
  });

  it("should not throw for valid editorValue content", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "service_name='svc-a'";

    expect(() => getSql()).not.toThrow();
  });

  it("should return a decodable base64 string", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "status_code='200'";

    const raw = wrapper.vm.buildSql();

    expect(typeof raw).toBe("string");
    expect(raw.length).toBeGreaterThan(0);
    expect(() => b64DecodeUnicode(raw)).not.toThrow();
  });

  it("should exclude a parenthesized multi-value group for the expanded field from the SQL", async () => {
    // When the editor has (operation_name='x' or operation_name='y') and the
    // user expands operation_name, buildSql() must strip that group so the
    // value fetch query is unbiased and returns all possible values.
    wrapper = mountComponent("operation_name");
    await flushPromises();
    mockSearchObj.data.editorValue =
      "(operation_name='router frontend egress' or operation_name='grpc.oteldemo.ProductCatalogService/GetProduct')";

    const sql = getSql();

    expect(sql).not.toContain("operation_name");
    expect(sql.toUpperCase()).not.toContain("WHERE");
  });

  it("should keep other field filters when excluding a multi-value group for the expanded field", async () => {
    wrapper = mountComponent("operation_name");
    await flushPromises();
    mockSearchObj.data.editorValue =
      "span_status='ERROR' AND (operation_name='router frontend egress' or operation_name='grpc.oteldemo.ProductCatalogService/GetProduct')";

    const sql = getSql();

    expect(sql).not.toContain("operation_name");
    expect(sql).toContain("span_status");
  });
});

// ─── openFilterCreator ────────────────────────────────────────────────────────

describe("BasicValuesFilter — openFilterCreator", () => {
  let wrapper: any;

  beforeEach(() => {
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.stream.selectedStream = {
      label: "test_traces",
      value: "test_traces",
    };
    mockFetchFieldValues.mockReset();
    mockFetchPercentiles.mockReset();
    // Restore the default pass-through implementation before each test.
    mockParseDurationWhereClause.mockImplementation((whereClause: string) => whereClause);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("should call fetchFieldValues for a non-duration field", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    expect(mockFetchFieldValues).toHaveBeenCalled();
    expect(mockFetchPercentiles).not.toHaveBeenCalled();
  });

  it("should not call fetchFieldValues when ftsKey is set", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: true },
    );
    await flushPromises();

    expect(mockFetchFieldValues).not.toHaveBeenCalled();
  });

  it("should call fetchPercentiles instead of fetchFieldValues for the duration field", async () => {
    wrapper = mountComponent("duration");
    await flushPromises();

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    expect(mockFetchPercentiles).toHaveBeenCalled();
    expect(mockFetchFieldValues).not.toHaveBeenCalled();
  });

  it("should pass stream name and time range to fetchPercentiles", async () => {
    wrapper = mountComponent("duration");
    await flushPromises();

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    expect(mockFetchPercentiles).toHaveBeenCalledWith(
      expect.objectContaining({
        streamName: "test_traces",
        startTime: 0,
        endTime: 1_000_000,
      }),
    );
  });

  it("should exclude the duration field's own filter from the whereClause passed to fetchPercentiles", async () => {
    // When editorValue contains only a duration filter, buildSql() strips it via
    // removeFieldFromWhereAST. fetchPercentiles should receive an empty whereClause.
    mockSearchObj.data.editorValue = "duration >= '1.50ms'";
    wrapper = mountComponent("duration");
    await flushPromises();

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    expect(mockFetchPercentiles).toHaveBeenCalledWith(
      expect.objectContaining({ whereClause: "" }),
    );
  });

  it("should preserve non-duration filters in the whereClause passed to fetchPercentiles", async () => {
    // service_name is not the duration field — it must survive the AST strip.
    mockSearchObj.data.editorValue =
      "service_name='svc-a' AND duration >= '1.50ms'";
    wrapper = mountComponent("duration");
    await flushPromises();

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    const call = mockFetchPercentiles.mock.calls[0][0];
    expect(call.whereClause).toContain("service_name");
    // The duration condition itself must be stripped.
    expect(call.whereClause).not.toMatch(/\bduration\b/);
  });

  it("should call parseDurationWhereClause with the extracted WHERE clause before building the SQL", async () => {
    // parseDurationWhereClause is called inside buildSql() to convert human-readable
    // duration strings (e.g. '1.50ms') back to raw µs before the SQL is assembled.
    mockSearchObj.data.editorValue =
      "service_name='svc-a' AND duration >= '1.50ms'";
    wrapper = mountComponent("duration");
    await flushPromises();

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    // parseDurationWhereClause must have been called with the WHERE clause text
    // and the stream name. The sqlParser value is null in tests because useParser
    // resolves to null; we verify only the WHERE text and the stream name.
    expect(mockParseDurationWhereClause).toHaveBeenCalledWith(
      expect.stringContaining("duration"),
      null,
      "test_traces",
    );
  });

  it("should pass the parseDurationWhereClause-converted whereClause to fetchPercentiles", async () => {
    // Simulate parseDurationWhereClause converting '1.50ms' → 1500 so the
    // resulting whereClause uses raw microseconds, not human-readable strings.
    mockParseDurationWhereClause.mockImplementationOnce(() => "service_name='svc-a' AND duration >= 1500");
    mockSearchObj.data.editorValue =
      "service_name='svc-a' AND duration >= '1.50ms'";
    wrapper = mountComponent("duration");
    await flushPromises();

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    // The duration filter is still stripped by removeFieldFromWhereAST after
    // parseDurationWhereClause converts it to a numeric form.  Only the
    // service_name condition should remain.
    const call = mockFetchPercentiles.mock.calls[0][0];
    expect(call.whereClause).toContain("service_name");
    expect(call.whereClause).not.toMatch(/\bduration\b/);
  });

  it("should pass an empty whereClause to fetchPercentiles when editorValue is empty", async () => {
    mockSearchObj.data.editorValue = "";
    wrapper = mountComponent("duration");
    await flushPromises();

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    expect(mockFetchPercentiles).toHaveBeenCalledWith(
      expect.objectContaining({ whereClause: "" }),
    );
  });
});

// ─── Visibility toggle ────────────────────────────────────────────────────────

describe("BasicValuesFilter — visibility toggle", () => {
  let wrapper: any;

  beforeEach(() => {
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.stream.selectedStream = {
      label: "test_traces",
      value: "test_traces",
    };
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("when showVisibilityToggle=true and the field is NOT selected", () => {
    beforeEach(async () => {
      wrapper = mountComponent("service_name", {
        showVisibilityToggle: true,
        selectedFields: [],
      });
      await flushPromises();
    });

    it("should show the add-visibility icon", () => {
      const addBtn = wrapper.find(
        '[data-test="log-search-index-list-add-service_name-field-btn"]',
      );
      expect(addBtn.exists()).toBe(true);
    });

    it("should not show the remove-visibility icon", () => {
      const removeBtn = wrapper.find(
        '[data-test="log-search-index-list-remove-service_name-field-btn"]',
      );
      expect(removeBtn.exists()).toBe(false);
    });

    it("should emit toggle-field with the row when the add-visibility icon is clicked", async () => {
      const addBtn = wrapper.find(
        '[data-test="log-search-index-list-add-service_name-field-btn"]',
      );
      expect(addBtn.exists()).toBe(true);
      await addBtn.trigger("click");
      const emitted = wrapper.emitted("toggle-field");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toMatchObject({ name: "service_name" });
    });
  });

  describe("when showVisibilityToggle=true and the field IS selected", () => {
    beforeEach(async () => {
      wrapper = mountComponent("service_name", {
        showVisibilityToggle: true,
        selectedFields: ["service_name"],
      });
      await flushPromises();
    });

    it("should show the remove-visibility icon", () => {
      const removeBtn = wrapper.find(
        '[data-test="log-search-index-list-remove-service_name-field-btn"]',
      );
      expect(removeBtn.exists()).toBe(true);
    });

    it("should not show the add-visibility icon", () => {
      const addBtn = wrapper.find(
        '[data-test="log-search-index-list-add-service_name-field-btn"]',
      );
      expect(addBtn.exists()).toBe(false);
    });

    it("should emit toggle-field with the row when the remove-visibility icon is clicked", async () => {
      const removeBtn = wrapper.find(
        '[data-test="log-search-index-list-remove-service_name-field-btn"]',
      );
      expect(removeBtn.exists()).toBe(true);
      await removeBtn.trigger("click");
      const emitted = wrapper.emitted("toggle-field");
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toMatchObject({ name: "service_name" });
    });
  });

  describe("when showVisibilityToggle=false", () => {
    beforeEach(async () => {
      wrapper = mountComponent("service_name", {
        showVisibilityToggle: false,
        selectedFields: [],
      });
      await flushPromises();
    });

    it("should not show the add-visibility icon", () => {
      const addBtn = wrapper.find(
        '[data-test="log-search-index-list-add-service_name-field-btn"]',
      );
      expect(addBtn.exists()).toBe(false);
    });

    it("should not show the remove-visibility icon", () => {
      const removeBtn = wrapper.find(
        '[data-test="log-search-index-list-remove-service_name-field-btn"]',
      );
      expect(removeBtn.exists()).toBe(false);
    });
  });

  describe("when showVisibilityToggle=false and the field IS selected", () => {
    beforeEach(async () => {
      wrapper = mountComponent("service_name", {
        showVisibilityToggle: false,
        selectedFields: ["service_name"],
      });
      await flushPromises();
    });

    it("should not show the add-visibility icon", () => {
      const addBtn = wrapper.find(
        '[data-test="log-search-index-list-add-service_name-field-btn"]',
      );
      expect(addBtn.exists()).toBe(false);
    });

    it("should not show the remove-visibility icon", () => {
      const removeBtn = wrapper.find(
        '[data-test="log-search-index-list-remove-service_name-field-btn"]',
      );
      expect(removeBtn.exists()).toBe(false);
    });
  });
});
