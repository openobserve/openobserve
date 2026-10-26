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

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const {
  mockRouter,
  mockToast,
  mockHydrate,
  mockLoadRun,
  mockRetry,
  mockReset,
  workflowObj,
  listWorkflows,
} = vi.hoisted(() => {
  const workflowObj: any = {
    readOnly: false,
    currentSelectedWorkflow: { id: "", name: "", nodes: [], edges: [] },
    testRun: { resultDrawer: { show: false, nodeId: "" }, result: null },
    // The NDV now renders inside this view, so the template reads dialog.show.
    dialog: { show: false, name: "", expand: false },
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
    mockRetry: vi.fn().mockResolvedValue({ ok: true }),
    mockReset: vi.fn(),
    workflowObj,
    listWorkflows: vi.fn().mockResolvedValue({ data: [] }),
  };
});

vi.mock("vue-router", () => ({ useRouter: () => mockRouter }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));
vi.mock("@/services/workflows", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { listWorkflows: (...a: any[]) => listWorkflows(...a) },
  });
});
vi.mock("@/plugins/workflows/useWorkflowCanvas", () => ({
  default: () => ({ resetWorkflowData: mockReset }),
  workflowObj,
  hydrateWorkflow: (...a: any[]) => mockHydrate(...a),
  loadWorkflowRun: (...a: any[]) => mockLoadRun(...a),
  retryWorkflowRun: (...a: any[]) => mockRetry(...a),
  isRetryableRun: (run: any) =>
    !!run && !!run.error && run.event_type !== "Test" && run.event_type !== "Retry",
  currentTriggerKind: () => "alert_fired",
  currentTriggerNodeId: () => "t1",
}));

import { mount, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowRuns from "./WorkflowRuns.vue";
import workflowService from "@/services/workflows";
import { queryClient } from "@/composables/query/queryClient";
import { httpConfig } from "@/test/unit/helpers/workflowHttp";

const OPageHeaderStub = {
  name: "OPageHeader",
  props: ["title", "back"],
  template: `<div class="page-header">
    <button class="back-btn" @click="back && back.onClick && back.onClick()" />
    <slot name="actions-overflow" />
    <slot name="actions" />
  </div>`,
};
const OButtonStub = {
  name: "OButton",
  props: ["variant"],
  emits: ["click"],
  template: `<button class="o-btn" v-bind="$attrs" @click="$emit('click')"><slot /></button>`,
};
const RunsPanelStub = {
  name: "WorkflowRunsPanel",
  props: ["orgId", "workflowId", "workflowName", "selectedRunId", "triggerFilter"],
  emits: ["select-run", "update:triggerFilter"],
  template: `<div class="runs-panel" />`,
};
const stub = (name: string) => ({ name, template: `<div class="${name}" />` });

const globalCfg = {
  plugins: [i18n, store],
  stubs: {
    OPageHeader: OPageHeaderStub,
    OButton: OButtonStub,
    WorkflowRunsPanel: RunsPanelStub,
    // The dock wraps the canvas (its default slot) — render the slot so the
    // canvas stub still mounts.
    WorkflowResultsDock: {
      name: "WorkflowResultsDock",
      template: `<div class="WorkflowResultsDock"><slot /></div>`,
    },
    WorkflowCanvas: stub("WorkflowCanvas"),
    WorkflowTestDialog: {
      name: "WorkflowTestDialog",
      props: ["seed", "payloadFrom", "seedRunAt"],
      template: `<div class="WorkflowTestDialog" />`,
    },
    WorkflowHttpEndpointPanel: {
      name: "WorkflowHttpEndpointPanel",
      props: [
        "open",
        "workflowId",
        "workflowName",
        "kind",
        "isDraftOnly",
        "workflowEnabled",
        "context",
        "beforeCreate",
        "triggerNodeId",
      ],
      emits: ["update:open", "run-test"],
      template: `<div class="WorkflowHttpEndpointPanel" />`,
    },
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

  // The panel is a fixed 27.5rem of a master-detail page, so with no collapse control
  // the canvas can never be seen whole.
  it("collapses the runs panel so the canvas can be seen in full", async () => {
    const wrapper = await mountRuns();
    const toggle = wrapper.find('[data-test="workflow-runs-panel-collapse"]');
    expect(toggle.exists()).toBe(true);
    expect(wrapper.find('[data-test="workflow-runs-panel"]').exists()).toBe(true);

    await toggle.trigger("click");
    expect(wrapper.find('[data-test="workflow-runs-panel"]').exists()).toBe(false);

    await wrapper.find('[data-test="workflow-runs-panel-collapse"]').trigger("click");
    expect(wrapper.find('[data-test="workflow-runs-panel"]').exists()).toBe(true);
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

  it("Edit Workflow navigates to the editor (build stays separate from inspect)", async () => {
    const wrapper = await mountRuns();
    await wrapper.find('[data-test="workflow-runs-edit"]').trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "workflowEditor",
      query: { id: "wf-1", name: "my flow", org_identifier: "default", folder: "default" },
    });
  });

  // ── Debug In Editor ────────────────────────────────────────────────────────
  // The pair to Edit Workflow: same destination, but the selected run travels
  // with it so the editor repaints the whole run and stays editable. Whole-graph
  // counterpart to the NDV's per-step "Fix This Step".

  it("hides Debug In Editor until a run is selected", async () => {
    const wrapper = await mountRuns();
    expect(wrapper.find('[data-test="workflow-runs-debug"]').exists()).toBe(false);
  });

  it("offers Debug In Editor once a run is selected", async () => {
    const wrapper = await mountRuns();
    panel(wrapper).vm.$emit("select-run", "run-5");
    await flushPromises();
    expect(wrapper.find('[data-test="workflow-runs-debug"]').exists()).toBe(true);
  });

  it("Debug In Editor carries the selected run to the editor", async () => {
    const wrapper = await mountRuns();
    panel(wrapper).vm.$emit("select-run", "run-5");
    await flushPromises();

    await wrapper.find('[data-test="workflow-runs-debug"]').trigger("click");

    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "workflowEditor",
      query: {
        id: "wf-1",
        name: "my flow",
        org_identifier: "default",
        run_id: "run-5",
        folder: "default",
      },
    });
  });

  // The two verbs must stay distinct: "go build" must not silently arrive with a
  // past run's badges painted on the canvas.
  it("Edit Workflow still leaves the run behind even when one is selected", async () => {
    const wrapper = await mountRuns();
    panel(wrapper).vm.$emit("select-run", "run-5");
    await flushPromises();

    await wrapper.find('[data-test="workflow-runs-edit"]').trigger("click");

    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "workflowEditor",
      query: { id: "wf-1", name: "my flow", org_identifier: "default", folder: "default" },
    });
  });

  it("Test opens the dry-run dialog here and deselects the historical run", async () => {
    const wrapper = await mountRuns();
    // Select a run first, so we can prove Test deselects it.
    panel(wrapper).vm.$emit("select-run", "run-5");
    await flushPromises();
    expect(panel(wrapper).props("selectedRunId")).toBe("run-5");

    workflowObj.testRun.show = false;
    await wrapper.find('[data-test="workflow-runs-test"]').trigger("click");

    expect(workflowObj.testRun.show).toBe(true);
    expect(panel(wrapper).props("selectedRunId")).toBe("");
    // Test never navigates away — it stays on the runs page.
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("gives the runs panel one static width whatever the filter", async () => {
    const wrapper = await mountRuns();
    const box = () => wrapper.find('[data-test="workflow-runs-panel"]').classes();
    const before = box();
    expect(before).toEqual(expect.arrayContaining(["w-[50rem]", "max-w-[60%]", "max-lg:w-full"]));
    panel(wrapper).vm.$emit("update:triggerFilter", "http_request");
    await flushPromises();
    expect(box()).toEqual(before);
    panel(wrapper).vm.$emit("update:triggerFilter", "alert_fired");
    await flushPromises();
    expect(box()).toEqual(before);
  });

  it("back returns to the workflows list", async () => {
    const wrapper = await mountRuns();
    await wrapper.find(".back-btn").trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "workflows",
      query: { org_identifier: "default", folder: "default" },
    });
  });
});

// ── Retry the loaded run ─────────────────────────────────────────────────────
// The Runs view already has the failed run open and inspected node-by-node, so
// "re-run this" belongs in the header next to Debug In Editor. It appears only
// when the loaded run is one the backend can actually replay.
describe("WorkflowRuns — retry the loaded run", () => {
  const RETRY = '[data-test="workflow-runs-retry"]';

  const loadRun = async (run: any) => {
    workflowObj.runsHistory = { list: [run], fetchedAt: 0, params: {}, loading: false };
    const wrapper = await mountRuns({ id: "wf-1", run_id: run.run_id });
    await flushPromises();
    return wrapper;
  };

  beforeEach(() => {
    mockRetry.mockClear();
    mockRetry.mockResolvedValue({ ok: true });
    mockToast.mockClear();
  });

  it("offers retry for a loaded failed run from a real trigger", async () => {
    const w = await loadRun({ run_id: "r-1", error: "boom", event_type: "AlertFired" });
    expect(w.find(RETRY).exists()).toBe(true);
  });

  it("does NOT offer retry for a loaded TEST run", async () => {
    const w = await loadRun({ run_id: "r-1", error: "boom", event_type: "Test" });
    expect(w.find(RETRY).exists()).toBe(false);
  });

  it("does NOT offer retry for a loaded RETRY run", async () => {
    const w = await loadRun({ run_id: "r-1", error: "boom", event_type: "Retry" });
    expect(w.find(RETRY).exists()).toBe(false);
  });

  it("does NOT offer retry when no run is loaded", async () => {
    workflowObj.runsHistory = { list: [], fetchedAt: 0, params: {}, loading: false };
    const w = await mountRuns({ id: "wf-1" });
    expect(w.find(RETRY).exists()).toBe(false);
  });

  it("retries the loaded run and reports it started", async () => {
    const w = await loadRun({ run_id: "r-1", error: "boom", event_type: "AlertFired" });
    await w.find(RETRY).trigger("click");
    await flushPromises();
    expect(mockRetry).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-1", runId: "r-1" }),
    );
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("surfaces a refusal from the backend", async () => {
    mockRetry.mockResolvedValue({ ok: false, error: "Errored run info not found" });
    const w = await loadRun({ run_id: "r-1", error: "boom", event_type: "AlertFired" });
    await w.find(RETRY).trigger("click");
    await flushPromises();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});

describe("WorkflowRuns — HTTP endpoint", () => {
  const getHttpTrigger = vi.mocked(workflowService.getHttpTrigger);
  const button = (w: any) => w.find('[data-test="workflow-runs-http-endpoint"]');
  const chip = (w: any) => w.find('[data-test="workflow-runs-http-endpoint-chip"]');
  const chipVariant = (w: any) =>
    w
      .findAllComponents({ name: "OTag" })
      .find((c: any) => c.find('[data-test="workflow-runs-http-endpoint-chip"]').exists())
      ?.props("variant");
  const httpPanel = (w: any) => w.findComponent({ name: "WorkflowHttpEndpointPanel" });

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    listWorkflows.mockResolvedValue({ data: [] });
    mockLoadRun.mockResolvedValue({ ok: true });
    getHttpTrigger.mockResolvedValue(httpConfig());
    store.state.zoConfig = { ...store.state.zoConfig, workflow_hooks_enabled: true };
    workflowObj.readOnly = false;
    workflowObj.testRun = { resultDrawer: { show: false, nodeId: "" }, result: null, show: false };
    workflowObj.currentSelectedWorkflow = {
      id: "wf-1",
      name: "my flow",
      nodes: [],
      edges: [],
      enabled: true,
    };
  });
  afterEach(() => {
    store.state.zoConfig = { ...store.state.zoConfig, workflow_hooks_enabled: false };
  });

  it("shows the button on the read-only page, just before Test, with the live chip", async () => {
    const wrapper = await mountRuns();
    expect(workflowObj.readOnly).toBe(true);
    expect(button(wrapper).text()).toContain(i18n.global.t("workflow.http.editorButton"));
    expect(chipVariant(wrapper)).toBe("success-soft");
    const html = wrapper.html();
    const at = (id: string) => html.indexOf(`data-test="${id}"`);
    expect(at("workflow-runs-http-endpoint")).toBeLessThan(at("workflow-runs-test"));
    expect(at("workflow-runs-test")).toBeLessThan(at("workflow-runs-edit"));
    wrapper.unmount();
  });

  it("shows the neutral Off chip for an endpoint that is switched off", async () => {
    getHttpTrigger.mockResolvedValue(httpConfig({ enabled: false }));
    const wrapper = await mountRuns();
    expect(chipVariant(wrapper)).toBe("default-soft");
    expect(chip(wrapper).text()).toBe(i18n.global.t("workflow.http.editorButtonOff"));
    wrapper.unmount();
  });

  it("shows a paused workflow's live endpoint as a warning", async () => {
    workflowObj.currentSelectedWorkflow.enabled = false;
    const wrapper = await mountRuns();
    expect(chipVariant(wrapper)).toBe("warning-soft");
    wrapper.unmount();
  });

  it("has no button or panel while HTTP endpoints are disabled for the org", async () => {
    store.state.zoConfig = { ...store.state.zoConfig, workflow_hooks_enabled: false };
    // Pages the earlier suites never unmounted fetch when beforeEach turns the flag on.
    await flushPromises();
    getHttpTrigger.mockClear();
    const wrapper = await mountRuns();
    expect(button(wrapper).exists()).toBe(false);
    expect(httpPanel(wrapper).exists()).toBe(false);
    expect(getHttpTrigger).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("opens the panel with this page's workflow in the editor context", async () => {
    const wrapper = await mountRuns();
    expect(httpPanel(wrapper).props("open")).toBe(false);
    await button(wrapper).trigger("click");
    expect(httpPanel(wrapper).props()).toMatchObject({
      open: true,
      workflowId: "wf-1",
      workflowName: "my flow",
      kind: "alert_fired",
      isDraftOnly: false,
      workflowEnabled: true,
      context: "editor",
      triggerNodeId: "t1",
    });
    await httpPanel(wrapper).vm.$emit("update:open", false);
    expect(httpPanel(wrapper).props("open")).toBe(false);
    wrapper.unmount();
  });

  it("Run test closes the panel, clears the selected run and opens a seeded Test dialog", async () => {
    const wrapper = await mountRuns();
    panel(wrapper).vm.$emit("select-run", "run-5");
    await flushPromises();
    expect(panel(wrapper).props("selectedRunId")).toBe("run-5");
    await button(wrapper).trigger("click");

    const seed = [{ meta: { trigger_source: "http", trigger_id: "test" }, data: [] }];
    await httpPanel(wrapper).vm.$emit("run-test", seed, 42);
    await flushPromises();

    expect(httpPanel(wrapper).props("open")).toBe(false);
    expect(panel(wrapper).props("selectedRunId")).toBe("");
    expect(workflowObj.testRun.show).toBe(true);
    const dialog = wrapper.findComponent({ name: "WorkflowTestDialog" });
    expect(dialog.props("seed")).toEqual(seed);
    expect(dialog.props("payloadFrom")).toBe("http");
    expect(dialog.props("seedRunAt")).toBe(42);
    wrapper.unmount();
  });
});
