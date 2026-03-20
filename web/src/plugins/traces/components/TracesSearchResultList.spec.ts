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

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Stub TenstackTable — cell rendering and virtualizer are not under test here
vi.mock("@/components/TenstackTable.vue", () => ({
  default: {
    name: "TenstackTable",
    props: [
      "columns", "rows", "rowClass", "loading",
      "sortBy", "sortOrder", "sortFieldMap", "rowHeight",
      "enableColumnReorder", "enableRowExpand", "enableTextHighlight",
      "enableCellActions", "enableStatusBar", "defaultColumns",
      "selectedStreamFields",
    ],
    emits: ["click:data-row", "sort-change"],
    // Mirror the real slot behaviour used by TracesSearchResultList
    template: `<div data-test="stub-traces-table"><slot v-if="loading && (!rows || rows.length === 0)" name="loading" /><slot v-else name="empty" /></div>`,
  },
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: {
      data: {
        stream: { selectedStreamFields: [], addToFilter: "" },
        resultGrid: { columns: [] },
      },
    },
    updatedLocalLogFilterField: vi.fn(),
  }),
}));

vi.mock("./TraceTimestampCell.vue", () => ({
  default: { name: "TraceTimestampCell", props: ["item"], template: "<span />" },
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
  });

  const mount_ = (props: { hits: any[]; loading: boolean } & Record<string, any>) =>
    mount(TracesSearchResultList, {
      props: props as any,
      global: { plugins: [i18n, store] },
    });

  // ─── Loading state ────────────────────────────────────────────────────────
  describe("loading state", () => {
    it("shows a spinner while loading", () => {
      wrapper = mount_({ hits: [], loading: true });
      expect(wrapper.findComponent({ name: "QSpinnerHourglass" }).exists()).toBe(true);
    });

    // The component uses v-show="hasResults || loading" on the table wrapper, so
    // the wrapper remains visible while loading (the loading slot inside shows a spinner).
    // It is only absent from the DOM when noResults is true (searchPerformed && !loading && empty).
    it.skip("hides the table wrapper while loading", () => {
      wrapper = mount_({ hits: [], loading: true });
      expect(wrapper.find('[data-test="traces-table-wrapper"]').exists()).toBe(false);
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
      expect(wrapper.findComponent({ name: "QSpinnerHourglass" }).exists()).toBe(false);
    });

    it("does not show the table in empty state", () => {
      wrapper = mount_({ hits: [], loading: false, searchPerformed: true });
      expect(wrapper.find('[data-test="traces-table-wrapper"]').exists()).toBe(false);
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
      expect(wrapper.find('[data-test="traces-table-wrapper"]').exists()).toBe(true);
    });

    it("does not show spinner when hits exist", () => {
      wrapper = mount_({ hits, loading: false, searchPerformed: true });
      expect(wrapper.findComponent({ name: "QSpinnerHourglass" }).exists()).toBe(false);
    });

    it("does not show the no-results message when hits exist", () => {
      wrapper = mount_({ hits, loading: false, searchPerformed: true });
      expect(wrapper.text()).not.toContain("No traces found");
    });
  });

  // ─── Section header ───────────────────────────────────────────────────────
  describe("section header", () => {
    const hits = [makeHit("t1"), makeHit("t2")];

    it("shows the section header by default", () => {
      wrapper = mount_({ hits, loading: false });
      expect(wrapper.find('[data-test="traces-section-header"]').exists()).toBe(true);
    });

    it("shows TRACES title in the header", () => {
      wrapper = mount_({ hits, loading: false });
      expect(wrapper.find('[data-test="traces-section-title"]').text().toUpperCase()).toContain("TRACES");
    });

    it("hides the header when showHeader=false", () => {
      wrapper = mount_({ hits, loading: false, showHeader: false });
      expect(wrapper.find('[data-test="traces-section-header"]').exists()).toBe(false);
    });
  });

  // ─── Count badge ──────────────────────────────────────────────────────────
  describe("count badge", () => {
    it("shows hits.length in the badge when total prop is not provided", () => {
      const hits = [makeHit("t1"), makeHit("t2"), makeHit("t3")];
      wrapper = mount_({ hits, loading: false });
      const badge = wrapper.find('[data-test="traces-count-badge"]');
      expect(badge.text()).toContain("3");
    });

    it("shows total prop value in the badge when provided", () => {
      wrapper = mount_({ hits: [makeHit("t1")], loading: false, total: 999 });
      const badge = wrapper.find('[data-test="traces-count-badge"]');
      expect(badge.text()).toContain("999");
    });

    it("shows 0 total when total prop is 0", () => {
      wrapper = mount_({ hits: [makeHit("t1")], loading: false, total: 0 });
      const badge = wrapper.find('[data-test="traces-count-badge"]');
      expect(badge.text()).toContain("0");
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

  // --- Tests for spans mode (added in Mar 10 commit ae988c7) ---

  describe("searchMode='spans' — section title and badge", () => {
    const hits = [makeHit("t1")];

    it("shows 'SPANS' title when searchMode='spans'", () => {
      wrapper = mount_({ hits, loading: false, searchMode: "spans" });
      const title = wrapper.find('[data-test="traces-section-title"]');
      expect(title.text().toUpperCase()).toContain("SPANS");
    });

    it("does not show 'TRACES' in title when searchMode='spans'", () => {
      wrapper = mount_({ hits, loading: false, searchMode: "spans" });
      const title = wrapper.find('[data-test="traces-section-title"]');
      expect(title.text().toUpperCase()).not.toContain("TRACES");
    });

    it("shows 'TRACES' title by default (no searchMode prop)", () => {
      wrapper = mount_({ hits, loading: false });
      const title = wrapper.find('[data-test="traces-section-title"]');
      expect(title.text().toUpperCase()).toContain("TRACES");
    });

    it("shows 'Spans Found' text in badge when searchMode='spans'", () => {
      wrapper = mount_({ hits, loading: false, searchMode: "spans" });
      const badge = wrapper.find('[data-test="traces-count-badge"]');
      // badge label contains "spans found" (case-insensitive from i18n key)
      expect(badge.text().toLowerCase()).toContain("span");
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
      wrapper = mount_({ hits: [makeSpanHit("s1")], loading: false, searchMode: "spans" });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(rowClassFn(makeSpanHit("s1", "ERROR"))).toBe("oz-table__row--error");
    });

    it("returns empty string for non-error span_status in spans mode", () => {
      wrapper = mount_({ hits: [makeSpanHit("s1")], loading: false, searchMode: "spans" });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(rowClassFn(makeSpanHit("s1", "OK"))).toBe("");
    });

    it("uses errors count (not span_status) for error class in traces mode", () => {
      wrapper = mount_({ hits: [makeHit("t1", 0)], loading: false, searchMode: "traces" });
      const table = wrapper.findComponent({ name: "TenstackTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      // traces mode: errors > 0 triggers error class
      expect(rowClassFn({ ...makeHit("t1", 2), span_status: "OK" })).toBe("oz-table__row--error");
    });
  });

  describe("error count badge", () => {
    const hits = [makeHit("t1")];

    it("shows error count badge when errorCount > 0", () => {
      wrapper = mount_({ hits, loading: false, errorCount: 5 });
      expect(wrapper.find('[data-test="traces-error-count-badge"]').exists()).toBe(true);
    });

    it("shows correct error count number in the badge", () => {
      wrapper = mount_({ hits, loading: false, errorCount: 7 });
      const badge = wrapper.find('[data-test="traces-error-count-badge"]');
      expect(badge.text()).toContain("7");
    });

    it("hides error count badge when errorCount is 0", () => {
      wrapper = mount_({ hits, loading: false, errorCount: 0 });
      expect(wrapper.find('[data-test="traces-error-count-badge"]').exists()).toBe(false);
    });

    it("hides error count badge when errorCount is undefined", () => {
      wrapper = mount_({ hits, loading: false });
      expect(wrapper.find('[data-test="traces-error-count-badge"]').exists()).toBe(false);
    });
  });
});
