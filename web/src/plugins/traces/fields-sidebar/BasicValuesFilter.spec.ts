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
  // Pass-through — no SQL parser in tests, so duration values are left as-is.
  parseDurationWhereClause: (whereClause: string) => whereClause,
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

const mountComponent = (fieldName: string, dataType = "Utf8") =>
  mount(BasicValuesFilter, {
    attachTo: "#app",
    props: { row: { name: fieldName, dataType } },
    global: {
      provide: { store },
      plugins: [i18n],
      stubs: {
        FieldTypeBadge: true,
        FieldValuesPanel: true,
      },
    },
  });

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
});
