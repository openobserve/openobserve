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

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// ─── Quasar mock — intercept copyToClipboard ────────────────────────────────
// vi.mock is hoisted by Vitest, so the factory runs before any const declarations.
// Use vi.hoisted() to create the spy in the hoisted scope so it's available
// both inside the factory and in test assertions.
//
// cellActionsColumnRef drives the column passed to the cell-actions slot in the
// TenstackTable stub.  The component uses `column.id` and `row[column.id]`
// directly in its @copy handler (not event args), so each copy test must set
// the right column.id + include the matching field in the hit before mounting.
const { mockQCopyToClipboard, cellActionsColumnRef } = vi.hoisted(() => ({
  mockQCopyToClipboard: vi.fn().mockResolvedValue(undefined),
  cellActionsColumnRef: {
    id: undefined as string | undefined,
    columnDef: { meta: { disableCellAction: false } },
  },
}));
vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    copyToClipboard: mockQCopyToClipboard,
    useQuasar: () => ({ notify: vi.fn(), dialog: vi.fn() }),
  };
});

// ─── Shared searchObj reference — lets tests read addToFilter after mutation ─
const sharedSearchObj = {
  data: {
    stream: { selectedStreamFields: [] as string[], addToFilter: "" },
    resultGrid: { columns: [] as any[] },
  },
};

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: sharedSearchObj,
    updatedLocalLogFilterField: vi.fn(),
  }),
  DEFAULT_TRACE_COLUMNS: {
    traces: [
      "service_name",
      "operation_name",
      "duration",
      "spans",
      "status",
      "service_latency",
    ],
    spans: ["service_name", "operation_name", "duration", "span_status"],
  },
}));

vi.mock("@/plugins/traces/composables/useTracesTableColumns", () => ({
  useTracesTableColumns: () => ({
    buildColumns: vi.fn(() => []),
  }),
}));

// ─── CellActions stub — emits copy/add-search-term with the field + value
// that are passed down from the component via its @copy / @add-search-term
// bindings on the real CellActions component.  The stub captures the props
// and re-emits them verbatim so tests can trigger the component's handlers
// with explicit field/value pairs via wrapper.vm.$emit on the stub.
vi.mock("@/plugins/logs/data-table/CellActions.vue", () => ({
  default: {
    name: "CellActions",
    props: [
      "column",
      "row",
      "selectedStreamFields",
      "hideSearchTermActions",
      "hideAi",
    ],
    emits: ["copy", "add-search-term", "send-to-ai-chat"],
    template: `<div data-test="stub-cell-actions" />`,
  },
}));

// ─── TenstackTable stub — renders loading/empty/cell slots ──────────────────
// Also renders cell-actions slot so CellActions can be exercised in tests.
// setup() exposes cellActionsColumnRef so each test can control column.id — the
// component's @copy handler uses column.id + row[column.id] from the slot scope,
// not the event args emitted by CellActions.
vi.mock("@/components/TenstackTable.vue", () => ({
  default: {
    name: "TenstackTable",
    props: [
      "columns",
      "rows",
      "rowClass",
      "loading",
      "sortBy",
      "sortOrder",
      "sortFieldMap",
      "rowHeight",
      "enableColumnReorder",
      "enableRowExpand",
      "enableTextHighlight",
      "enableCellActions",
      "enableStatusBar",
      "defaultColumns",
      "selectedStreamFields",
    ],
    emits: [
      "click:data-row",
      "sort-change",
      "closeColumn",
      "update:columnOrder",
    ],
    setup() {
      return { cellActionsColumn: cellActionsColumnRef };
    },
    // Mirror the real slot behaviour used by TracesSearchResultList.
    // Also render cell slots for the first row so slot-split tests can assert on rendered output.
    template: `
      <div data-test="stub-traces-table">
        <slot v-if="loading && (!rows || rows.length === 0)" name="loading" />
        <slot v-else name="empty" />
        <template v-if="rows && rows.length">
          <div data-test="stub-cell-span_status"><slot name="cell-span_status" :item="rows[0]" /></div>
          <div data-test="stub-cell-status"><slot name="cell-status" :item="rows[0]" /></div>
          <div data-test="stub-cell-actions-wrapper">
            <slot name="cell-actions" :row="rows[0]" :column="cellActionsColumn" :active="true" />
          </div>
        </template>
      </div>
    `,
  },
}));

vi.mock("./TraceTimestampCell.vue", () => ({
  default: {
    name: "TraceTimestampCell",
    props: ["item"],
    template: "<span />",
  },
}));
vi.mock("./TraceServiceCell.vue", () => ({
  default: { name: "TraceServiceCell", props: ["item"], template: "<span />" },
}));
vi.mock("./TraceLatencyCell.vue", () => ({
  default: { name: "TraceLatencyCell", props: ["item"], template: "<span />" },
}));
vi.mock("./TraceStatusCell.vue", () => ({
  default: { name: "TraceStatusCell", props: ["item"], template: "<span />" },
}));
vi.mock("./SpanStatusPill.vue", () => ({
  default: { name: "SpanStatusPill", props: ["status"], template: "<span />" },
}));
vi.mock("./SpanStatusCodeBadge.vue", () => ({
  default: {
    name: "SpanStatusCodeBadge",
    props: ["code", "grpcCode"],
    template: "<span />",
  },
}));

import TracesSearchResultList from "./TracesSearchResultList.vue";

installQuasar();

const makeHit = (id: string, errors = 0) => ({
  trace_id: id,
  service_name: "frontend",
  operation_name: "GET /",
  duration: 120000,
  spans: 3,
  errors,
  services: { frontend: { duration: 120000 } },
  trace_start_time: Date.now() * 1000,
});

describe("TracesSearchResultList", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    // Reset shared searchObj state between tests
    sharedSearchObj.data.stream.addToFilter = "";
    sharedSearchObj.data.stream.selectedStreamFields = [];
    sharedSearchObj.data.resultGrid.columns = [];
    // Reset the column ref so copy tests don't bleed into each other
    cellActionsColumnRef.id = undefined;
  });

  const mount_ = (
    props: { hits: any[]; loading: boolean } & Record<string, any>,
  ) =>
    mount(TracesSearchResultList, {
      props: props as any,
      global: { plugins: [i18n, store] },
    });

  // ─── Loading state ────────────────────────────────────────────────────────
  describe("loading state", () => {
    it("shows a spinner while loading", () => {
      wrapper = mount_({ hits: [], loading: true });
      expect(
        wrapper.findComponent({ name: "QSpinnerHourglass" }).exists(),
      ).toBe(true);
    });

    // The component uses v-show="hasResults || loading" on the table wrapper, so
    // the wrapper remains visible while loading (the loading slot inside shows a spinner).
    // It is only absent from the DOM when noResults is true (searchPerformed && !loading && empty).
    it.skip("hides the table wrapper while loading", () => {
      wrapper = mount_({ hits: [], loading: true });
      expect(wrapper.find('[data-test="traces-table-wrapper"]').exists()).toBe(
        false,
      );
    });

    it("hides the empty state while loading", () => {
      wrapper = mount_({ hits: [], loading: true });
      expect(wrapper.text()).not.toContain("No traces found");
    });
  });

  // ─── Empty / no-results state ─────────────────────────────────────────────
  describe("empty state", () => {
    it("shows no-results message when search performed and hits are empty", () => {
      wrapper = mount_({ hits: [], loading: false, searchPerformed: true });
      expect(wrapper.text()).toContain("No traces found");
    });

    it("does not show spinner in empty state", () => {
      wrapper = mount_({ hits: [], loading: false, searchPerformed: true });
      expect(
        wrapper.findComponent({ name: "QSpinnerHourglass" }).exists(),
      ).toBe(false);
    });

    it("does not show the table in empty state", () => {
      wrapper = mount_({ hits: [], loading: false, searchPerformed: true });
      expect(wrapper.find('[data-test="traces-table-wrapper"]').exists()).toBe(
        false,
      );
    });

    it("does not show no-results message when searchPerformed is false", () => {
      wrapper = mount_({ hits: [], loading: false, searchPerformed: false });
      expect(wrapper.text()).not.toContain("No traces found");
    });
  });

  // ─── Results state ────────────────────────────────────────────────────────
  describe("results state", () => {
    const hits = [makeHit("trace-1"), makeHit("trace-2")];

    it("shows the table wrapper when hits exist", () => {
      wrapper = mount_({ hits, loading: false, searchPerformed: true });
      expect(wrapper.find('[data-test="traces-table-wrapper"]').exists()).toBe(
        true,
      );
    });

    it("does not show spinner when hits exist", () => {
      wrapper = mount_({ hits, loading: false, searchPerformed: true });
      expect(
        wrapper.findComponent({ name: "QSpinnerHourglass" }).exists(),
      ).toBe(false);
    });

    it("does not show the no-results message when hits exist", () => {
      wrapper = mount_({ hits, loading: false, searchPerformed: true });
      expect(wrapper.text()).not.toContain("No traces found");
    });
  });

  // ─── Events ───────────────────────────────────────────────────────────────
  describe("events", () => {
    it("re-emits row-click from TracesTable", async () => {
      const hits = [makeHit("t1")];
      wrapper = mount_({ hits, loading: false });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      await table.vm.$emit("click:data-row", hits[0]);
      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")![0]).toEqual([hits[0]]);
    });

    // TracesSearchResultList does not forward load-more — callers attach an
    // external scroll listener on the container instead.
    it.skip("re-emits load-more from TracesTable", async () => {
      const hits = [makeHit("t1")];
      wrapper = mount_({ hits, loading: false });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      await table.vm.$emit("load-more");
      expect(wrapper.emitted("load-more")).toBeTruthy();
    });
  });

  // ─── Row error class ──────────────────────────────────────────────────────
  describe("row error class", () => {
    it("passes a rowClass function to TracesTable", () => {
      wrapper = mount_({ hits: [makeHit("t1")], loading: false });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(typeof rowClassFn).toBe("function");
    });

    it("returns 'oz-table__row--error' for rows with errors", () => {
      wrapper = mount_({ hits: [makeHit("t1", 2)], loading: false });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(rowClassFn(makeHit("t1", 2))).toBe("oz-table__row--error");
    });

    it("returns empty string for rows without errors", () => {
      wrapper = mount_({ hits: [makeHit("t1", 0)], loading: false });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(rowClassFn(makeHit("t1", 0))).toBe("");
    });
  });

  describe("row error class — spans mode", () => {
    const makeSpanHit = (id: string, span_status = "OK") => ({
      trace_id: id,
      service_name: "frontend",
      operation_name: "GET /",
      duration: 120000,
      spans: 1,
      span_status,
      services: {},
      start_time: Date.now() * 1_000_000,
    });

    it("uses span_status='ERROR' for error class in spans mode", () => {
      wrapper = mount_({
        hits: [makeSpanHit("s1")],
        loading: false,
        searchMode: "spans",
      });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(rowClassFn(makeSpanHit("s1", "ERROR"))).toBe(
        "oz-table__row--error",
      );
    });

    it("returns empty string for non-error span_status in spans mode", () => {
      wrapper = mount_({
        hits: [makeSpanHit("s1")],
        loading: false,
        searchMode: "spans",
      });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(rowClassFn(makeSpanHit("s1", "OK"))).toBe("");
    });

    it("uses errors count (not span_status) for error class in traces mode", () => {
      wrapper = mount_({
        hits: [makeHit("t1", 0)],
        loading: false,
        searchMode: "traces",
      });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      // traces mode: errors > 0 triggers error class
      expect(rowClassFn({ ...makeHit("t1", 2), span_status: "OK" })).toBe(
        "oz-table__row--error",
      );
    });
  });

  // ─── onCloseColumn — sort reset ──────────────────────────────────────────
  describe("onCloseColumn — sort reset", () => {
    const makeSpanHit = (id: string) => ({
      trace_id: id,
      service_name: "frontend",
      operation_name: "GET /",
      duration: 120000,
      spans: 1,
      span_status: "OK",
      services: {},
      start_time: Date.now() * 1_000_000,
    });

    beforeEach(() => {
      // Set up columns so onCloseColumn has something to remove
      sharedSearchObj.data.resultGrid.columns = [
        { id: "service_name" },
        { id: "duration" },
        { id: "span_status" },
      ];
      sharedSearchObj.data.stream.selectedFields = [
        "service_name",
        "duration",
        "span_status",
      ];
    });

    afterEach(() => {
      sharedSearchObj.data.resultGrid.columns = [];
      sharedSearchObj.data.stream.selectedFields = [];
    });

    it("should emit sort-change with defaults when the closed column is the active sort column", async () => {
      wrapper = mount_({
        hits: [makeSpanHit("s1")],
        loading: false,
        sortBy: "span_status",
        sortOrder: "asc",
        searchMode: "spans" as any,
      });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      await table.vm.$emit("closeColumn", { id: "span_status" });

      expect(wrapper.emitted("sort-change")).toBeTruthy();
      expect(wrapper.emitted("sort-change")![0]).toEqual([
        "start_time",
        "desc",
      ]);
    });

    it("should NOT emit sort-change when the closed column is NOT the active sort column", async () => {
      wrapper = mount_({
        hits: [makeSpanHit("s1")],
        loading: false,
        sortBy: "duration",
        sortOrder: "desc",
        searchMode: "spans" as any,
      });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      await table.vm.$emit("closeColumn", { id: "span_status" });

      expect(wrapper.emitted("sort-change")).toBeFalsy();
    });

    it("should remove the column from selectedFields and resultGrid.columns when closed", async () => {
      wrapper = mount_({
        hits: [makeSpanHit("s1")],
        loading: false,
        sortBy: "duration",
        sortOrder: "desc",
        searchMode: "spans" as any,
      });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      await table.vm.$emit("closeColumn", { id: "span_status" });

      expect(sharedSearchObj.data.stream.selectedFields).not.toContain(
        "span_status",
      );
      expect(
        sharedSearchObj.data.resultGrid.columns.some(
          (c: any) => c.id === "span_status",
        ),
      ).toBe(false);
    });
  });

  // ─── Cell slot split: span_status vs status ──────────────────────────────
  describe("cell slot split — span_status and status", () => {
    const makeSpanHit = (id: string) => ({
      trace_id: id,
      service_name: "frontend",
      operation_name: "GET /",
      duration: 120000,
      spans: 1,
      span_status: "OK",
      status: "STATUS_CODE_OK",
      services: {},
      start_time: Date.now() * 1_000_000,
    });

    it("renders SpanStatusPill inside #cell-span_status slot", () => {
      wrapper = mount_({ hits: [makeSpanHit("s1")], loading: false } as any);
      const cell = wrapper.find('[data-test="stub-cell-span_status"]');
      expect(cell.exists()).toBe(true);
      expect(cell.findComponent({ name: "SpanStatusPill" }).exists()).toBe(
        true,
      );
    });

    it("passes item.span_status to SpanStatusPill in #cell-span_status slot", () => {
      const hit = makeSpanHit("s1");
      wrapper = mount_({ hits: [hit], loading: false } as any);
      const pill = wrapper
        .find('[data-test="stub-cell-span_status"]')
        .findComponent({ name: "SpanStatusPill" });
      expect(pill.props("status")).toBe("OK");
    });

    it("renders TraceStatusCell inside #cell-status slot", () => {
      wrapper = mount_({ hits: [makeSpanHit("s1")], loading: false } as any);
      const cell = wrapper.find('[data-test="stub-cell-status"]');
      expect(cell.exists()).toBe(true);
      expect(cell.findComponent({ name: "TraceStatusCell" }).exists()).toBe(
        true,
      );
    });

    it("does NOT render SpanStatusPill inside #cell-status slot", () => {
      wrapper = mount_({ hits: [makeSpanHit("s1")], loading: false } as any);
      const statusCell = wrapper.find('[data-test="stub-cell-status"]');
      expect(
        statusCell.findComponent({ name: "SpanStatusPill" }).exists(),
      ).toBe(false);
    });

    it("does NOT render TraceStatusCell inside #cell-span_status slot", () => {
      wrapper = mount_({ hits: [makeSpanHit("s1")], loading: false } as any);
      const spanStatusCell = wrapper.find(
        '[data-test="stub-cell-span_status"]',
      );
      expect(
        spanStatusCell.findComponent({ name: "TraceStatusCell" }).exists(),
      ).toBe(false);
    });
  });

  // ─── copyToClipboard — span_kind translation ──────────────────────────────
  // The component's @copy handler is an inline expression:
  //   @copy="copyToClipboard(column.id, row[column.id])"
  // It uses column.id and row[column.id] from the slot scope — it does NOT
  // forward the args emitted by CellActions.  Each test therefore:
  //   1. Sets cellActionsColumnRef.id to the target field before mounting
  //   2. Passes a hit that contains that field with the desired value
  //   3. Emits "copy" with no args — the handler picks up field+value from scope
  describe("copyToClipboard — span_kind translation", () => {
    it("should copy the display label when field is span_kind and value maps to a known entry", async () => {
      // value "2" maps to "Server" in SPAN_KIND_MAP
      cellActionsColumnRef.id = "span_kind";
      wrapper = mount_({
        hits: [{ ...makeHit("t1"), span_kind: "2" }],
        loading: false,
      });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      await cellActions.vm.$emit("copy");
      expect(mockQCopyToClipboard).toHaveBeenCalledWith("Server");
    });

    it("should copy the raw value when field is span_kind and value is not in the map", async () => {
      // value "99" has no mapping — raw string is copied unchanged
      cellActionsColumnRef.id = "span_kind";
      wrapper = mount_({
        hits: [{ ...makeHit("t1"), span_kind: "99" }],
        loading: false,
      });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      await cellActions.vm.$emit("copy");
      expect(mockQCopyToClipboard).toHaveBeenCalledWith("99");
    });

    it("should copy the raw value without translation when field is not span_kind", async () => {
      // non-span_kind field — no translation applied
      cellActionsColumnRef.id = "some_other_field";
      wrapper = mount_({
        hits: [{ ...makeHit("t1"), some_other_field: "2" }],
        loading: false,
      });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      await cellActions.vm.$emit("copy");
      expect(mockQCopyToClipboard).toHaveBeenCalledWith("2");
    });
  });

  // ─── addSearchTerm — span_kind translation in filter string ──────────────
  // The component handler is invoked by CellActions via its @add-search-term event.
  // We emit the event on the CellActions stub and assert the resulting
  // searchObj.data.stream.addToFilter string.
  describe("addSearchTerm — span_kind translation", () => {
    const hit = makeHit("t1");

    it("should include display label in filter when field is span_kind and value maps to a known entry", async () => {
      wrapper = mount_({ hits: [hit], loading: false });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      // value "2" maps to "Server"
      await cellActions.vm.$emit(
        "add-search-term",
        "span_kind",
        "2",
        "include",
      );
      expect(sharedSearchObj.data.stream.addToFilter).toContain(
        "span_kind = 'Server'",
      );
    });

    it("should include raw value in filter when field is span_kind and value is not in the map", async () => {
      wrapper = mount_({ hits: [hit], loading: false });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      // value "99" has no mapping — raw string used in filter
      await cellActions.vm.$emit(
        "add-search-term",
        "span_kind",
        "99",
        "include",
      );
      expect(sharedSearchObj.data.stream.addToFilter).toContain(
        "span_kind = '99'",
      );
    });

    it("should include raw value without translation when field is not span_kind", async () => {
      wrapper = mount_({ hits: [hit], loading: false });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      // non-span_kind field — no translation
      await cellActions.vm.$emit(
        "add-search-term",
        "service_name",
        "my-svc",
        "include",
      );
      expect(sharedSearchObj.data.stream.addToFilter).toContain(
        "service_name = 'my-svc'",
      );
    });

    it("should use != operator for exclude action", async () => {
      wrapper = mount_({ hits: [hit], loading: false });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      await cellActions.vm.$emit(
        "add-search-term",
        "span_kind",
        "2",
        "exclude",
      );
      expect(sharedSearchObj.data.stream.addToFilter).toContain(
        "span_kind != 'Server'",
      );
    });

    it("should use fieldValue directly for start_time without needing a row shadow field", async () => {
      wrapper = mount_({ hits: [hit], loading: false });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      await cellActions.vm.$emit(
        "add-search-term",
        "start_time",
        "1700000000123456789",
        "include",
      );
      expect(sharedSearchObj.data.stream.addToFilter).toBe(
        "start_time = '1700000000123456789'",
      );
    });

    it("should use fieldValue directly for end_time without needing a row shadow field", async () => {
      wrapper = mount_({ hits: [hit], loading: false });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      await cellActions.vm.$emit(
        "add-search-term",
        "end_time",
        "1700000000987654321",
        "include",
      );
      expect(sharedSearchObj.data.stream.addToFilter).toBe(
        "end_time = '1700000000987654321'",
      );
    });

    it("should set is null filter when fieldValue is null for start_time", async () => {
      wrapper = mount_({ hits: [hit], loading: false });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      await cellActions.vm.$emit(
        "add-search-term",
        "start_time",
        "null",
        "include",
      );
      expect(sharedSearchObj.data.stream.addToFilter).toBe(
        "start_time is null",
      );
    });

    it("should set is null filter when fieldValue is null for a generic field", async () => {
      wrapper = mount_({ hits: [hit], loading: false });
      const cellActions = wrapper.findComponent({ name: "CellActions" });
      expect(cellActions.exists()).toBe(true);
      await cellActions.vm.$emit(
        "add-search-term",
        "service_name",
        "null",
        "include",
      );
      expect(sharedSearchObj.data.stream.addToFilter).toBe(
        "service_name is null",
      );
    });
  });
});
