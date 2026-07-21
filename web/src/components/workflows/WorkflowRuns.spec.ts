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

// WorkflowRuns — the dedicated READ-ONLY run-inspection surface (master-detail).
// Contract tested: it locks the canvas read-only for its lifetime, hydrates on a
// cold load, loads a selected run and deep-links it (?run_id), and keeps edit vs
// inspect separate (Edit Workflow -> editor route; back -> list). The canvas /
// panel / result drawer are stubbed.

import { vi } from "vitest";

const { mockRouter, mockToast, mockHydrate, mockLoadRun, mockReset, workflowObj, listWorkflows } =
  vi.hoisted(() => {
    const workflowObj: any = {
      readOnly: false,
      currentSelectedWorkflow: { id: "", name: "", nodes: [], edges: [] },
      testRun: { resultDrawer: { show: false, nodeId: "" }, result: null },
    };
    return {
      mockRouter: {
        push: vi.fn(),
        replace: vi.fn(),
        currentRoute: { value: { query: {} as Record<string, any> } },
      },
      mockToast: vi.fn(),
      mockHydrate: vi.fn(),
      mockLoadRun: vi.fn().mockResolvedValue({ ok: true }),
      mockReset: vi.fn(),
      workflowObj,
      listWorkflows: vi.fn().mockResolvedValue({ data: [] }),
    };
  });

vi.mock("vue-router", () => ({ useRouter: () => mockRouter }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));
vi.mock("@/services/workflows", () => ({
  default: { listWorkflows: (...a: any[]) => listWorkflows(...a) },
}));
vi.mock("@/plugins/workflows/useWorkflowCanvas", () => ({
  default: () => ({ resetWorkflowData: mockReset }),
  workflowObj,
  hydrateWorkflow: (...a: any[]) => mockHydrate(...a),
  loadWorkflowRun: (...a: any[]) => mockLoadRun(...a),
}));

import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowRuns from "./WorkflowRuns.vue";

const OPageHeaderStub = {
  name: "OPageHeader",
  props: ["title", "back"],
  template: `<div class="page-header">
    <button class="back-btn" @click="back && back.onClick && back.onClick()" />
    <slot name="actions" />
  </div>`,
};
const OButtonStub = {
  name: "OButton",
  props: ["variant"],
  emits: ["click"],
  template: `<button class="o-btn" @click="$emit('click')"><slot /></button>`,
};
const RunsPanelStub = {
  name: "WorkflowRunsPanel",
  props: ["orgId", "workflowId", "workflowName", "selectedRunId"],
  emits: ["select-run"],
  template: `<div class="runs-panel" />`,
};
const stub = (name: string) => ({ name, template: `<div class="${name}" />` });

const globalCfg = {
  plugins: [i18n, store],
  stubs: {
    OPageHeader: OPageHeaderStub,
    OButton: OButtonStub,
    WorkflowRunsPanel: RunsPanelStub,
    WorkflowCanvas: stub("WorkflowCanvas"),
    WorkflowStepResultDrawer: stub("WorkflowStepResultDrawer"),
  },
};

const mountRuns = async (query: Record<string, any> = { id: "wf-1" }) => {
  mockRouter.currentRoute.value = { query };
  const wrapper = mount(WorkflowRuns, { global: globalCfg });
  await flushPromises();
  return wrapper;
};

const panel = (w: any) => w.findComponent(RunsPanelStub as any);

describe("WorkflowRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkflows.mockResolvedValue({ data: [] });
    mockLoadRun.mockResolvedValue({ ok: true });
    workflowObj.readOnly = false;
    workflowObj.currentSelectedWorkflow = {
      id: "wf-1",
      name: "my flow",
      nodes: [],
      edges: [],
    };
  });

  it("locks the canvas read-only for its lifetime and restores on unmount", async () => {
    const wrapper = await mountRuns();
    expect(workflowObj.readOnly).toBe(true);

    wrapper.unmount();
    expect(workflowObj.readOnly).toBe(false);
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("skips a re-fetch when the workflow is already hydrated", async () => {
    await mountRuns({ id: "wf-1" });
    expect(listWorkflows).not.toHaveBeenCalled();
    expect(mockHydrate).not.toHaveBeenCalled();
  });

  it("hydrates on a cold load (deep link / refresh)", async () => {
    workflowObj.currentSelectedWorkflow = {
      id: "",
      name: "",
      nodes: [],
      edges: [],
    };
    listWorkflows.mockResolvedValue({
      data: [{ id: "wf-1", name: "my flow" }],
    });
    await mountRuns({ id: "wf-1" });
    expect(listWorkflows).toHaveBeenCalledTimes(1);
    expect(mockHydrate).toHaveBeenCalledWith({ id: "wf-1", name: "my flow" });
  });

  it("loads a selected run, deep-links it, and marks it selected", async () => {
    const wrapper = await mountRuns();

    panel(wrapper).vm.$emit("select-run", "run-5");
    await flushPromises();

    expect(mockLoadRun).toHaveBeenCalledWith({
      orgId: "default",
      workflowId: "wf-1",
      runId: "run-5",
    });
    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "workflowRuns",
        query: expect.objectContaining({ run_id: "run-5" }),
      }),
    );
    expect(panel(wrapper).props("selectedRunId")).toBe("run-5");
  });

  it("loads the deep-linked run on mount when ?run_id is present", async () => {
    await mountRuns({ id: "wf-1", run_id: "run-7" });
    expect(mockLoadRun).toHaveBeenCalledWith({
      orgId: "default",
      workflowId: "wf-1",
      runId: "run-7",
    });
  });

  it("toasts and does not select the run when the load fails", async () => {
    mockLoadRun.mockResolvedValue({ ok: false, error: "gone" });
    const wrapper = await mountRuns();

    panel(wrapper).vm.$emit("select-run", "run-5");
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith({ message: "gone", variant: "error" });
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect(panel(wrapper).props("selectedRunId")).toBe("");
  });

  it("Edit Workflow navigates to the editor (edit stays separate from inspect)", async () => {
    const wrapper = await mountRuns();
    await wrapper.find(".o-btn").trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "workflowEditor",
      query: { id: "wf-1", name: "my flow", org_identifier: "default" },
    });
  });

  it("back returns to the workflows list", async () => {
    const wrapper = await mountRuns();
    await wrapper.find(".back-btn").trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "workflows",
      query: { org_identifier: "default" },
    });
  });
});
