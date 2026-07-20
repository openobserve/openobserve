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

// WorkflowRunsPanel — the persistent runs list of the master-detail Runs view.
// Contract tested: a row click emits `select-run` with that run's id, and the
// currently-loaded run (`selectedRunId`) is highlighted via rowClass. The heavy
// children (OTable, DateTime, timeline) are stubbed; the run-click wiring and the
// highlight function are what matter.

import { vi } from "vitest";

const { mockList, mockToast } = vi.hoisted(() => ({
  mockList: vi.fn().mockResolvedValue({ data: [] }),
  mockToast: vi.fn(),
}));

vi.mock("@/services/workflows", () => ({
  default: { getWorkflowHistory: (...a: any[]) => mockList(...a) },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));

// OTable stub: exposes the data/columns/rowClass it received and re-emits
// row-click, so the run-click wiring can be driven without the real grid.
const OTableStub = {
  name: "OTable",
  props: [
    "data",
    "columns",
    "rowKey",
    "rowClass",
    "pageSize",
    "pageSizeOptions",
    "loading",
    "showGlobalFilter",
    "defaultColumns",
    "footerTitle",
    "showIndex",
    "enableColumnResize",
    "sortBy",
    "sortOrder",
    "width",
  ],
  emits: ["row-click"],
  // Renders the #empty slot when there are no rows, like the real OTable —
  // without this the empty/error branch is never mounted and assertions on it
  // silently pass against nothing.
  template: `<div class="o-table" @click="$emit('row-click', { run_id: 'r-clicked' })">
    <slot name="empty" v-if="!data || data.length === 0" />
  </div>`,
};
const stub = (name: string, props: string[] = []) => ({
  name,
  props,
  template: `<div class="${name}" />`,
});

import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowRunsPanel from "./WorkflowRunsPanel.vue";

const globalCfg = {
  plugins: [i18n, store],
  stubs: {
    OTable: OTableStub,
    OTimeCell: stub("OTimeCell", ["value", "unit", "mode", "timezone", "emptyLabel"]),
    OBadge: stub("OBadge", ["variant", "size"]),
    OButton: stub("OButton", ["variant", "size", "iconLeft", "loading"]),
    OTooltip: stub("OTooltip", ["side", "content"]),
    DateTime: stub("DateTime"),
    WorkflowExecutionTimeline: stub("WorkflowExecutionTimeline", [
      "history",
      "firingLabel",
      "okLabel",
    ]),
    NoData: stub("NoData"),
    OEmptyState: stub("OEmptyState", ["preset", "filtered"]),
  },
};

const mountPanel = (props: Record<string, any> = {}) =>
  mount(WorkflowRunsPanel, {
    props: { orgId: "default", workflowId: "wf-1", ...props },
    global: globalCfg,
  });

describe("WorkflowRunsPanel", () => {
  beforeEach(() => {
    mockList.mockClear();
    mockToast.mockClear();
  });

  it("renders the runs table", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.findComponent(OTableStub as any).exists()).toBe(true);
  });

  it("emits select-run with the clicked run's id", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.findComponent(OTableStub as any).trigger("click");

    expect(wrapper.emitted("select-run")?.[0]).toEqual(["r-clicked"]);
  });

  it("highlights the selected run row via rowClass", async () => {
    const wrapper = mountPanel({ selectedRunId: "run-2" });
    await flushPromises();
    const rowClass = wrapper
      .findComponent(OTableStub as any)
      .props("rowClass") as (row: any) => string;

    expect(rowClass({ run_id: "run-2" })).toBe("bg-select-item-hover-bg!");
    expect(rowClass({ run_id: "run-9" })).toBe("");
  });

  it("shows the workflow name as a sub-label when provided", async () => {
    const wrapper = mountPanel({ workflowName: "my flow" });
    await flushPromises();
    expect(wrapper.text()).toContain("my flow");
  });

  describe("fetchHistory error handling", () => {
    it("stays silent on a 403 (no toast) and empties the list", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 403 } });
      const w = mountPanel();
      await flushPromises();
      expect(mockToast).not.toHaveBeenCalled();
      expect(w.findComponent(OTableStub as any).props("data")).toEqual([]);
    });

    it("toasts an error on a non-403 failure and empties the list", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 500 } });
      const w = mountPanel();
      await flushPromises();
      expect(mockToast).toHaveBeenCalledTimes(1);
      expect(mockToast.mock.calls[0][0]).toMatchObject({ variant: "error" });
      expect(w.findComponent(OTableStub as any).props("data")).toEqual([]);
    });

    it("does not fetch when workflowId is missing", async () => {
      mockList.mockClear();
      mountPanel({ workflowId: "" });
      await flushPromises();
      expect(mockList).not.toHaveBeenCalled();
    });
  });

  // ── duration formatting (i18n) ─────────────────────────────────────────────
  // The h/m/s suffixes used to be concatenated in JS. They now go through t(),
  // so a locale can relabel/reorder them; these pin the rendered output.
  describe("formatDuration", () => {
    const fmt = (w: any, us: number) => (w.vm as any).formatDuration(us);

    it("renders each magnitude via i18n", async () => {
      const w = mountPanel();
      await flushPromises();
      expect(fmt(w, 0)).toBe("0s");
      expect(fmt(w, -5)).toBe("0s");
      expect(fmt(w, 45 * 1_000_000)).toBe("45s");
      expect(fmt(w, (5 * 60 + 30) * 1_000_000)).toBe("5m 30s");
      expect(fmt(w, (2 * 3600 + 5 * 60) * 1_000_000)).toBe("2h 5m");
    });

    it("does not leak a raw i18n key when a locale lookup is used", async () => {
      const w = mountPanel();
      await flushPromises();
      expect(fmt(w, 90 * 1_000_000)).not.toContain("workflow.history");
    });
  });

  // ── error state vs empty state ─────────────────────────────────────────────
  // A failed fetch used to fall through to <NoData />, so "request failed" and
  // "never run" were indistinguishable and there was no retry affordance.
  describe("load error is distinct from empty", () => {
    const emptyState = (w: any) => w.findComponent({ name: "OEmptyState" });

    it("shows the retryable error state when the fetch fails", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 500 } });
      const w = mountPanel();
      await flushPromises();
      expect(emptyState(w).exists()).toBe(true);
      expect(emptyState(w).props("preset")).toBe("load-error");
      expect(w.findComponent({ name: "NoData" }).exists()).toBe(false);
    });

    it("shows the plain empty state when the fetch succeeds with no runs", async () => {
      mockList.mockResolvedValueOnce({ data: [] });
      const w = mountPanel();
      await flushPromises();
      expect(w.findComponent({ name: "NoData" }).exists()).toBe(true);
      expect(emptyState(w).exists()).toBe(false);
    });

    it("treats 403 as empty, not an error — retrying cannot help", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 403 } });
      const w = mountPanel();
      await flushPromises();
      expect(emptyState(w).exists()).toBe(false);
      expect(w.findComponent({ name: "NoData" }).exists()).toBe(true);
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("clears the error once a later fetch succeeds", async () => {
      mockList.mockRejectedValueOnce({ response: { status: 500 } });
      const w = mountPanel();
      await flushPromises();
      expect(emptyState(w).exists()).toBe(true);

      mockList.mockResolvedValueOnce({ data: [] });
      await w.find('[data-test="workflow-runs-refresh"]').trigger("click");
      await flushPromises();
      expect(emptyState(w).exists()).toBe(false);
    });
  });
});
