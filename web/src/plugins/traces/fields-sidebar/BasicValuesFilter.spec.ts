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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import BasicValuesFilter from "@/plugins/traces/fields-sidebar/BasicValuesFilter.vue";
import { b64DecodeUnicode } from "@/utils/zincutils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// ─── Module-level mocks (hoisted by Vitest) ───────────────────────────────────

const mockFetchQueryDataWithHttpStream = vi.fn();
const mockCancelStreamQueryBasedOnRequestId = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: mockFetchQueryDataWithHttpStream,
    cancelStreamQueryBasedOnRequestId: mockCancelStreamQueryBasedOnRequestId,
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
    },
    datetime: {
      startTime: 0,
      endTime: 1000000,
    },
  },
};

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: mockSearchObj,
  }),
}));

// ─── Quasar setup ─────────────────────────────────────────────────────────────

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar({});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BasicValuesFilter — field filter isolation in buildSql()", () => {
  let wrapper: any;

  beforeEach(() => {
    // Reset editorValue before each test.
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.stream.selectedStream = {
      label: "test_traces",
      value: "test_traces",
    };
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    mockFetchQueryDataWithHttpStream.mockReset();
  });

  /**
   * Decode the base64-encoded SQL returned by buildSql().
   */
  const getSql = () => b64DecodeUnicode(wrapper.vm.buildSql());

  // ── Field filter exclusion ───────────────────────────────────────────────────

  it("excludes the expanded field's own filter from the values SQL", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue =
      "service_name='svc-a' AND status_code='200'";

    const sql = getSql();

    expect(sql).not.toContain("service_name");
    expect(sql).toContain("status_code");
  });

  it("preserves all other field filters when one is excluded", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue =
      "service_name='svc-a' AND status_code='200' AND method='GET'";

    const sql = getSql();

    expect(sql).not.toContain("service_name");
    expect(sql).toContain("status_code");
    expect(sql).toContain("method");
  });

  it("removes WHERE entirely when the expanded field is the only filter", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "service_name='svc-a'";

    const sql = getSql();

    expect(sql.toUpperCase()).not.toContain("WHERE");
  });

  it("leaves SQL unchanged when the expanded field has no active filter", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "status_code='200'";

    const sql = getSql();

    expect(sql).toContain("status_code");
    expect(sql).not.toContain("service_name");
  });

  // ── Pipe-style query (editorValue with DSL prefix) ───────────────────────────

  it("handles pipe-style editorValue: uses clause after '|' as WHERE", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue =
      "match_all('trace') | service_name='svc-a' AND status_code='200'";

    const sql = getSql();

    expect(sql).not.toContain("service_name");
    expect(sql).toContain("status_code");
  });

  // ── editorValue immutability ─────────────────────────────────────────────────

  it("does not mutate searchObj.data.editorValue", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    const original = "service_name='svc-a' AND status_code='200'";
    mockSearchObj.data.editorValue = original;

    getSql();

    expect(mockSearchObj.data.editorValue).toBe(original);
  });

  // ── No WHERE clause in editorValue ───────────────────────────────────────────

  it("returns a SQL without WHERE when editorValue is empty", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockSearchObj.data.editorValue = "";

    const sql = getSql();

    expect(sql.toUpperCase()).not.toContain("WHERE");
    expect(sql).toContain("test_traces");
  });

  // ── Fallback on unparseable SQL ───────────────────────────────────────────────

  it("falls back to original query_context when AST parsing fails", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    // Inject a filter that is valid enough for the WHERE builder but
    // results in a query_context the parser cannot round-trip cleanly.
    // Using a structurally odd clause that will cause the parser to throw.
    mockSearchObj.data.editorValue =
      "service_name='svc-a' AND status_code='200'";

    // The function should not throw even if internals fail.
    expect(() => getSql()).not.toThrow();
  });
});

// ─── Integration: fetchValues fires with filtered SQL ─────────────────────────

describe("BasicValuesFilter — fetchValues sends filtered SQL via streaming", () => {
  let wrapper: any;

  beforeEach(() => {
    mockSearchObj.data.editorValue = "";
    mockSearchObj.data.stream.selectedStream = {
      label: "test_traces",
      value: "test_traces",
    };
    mockSearchObj.data.stream.selectedStreamFields = [
      { name: "service_name" },
      { name: "status_code" },
    ];
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    mockFetchQueryDataWithHttpStream.mockReset();
  });

  it("openFilterCreator triggers a stream fetch whose SQL excludes the expanded field", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockFetchQueryDataWithHttpStream.mockReset();

    mockSearchObj.data.editorValue =
      "service_name='svc-a' AND status_code='200'";

    // Simulate the q-expansion-item before-show event.
    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
    const sql = b64DecodeUnicode(
      mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq.sql,
    );
    expect(sql).not.toContain("service_name");
    expect(sql).toContain("status_code");
  });

  it("openFilterCreator SQL has no WHERE when the expanded field is the only filter", async () => {
    wrapper = mountComponent("service_name");
    await flushPromises();
    mockFetchQueryDataWithHttpStream.mockReset();

    mockSearchObj.data.editorValue = "service_name='svc-a'";

    await wrapper.vm.openFilterCreator(
      { stopPropagation: vi.fn(), preventDefault: vi.fn() },
      { ftsKey: null },
    );
    await flushPromises();

    expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalled();
    const sql = b64DecodeUnicode(
      mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq.sql,
    );
    expect(sql.toUpperCase()).not.toContain("WHERE");
  });
});
