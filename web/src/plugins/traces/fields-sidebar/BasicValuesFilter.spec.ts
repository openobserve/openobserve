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

// Mutable fieldValues object — tests populate it before mounting to control
// what mappedFieldValues computes.  Tests that don't need specific values leave
// it empty; the computed returns EMPTY_FIELD_VALUES for unknown keys.
const mockFieldValues: Record<
  string,
  {
    isLoading: boolean;
    values: { key: string; count: number }[];
    hasMore: boolean;
    errMsg: string;
  }
> = {};

vi.mock("@/composables/useFieldValuesStream", () => ({
  default: () => ({
    fieldValues: mockFieldValues,
    fetchFieldValues: mockFetchFieldValues,
    cancelFieldStream: mockCancelFieldStream,
    resetFieldValues: mockResetFieldValues,
  }),
}));

const mockFetchPercentiles = vi.fn();
const mockCancelPercentileFetch = vi.fn();
// Kept as a vi.fn() so individual tests can assert on calls or override the return value.
const mockParseDurationWhereClause = vi.fn(
  (whereClause: string) => whereClause,
);

// Mutable object closed over by the mock factory — mutate per-test to vary percentile values.
const mockPercentilesValue = {
  p25: null as number | null,
  p50: null as number | null,
  p75: null as number | null,
  p95: null as number | null,
  p99: null as number | null,
  max: null as number | null,
};

vi.mock("@/composables/useDurationPercentiles", () => ({
  default: () => ({
    percentiles: { value: mockPercentilesValue },
    isLoading: false,
    errMsg: { value: "" },
    fetchPercentiles: mockFetchPercentiles,
    cancelFetch: mockCancelPercentileFetch,
  }),
  // Delegates to the module-level vi.fn() so tests can inspect calls or change behaviour.
  parseDurationWhereClause: (
    ...args: Parameters<typeof mockParseDurationWhereClause>
  ) => mockParseDurationWhereClause(...args),
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
  const { dataType = "Utf8", selectedFields, showVisibilityToggle } = options;

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
    mockParseDurationWhereClause.mockImplementation(
      (whereClause: string) => whereClause,
    );
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
    mockParseDurationWhereClause.mockImplementationOnce(
      () => "service_name='svc-a' AND duration >= 1500",
    );
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

// ─── mappedFieldValues ────────────────────────────────────────────────────────

describe("BasicValuesFilter — mappedFieldValues", () => {
  let wrapper: any;

  beforeEach(() => {
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.stream.selectedStream = {
      label: "test_traces",
      value: "test_traces",
    };
    // Reset shared fieldValues state before each test.
    Object.keys(mockFieldValues).forEach((k) => delete mockFieldValues[k]);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("should pass values through unchanged for a non-span_kind field", async () => {
    mockFieldValues["service_name"] = {
      isLoading: false,
      values: [{ key: "frontend", count: 5 }],
      hasMore: false,
      errMsg: "",
    };
    wrapper = mountComponent("service_name");
    await flushPromises();

    const mapped = wrapper.vm.mappedFieldValues;

    expect(mapped.values).toEqual([{ key: "frontend", count: 5 }]);
  });

  it("should map numeric key '2' to key 'Server' for span_kind field", async () => {
    mockFieldValues["span_kind"] = {
      isLoading: false,
      values: [{ key: "2", count: 10 }],
      hasMore: false,
      errMsg: "",
    };
    wrapper = mountComponent("span_kind");
    await flushPromises();

    const mapped = wrapper.vm.mappedFieldValues;

    expect(mapped.values).toHaveLength(1);
    expect(mapped.values[0].key).toBe("Server");
    expect(mapped.values[0].count).toBe(10);
  });

  it("should map empty string key to key 'Unspecified' for span_kind field", async () => {
    mockFieldValues["span_kind"] = {
      isLoading: false,
      values: [{ key: "", count: 3 }],
      hasMore: false,
      errMsg: "",
    };
    wrapper = mountComponent("span_kind");
    await flushPromises();

    const mapped = wrapper.vm.mappedFieldValues;

    expect(mapped.values[0].key).toBe("Unspecified");
  });

  it("should map null key to key 'Unspecified' for span_kind field", async () => {
    mockFieldValues["span_kind"] = {
      isLoading: false,
      // null cast to string via type coercion in the source
      values: [{ key: null as unknown as string, count: 2 }],
      hasMore: false,
      errMsg: "",
    };
    wrapper = mountComponent("span_kind");
    await flushPromises();

    const mapped = wrapper.vm.mappedFieldValues;

    expect(mapped.values[0].key).toBe("Unspecified");
  });

  it("should map all known numeric OTEL span kind keys to their display labels", async () => {
    mockFieldValues["span_kind"] = {
      isLoading: false,
      values: [
        { key: "0", count: 1 },
        { key: "1", count: 2 },
        { key: "2", count: 3 },
        { key: "3", count: 4 },
        { key: "4", count: 5 },
        { key: "5", count: 6 },
      ],
      hasMore: false,
      errMsg: "",
    };
    wrapper = mountComponent("span_kind");
    await flushPromises();

    const mapped = wrapper.vm.mappedFieldValues;
    const keys = mapped.values.map((v: { key: string }) => v.key);

    expect(keys).toEqual([
      "Unspecified",
      "Internal",
      "Server",
      "Client",
      "Producer",
      "Consumer",
    ]);
  });

  it("should leave an unknown span_kind key unchanged", async () => {
    mockFieldValues["span_kind"] = {
      isLoading: false,
      values: [{ key: "99", count: 1 }],
      hasMore: false,
      errMsg: "",
    };
    wrapper = mountComponent("span_kind");
    await flushPromises();

    const mapped = wrapper.vm.mappedFieldValues;

    expect(mapped.values[0].key).toBe("99");
  });

  it("should preserve isLoading and hasMore from the original entry for span_kind", async () => {
    mockFieldValues["span_kind"] = {
      isLoading: true,
      values: [],
      hasMore: true,
      errMsg: "",
    };
    wrapper = mountComponent("span_kind");
    await flushPromises();

    const mapped = wrapper.vm.mappedFieldValues;

    expect(mapped.isLoading).toBe(true);
    expect(mapped.hasMore).toBe(true);
  });
});

// ─── buildSql() — span_kind conversion ───────────────────────────────────────

describe("BasicValuesFilter — buildSql() with span_kind conversion", () => {
  let wrapper: any;

  beforeEach(() => {
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.stream.selectedStream = {
      label: "test_traces",
      value: "test_traces",
    };
    Object.keys(mockFieldValues).forEach((k) => delete mockFieldValues[k]);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  const getSql = () => b64DecodeUnicode(wrapper.vm.buildSql());

  it("should convert span_kind='Server' to span_kind='2' in the generated SQL", async () => {
    // Mount with a field other than span_kind so buildSql() does not strip
    // the span_kind condition — we need it preserved to verify conversion.
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "span_kind='Server'";

    const sql = getSql();

    expect(sql).toContain("span_kind='2'");
    expect(sql).not.toContain("span_kind='Server'");
  });

  it("should convert span_kind='Client' to span_kind='3' in the generated SQL", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "span_kind='Client'";

    const sql = getSql();

    expect(sql).toContain("span_kind='3'");
    expect(sql).not.toContain("span_kind='Client'");
  });

  it("should leave SQL unchanged when there is no span_kind filter", async () => {
    // Mount with "operation_name" so buildSql() does not strip the
    // service_name condition — we need it preserved to confirm no
    // span_kind conversion is applied.
    wrapper = mountComponent("operation_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "service_name='frontend'";

    const sql = getSql();

    expect(sql).toContain("service_name='frontend'");
    expect(sql).not.toContain("span_kind");
  });

  it("should convert span_kind label in a compound AND clause and keep other conditions intact", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "span_kind='Server' AND status_code='200'";

    const sql = getSql();

    expect(sql).toContain("span_kind='2'");
    expect(sql).toContain("status_code='200'");
    expect(sql).not.toContain("span_kind='Server'");
  });

  it("should convert span_kind label in a pipe-style editorValue", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue =
      "match_all('trace') | span_kind='Internal'";

    const sql = getSql();

    expect(sql).toContain("span_kind='1'");
    expect(sql).not.toContain("span_kind='Internal'");
  });
});

// ─── duration field — Max percentile row ─────────────────────────────────────

describe("BasicValuesFilter — duration field Max percentile row", () => {
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
    // Reset the shared mutable percentiles object back to all-null after each test.
    Object.keys(mockPercentilesValue).forEach(
      (k) => ((mockPercentilesValue as any)[k] = null),
    );
  });

  describe("when percentiles.value.max is non-null", () => {
    beforeEach(() => {
      mockPercentilesValue.max = 5_000_000;
    });

    it("should have hasPercentiles true when only max is populated", async () => {
      wrapper = mountComponent("duration");
      await flushPromises();

      // max=5_000_000 (non-null) so hasPercentiles computed returns true.
      expect(wrapper.vm.hasPercentiles).toBe(true);
    });
  });

  describe("when all percentiles including max are null", () => {
    it("should have hasPercentiles false when all percentiles including max are null", async () => {
      // Default module-level mock has all values null (including max).
      wrapper = mountComponent("duration");
      await flushPromises();

      expect(wrapper.vm.hasPercentiles).toBe(false);
    });
  });

  describe("when max percentile is set — >= button visibility", () => {
    // q-expansion-item only renders its default slot when isExpanded is true.
    // There is no public prop/event API to expand the panel from outside, so we
    // mount with a stub that unconditionally renders the default slot, isolating
    // the percentile-row template logic from Quasar's lazy-render behaviour.
    const mountExpanded = (fieldName: string) =>
      mount(BasicValuesFilter, {
        attachTo: "#app",
        props: { row: { name: fieldName } },
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: {
            FieldTypeBadge: true,
            FieldValuesPanel: true,
            "q-expansion-item": {
              template: "<div><slot /><slot name='header' /></div>",
            },
          },
        },
      });

    it("should NOT render the >= button for the max percentile row", async () => {
      // All 6 PERCENTILE_LABELS rows render whenever hasPercentiles is true.
      // v-if="p.key !== 'max'" hides the >= button only on the max row, so
      // exactly 5 >= buttons appear (one per non-max percentile).
      mockPercentilesValue.max = 5_000_000;

      wrapper = mountExpanded("duration");
      await flushPromises();

      const equalBtns = wrapper.findAll(
        '[data-test="log-search-subfield-list-equal-duration-field-btn"]',
      );
      // 6 rows total, max row excluded by v-if → exactly 5 >= buttons.
      expect(equalBtns).toHaveLength(5);
    });

    it("should render the >= button for non-max percentile rows", async () => {
      // p50 is non-null — hasPercentiles is true and p.key !== 'max' so the
      // >= button is rendered for the p50 row.
      mockPercentilesValue.p50 = 3_000_000;

      wrapper = mountExpanded("duration");
      await flushPromises();

      expect(
        wrapper.find('[data-test="log-search-subfield-list-equal-duration-field-btn"]').exists(),
      ).toBe(true);
    });

    it("should always render the <= button for the max percentile row", async () => {
      // The <= button has no v-if guard, so it must appear for every rendered row.
      mockPercentilesValue.max = 5_000_000;

      wrapper = mountExpanded("duration");
      await flushPromises();

      expect(
        wrapper.find('[data-test="log-search-subfield-list-not-equal-duration-field-btn"]').exists(),
      ).toBe(true);
    });
  });
});
