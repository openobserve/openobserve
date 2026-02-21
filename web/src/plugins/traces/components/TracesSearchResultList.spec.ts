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

// Stub heavy child components — cell rendering is not under test here
vi.mock("@/components/traces/TracesTable.vue", () => ({
  default: {
    name: "TracesTable",
    props: ["columns", "rows", "rowClass"],
    emits: ["row-click", "load-more"],
    template: `<div data-test="stub-traces-table"><slot name="empty" /></div>`,
  },
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

  const mount_ = (props: Record<string, any>) =>
    mount(TracesSearchResultList, {
      props,
      global: { plugins: [i18n] },
    });

  // ─── Loading state ────────────────────────────────────────────────────────
  describe("loading state", () => {
    it("shows a spinner while loading", () => {
      wrapper = mount_({ hits: [], loading: true });
      expect(wrapper.findComponent({ name: "QSpinnerHourglass" }).exists()).toBe(true);
    });

    it("hides the table wrapper while loading", () => {
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
      const table = wrapper.findComponent({ name: "TracesTable" });
      await table.vm.$emit("row-click", hits[0]);
      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")![0]).toEqual([hits[0]]);
    });

    it("re-emits load-more from TracesTable", async () => {
      const hits = [makeHit("t1")];
      wrapper = mount_({ hits, loading: false });
      const table = wrapper.findComponent({ name: "TracesTable" });
      await table.vm.$emit("load-more");
      expect(wrapper.emitted("load-more")).toBeTruthy();
    });
  });

  // ─── Row error class ──────────────────────────────────────────────────────
  describe("row error class", () => {
    it("passes a rowClass function to TracesTable", () => {
      wrapper = mount_({ hits: [makeHit("t1")], loading: false });
      const table = wrapper.findComponent({ name: "TracesTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(typeof rowClassFn).toBe("function");
    });

    it("returns 'oz-table__row--error' for rows with errors", () => {
      wrapper = mount_({ hits: [makeHit("t1", 2)], loading: false });
      const table = wrapper.findComponent({ name: "TracesTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(rowClassFn(makeHit("t1", 2))).toBe("oz-table__row--error");
    });

    it("returns empty string for rows without errors", () => {
      wrapper = mount_({ hits: [makeHit("t1", 0)], loading: false });
      const table = wrapper.findComponent({ name: "TracesTable" });
      const rowClassFn = table.props("rowClass") as (row: any) => string;
      expect(rowClassFn(makeHit("t1", 0))).toBe("");
    });
  });
});
