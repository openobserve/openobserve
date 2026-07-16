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
  template: `<div class="o-table" @click="$emit('row-click', { run_id: 'r-clicked' })" />`,
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
});
