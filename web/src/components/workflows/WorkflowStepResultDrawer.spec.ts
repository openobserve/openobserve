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

// WorkflowStepResultDrawer — the "Test Step Result" drawer. Opens for ANY node
// after a Test run. Input = the records THIS node received (from the backend
// per-node `inputs` map), editable + replayable. Output = what it emitted, derived
// per outgoing edge (child input == parent output on a single-incoming tree),
// rendered in a read-only editor. Errored nodes show the error AND what they still
// forwarded. Status badge = Passed / Errored / No Records. "Use as Test Input"
// promotes a pane's records to the whole-flow payload. History runs are read-only.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const t = (k: string, p?: any) => i18n.global.t(k, p);

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));

const mockCopy = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...a: any[]) => mockCopy(...a),
}));

const mockToggleFullscreen = vi.fn(() => Promise.resolve());
vi.mock("@/utils/dom", () => ({
  toggleFullscreen: (...a: any[]) => mockToggleFullscreen(...(a as [])),
}));

const mockTestWorkflow = vi.fn();
vi.mock("@/services/workflows", () => ({
  default: {
    testWorkflow: (...a: any[]) => mockTestWorkflow(...a),
    getWorkflowRun: vi.fn(),
  },
}));

import WorkflowStepResultDrawer from "./WorkflowStepResultDrawer.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";

// ── stubs ────────────────────────────────────────────────────────────────────
const ODrawerStub = {
  name: "ODrawer",
  props: ["open", "size", "title"],
  emits: ["update:open"],
  template: `
    <div class="o-drawer" :data-title="title">
      <button class="drawer-dismiss" @click="$emit('update:open', false)">x</button>
      <slot />
      <div class="drawer-footer"><slot name="footer" /></div>
    </div>`,
};
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading"],
  template: `<button :disabled="disabled" :data-loading="String(!!loading)"><slot /></button>`,
};
const OIconStub = {
  name: "OIcon",
  props: ["name", "size"],
  template: `<i class="o-icon" :data-icon="name" />`,
};
const OBadgeStub = {
  name: "OBadge",
  props: ["variant", "size"],
  template: `<span class="o-badge" :data-variant="variant"><slot /></span>`,
};
const OTooltipStub = {
  name: "OTooltip",
  props: ["content", "delay", "side"],
  template: `<div class="o-tooltip" :data-content="content"><slot /></div>`,
};
const CodeQueryEditorStub = {
  name: "CodeQueryEditor",
  props: ["editorId", "language", "query", "readOnly", "showAutoComplete"],
  emits: ["update:query"],
  template: `<div class="code-editor" :data-editor="editorId" :data-readonly="String(!!readOnly)">{{ query }}</div>`,
};

const globalConfig = {
  plugins: [i18n, store],
  stubs: {
    ODrawer: ODrawerStub,
    OButton: OButtonStub,
    OIcon: OIconStub,
    OBadge: OBadgeStub,
    OTooltip: OTooltipStub,
    CodeQueryEditor: CodeQueryEditorStub,
  },
};

// trigger(t1) -> function(f1) -> destination(d1)
const NODES = [
  { id: "t1", data: { node_type: "workflow_trigger" } },
  { id: "f1", data: { node_type: "function", name: "parse_json" } },
  { id: "d1", data: { node_type: "destination", destination_id: "sink-a" } },
];
const EDGES = [
  { source: "t1", target: "f1" },
  { source: "f1", target: "d1" },
];

// A trigger-shape record (nested { meta, data }).
const rec = (x: number) => ({ meta: { alert_name: "a" }, data: [{ x }] });

// Every node received records; nothing errored.
const okResult = () => ({
  errors: {},
  inputs: { t1: [rec(1)], f1: [rec(2)], d1: [rec(3)] },
  ranNodeIds: ["t1", "f1", "d1"],
  blockedNodeIds: [],
});

// f1 errored but still forwarded records to d1.
const errorResult = () => ({
  errors: { f1: { error_count: 2, errors: [["boom", [{ x: 1 }]], ["bad record"]] } },
  inputs: { t1: [rec(1)], f1: [rec(2)], d1: [rec(3)] },
  ranNodeIds: ["t1", "f1", "d1"],
  blockedNodeIds: ["d1"],
});

const setup = (
  opts: { nodeId?: string; input?: string; result?: any; nodes?: any[]; edges?: any[] } = {},
) => {
  workflowObj.currentSelectedWorkflow = {
    id: "wf1",
    name: "wf",
    nodes: opts.nodes ?? NODES,
    edges: opts.edges ?? EDGES,
  } as any;
  workflowObj.testRun = {
    show: false,
    input: opts.input ?? "",
    fromNode: "",
    result: opts.result === undefined ? okResult() : opts.result,
    resultDrawer: { show: true, nodeId: opts.nodeId ?? "f1" },
  } as any;
};

const mountDrawer = () =>
  mount(WorkflowStepResultDrawer, { global: globalConfig, attachTo: document.body });

const editors = (w: any) => w.findAllComponents(CodeQueryEditorStub as any);
const inputEditor = (w: any) =>
  editors(w).find((e: any) => e.props("editorId") === "workflow-step-input");
const outputEditor = (w: any) =>
  editors(w).find((e: any) => e.props("editorId") === "workflow-step-output");
const statusBadge = (w: any) => w.find('[data-test="workflow-step-result-status"]');
const replayBtn = (w: any) => w.find('[data-test="workflow-step-replay-btn"]');
const useInputBtn = (w: any) => w.find('[data-test="workflow-step-use-input-as-test"]');
const useOutputBtn = (w: any) => w.find('[data-test="workflow-step-use-output-as-test"]');
const tooltipFor = (w: any, content: string) =>
  w.findAll(".o-tooltip").find((tt: any) => tt.attributes("data-content") === content);

describe("WorkflowStepResultDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  describe("title", () => {
    it("shows '<Type> - <detail>' for the node", () => {
      expect(mountDrawer().find(".o-drawer").attributes("data-title")).toBe(
        `${t("workflow.node.function")} - parse_json`,
      );
    });

    it("truncates a long title at 30 chars with an ellipsis", () => {
      setup({
        nodeId: "f1",
        nodes: [
          {
            id: "f1",
            data: { node_type: "function", name: "a_really_long_vrl_function_name_here" },
          },
        ],
      });
      const title = mountDrawer().find(".o-drawer").attributes("data-title")!;
      expect(title).toHaveLength(31);
      expect(title.endsWith("…")).toBe(true);
    });

    it("falls back to the raw node_type when it is not in the palette", () => {
      setup({ nodeId: "x1", nodes: [{ id: "x1", data: { node_type: "mystery" } }], edges: [] });
      expect(mountDrawer().find(".o-drawer").attributes("data-title")).toBe("mystery");
    });

    it("renders an empty title when the node id no longer exists", () => {
      setup({ nodeId: "ghost" });
      expect(mountDrawer().find(".o-drawer").attributes("data-title")).toBe("");
    });
  });

  describe("status badge", () => {
    it("Passed (success) when records reached the node", () => {
      const badge = statusBadge(mountDrawer());
      expect(badge.attributes("data-variant")).toBe("success-soft");
      expect(badge.text()).toBe(t("workflow.test.stepResult.status.ok"));
    });

    it("Errored (error) when the node is in the errors map", () => {
      setup({ result: errorResult() });
      const badge = statusBadge(mountDrawer());
      expect(badge.attributes("data-variant")).toBe("error-soft");
      expect(badge.text()).toBe(t("workflow.test.stepResult.status.error"));
    });

    it("No Records (default) when the node ran but got nothing (absent from inputs)", () => {
      // d1 reachable but not in inputs -> the condition/function above filtered all.
      setup({
        nodeId: "d1",
        result: {
          errors: {},
          inputs: { t1: [rec(1)], f1: [rec(2)] },
          ranNodeIds: ["t1", "f1", "d1"],
          blockedNodeIds: [],
        },
      });
      const badge = statusBadge(mountDrawer());
      expect(badge.attributes("data-variant")).toBe("default-soft");
      expect(badge.text()).toBe(t("workflow.test.stepResult.status.skipped"));
    });
  });

  describe("input pane — the records this node received", () => {
    it("shows the node's own input, editable, in the editor", () => {
      const editor = inputEditor(mountDrawer());
      expect(editor.props("readOnly")).toBe(false);
      expect(JSON.parse(editor.props("query"))).toEqual([rec(2)]); // f1's input
    });

    it("seeds a DIFFERENT node's input (per-node, not a shared sample)", () => {
      setup({ nodeId: "t1" });
      expect(JSON.parse(inputEditor(mountDrawer()).props("query"))).toEqual([rec(1)]);
    });

    it("shows an empty state (not a blank editor) when 0 records reached the node", () => {
      setup({
        nodeId: "d1",
        result: {
          errors: {},
          inputs: { t1: [rec(1)], f1: [rec(2)] },
          ranNodeIds: ["t1", "f1", "d1"],
          blockedNodeIds: [],
        },
      });
      const wrapper = mountDrawer();
      expect(inputEditor(wrapper)).toBeUndefined(); // no input editor rendered
      expect(wrapper.find('[data-test="workflow-step-result-no-input"]').text()).toBe(
        t("workflow.test.stepResult.noInput"),
      );
    });

    it("unwraps a JSON-stringified `data` field for readability", () => {
      const flat = { meta_alert_name: "a", data: '[{"x":9}]' };
      setup({
        nodeId: "d1",
        result: { errors: {}, inputs: { d1: [flat] }, ranNodeIds: ["d1"], blockedNodeIds: [] },
        nodes: [{ id: "d1", data: { node_type: "destination", destination_id: "sink-a" } }],
        edges: [],
      });
      const parsed = JSON.parse(inputEditor(mountDrawer()).props("query"));
      expect(parsed[0].data).toEqual([{ x: 9 }]); // parsed, not the escaped string
    });
  });

  describe("output pane — what the node emitted (derived)", () => {
    it("single downstream: the records the child received, in a read-only editor", () => {
      const editor = outputEditor(mountDrawer());
      expect(editor.props("readOnly")).toBe(true);
      expect(JSON.parse(editor.props("query"))).toEqual([rec(3)]); // f1's output == d1's input
    });

    it("single downstream: NO caption (the target is obvious from the canvas)", () => {
      // f1 -> d1 (single). No "→ Destination · sink-a" line, no record count — just
      // the records in the editor.
      const wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-step-result-output-branch-label"]').exists()).toBe(
        false,
      );
      expect(outputEditor(wrapper)).toBeTruthy();
    });

    it("terminal (destination): shows the records it sent, with the 'sent externally' caption", () => {
      setup({ nodeId: "d1" });
      const wrapper = mountDrawer();
      expect(JSON.parse(outputEditor(wrapper).props("query"))).toEqual([rec(3)]);
      expect(wrapper.text()).toContain(t("workflow.test.stepResult.sentExternally"));
    });

    it("fan-out: one object keyed by '→ target' so each branch stays labelled", () => {
      // t1 -> f1 and t1 -> d1 (broadcast). Inspect t1's output.
      setup({
        nodeId: "t1",
        edges: [
          { source: "t1", target: "f1" },
          { source: "t1", target: "d1" },
        ],
        result: {
          errors: {},
          inputs: { t1: [rec(1)], f1: [rec(2)], d1: [rec(3)] },
          ranNodeIds: ["t1", "f1", "d1"],
          blockedNodeIds: [],
        },
      });
      const wrapper = mountDrawer();
      const out = JSON.parse(outputEditor(wrapper).props("query"));
      const keys = Object.keys(out);
      expect(keys).toHaveLength(2);
      expect(keys.every((k) => k.startsWith("→ "))).toBe(true);
      // fan-out DOES keep a caption per branch (to tell them apart)
      expect(
        wrapper.findAll('[data-test="workflow-step-result-output-branch-label"]'),
      ).toHaveLength(2);
    });

    it("errored node: shows the error message(s) AND the records it forwarded", () => {
      setup({ result: errorResult() });
      const wrapper = mountDrawer();
      const lines = wrapper.findAll('[data-test="workflow-step-result-error-line"]');
      expect(lines.map((l: any) => l.text())).toEqual(["boom", "bad record"]);
      // forwarded editor still present (f1 passed records to d1)
      expect(JSON.parse(outputEditor(wrapper).props("query"))).toEqual([rec(3)]);
      // both section headings shown
      expect(wrapper.text()).toContain(t("workflow.test.stepResult.errorHeading"));
      expect(wrapper.text()).toContain(t("workflow.test.stepResult.forwardedHeading"));
    });

    it("errored terminal: shows the error alone (a failed send has no output)", () => {
      setup({
        nodeId: "d1",
        result: {
          errors: { d1: { error_count: 1, errors: [["send failed"]] } },
          inputs: { d1: [rec(3)] },
          ranNodeIds: ["t1", "f1", "d1"],
          blockedNodeIds: [],
        },
      });
      const wrapper = mountDrawer();
      expect(wrapper.find('[data-test="workflow-step-result-error-line"]').text()).toBe(
        "send failed",
      );
      expect(outputEditor(wrapper)).toBeUndefined();
    });

    it("filtered non-terminal: centered empty state, no editor", () => {
      // f1 forwarded nothing to d1 -> f1's output is empty.
      setup({
        result: {
          errors: {},
          inputs: { t1: [rec(1)], f1: [rec(2)] },
          ranNodeIds: ["t1", "f1", "d1"],
          blockedNodeIds: [],
        },
      });
      const wrapper = mountDrawer();
      expect(outputEditor(wrapper)).toBeUndefined();
      expect(wrapper.find('[data-test="workflow-step-result-output-empty"]').exists()).toBe(true);
    });

    it("condition that matched nothing explains why in the empty state", () => {
      setup({
        nodeId: "c1",
        nodes: [
          { id: "c1", data: { node_type: "condition" } },
          { id: "d1", data: { node_type: "destination", destination_id: "s" } },
        ],
        edges: [{ source: "c1", target: "d1" }],
        result: {
          errors: {},
          inputs: { c1: [rec(1)] },
          ranNodeIds: ["c1", "d1"],
          blockedNodeIds: [],
        },
      });
      expect(mountDrawer().find('[data-test="workflow-step-result-output-empty"]').text()).toBe(
        t("workflow.test.stepResult.conditionNoMatch"),
      );
    });

    it("terminal with 0 records: 'nothing was sent', not a false send", () => {
      setup({
        nodeId: "d1",
        result: {
          errors: {},
          inputs: { t1: [rec(1)] },
          ranNodeIds: ["t1", "f1", "d1"],
          blockedNodeIds: [],
        },
      });
      expect(mountDrawer().find('[data-test="workflow-step-result-output-empty"]').text()).toBe(
        t("workflow.test.stepResult.destinationNoRecords"),
      );
    });
  });

  describe("use as test input", () => {
    it("Input: promotes the records to the flow payload and opens the Test dialog", async () => {
      const wrapper = mountDrawer();
      expect(useInputBtn(wrapper).attributes("disabled")).toBeUndefined();
      await useInputBtn(wrapper).trigger("click");
      expect(JSON.parse(workflowObj.testRun.input)).toEqual([rec(2)]); // f1's input
      expect(workflowObj.testRun.show).toBe(true);
      expect(workflowObj.testRun.resultDrawer.show).toBe(false);
    });

    it("Output: promotes what the node emitted", async () => {
      const wrapper = mountDrawer();
      await useOutputBtn(wrapper).trigger("click");
      expect(JSON.parse(workflowObj.testRun.input)).toEqual([rec(3)]); // f1's output
      expect(workflowObj.testRun.show).toBe(true);
    });

    it("disables + explains when the pane has no records", () => {
      // d1 got nothing -> both input and output empty.
      setup({
        nodeId: "d1",
        result: {
          errors: {},
          inputs: { t1: [rec(1)], f1: [rec(2)] },
          ranNodeIds: ["t1", "f1", "d1"],
          blockedNodeIds: [],
        },
      });
      const wrapper = mountDrawer();
      expect(useInputBtn(wrapper).attributes("disabled")).toBeDefined();
      expect(useOutputBtn(wrapper).attributes("disabled")).toBeDefined();
      expect(tooltipFor(wrapper, t("workflow.test.stepResult.useAsTestInputNoInput"))).toBeTruthy();
      expect(
        tooltipFor(wrapper, t("workflow.test.stepResult.useAsTestInputNoOutput")),
      ).toBeTruthy();
    });

    it("is ALSO available in history mode — it drops the user into a fresh test", async () => {
      setup({ result: okResult(), input: "" });
      workflowObj.testRun.result = { ...okResult(), mode: "history" } as any;
      workflowObj.testRun.show = false;
      const wrapper = mountDrawer();
      expect(useInputBtn(wrapper).exists()).toBe(true);
      expect(useOutputBtn(wrapper).exists()).toBe(true);

      await useInputBtn(wrapper).trigger("click");
      // seeds the flow payload with the historical node's input and opens the Test dialog
      expect(JSON.parse(workflowObj.testRun.input)).toEqual([rec(2)]);
      expect(workflowObj.testRun.show).toBe(true);
    });
  });

  describe("replay", () => {
    it("re-runs FROM this node with its (edited) input, then closes", async () => {
      mockTestWorkflow.mockResolvedValue({ data: { errors: {}, inputs: {} } });
      const wrapper = mountDrawer();
      expect(replayBtn(wrapper).attributes("disabled")).toBeUndefined();

      await replayBtn(wrapper).trigger("click");
      await flushPromises();

      expect(mockTestWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          org_identifier: "default",
          inputs: [rec(2)], // f1's own input, unwrapped
          from_node: "f1",
          workflow: expect.objectContaining({ id: "wf1" }),
        }),
      );
      expect(workflowObj.testRun.resultDrawer).toEqual({ show: false, nodeId: "" });
    });

    it("keeps the drawer open and toasts the backend message on failure", async () => {
      mockTestWorkflow.mockRejectedValue({ response: { data: { message: "vrl compile error" } } });
      const wrapper = mountDrawer();
      await replayBtn(wrapper).trigger("click");
      await flushPromises();
      expect(mockToast).toHaveBeenCalledWith({ message: "vrl compile error", variant: "error" });
      expect(workflowObj.testRun.resultDrawer.show).toBe(true);
    });

    it("falls back to the generic run error when the API gives no message", async () => {
      mockTestWorkflow.mockRejectedValue(new Error("network"));
      const wrapper = mountDrawer();
      await replayBtn(wrapper).trigger("click");
      await flushPromises();
      expect(mockToast).toHaveBeenCalledWith({
        message: t("workflow.test.runError"),
        variant: "error",
      });
    });

    it("is disabled + inert while a replay is in flight", async () => {
      let resolve!: (v: any) => void;
      mockTestWorkflow.mockReturnValue(new Promise((r) => (resolve = r)));
      const wrapper = mountDrawer();
      await replayBtn(wrapper).trigger("click");
      await nextTick();
      expect(replayBtn(wrapper).attributes("data-loading")).toBe("true");
      expect(replayBtn(wrapper).attributes("disabled")).toBeDefined();
      await replayBtn(wrapper).trigger("click");
      expect(mockTestWorkflow).toHaveBeenCalledTimes(1);
      resolve({ data: { errors: {}, inputs: {} } });
      await flushPromises();
    });

    it("is disabled when no records reached the node (nothing to replay)", () => {
      setup({
        nodeId: "d1",
        result: {
          errors: {},
          inputs: { t1: [rec(1)], f1: [rec(2)] },
          ranNodeIds: ["t1", "f1", "d1"],
          blockedNodeIds: [],
        },
      });
      expect(replayBtn(mountDrawer()).attributes("disabled")).toBeDefined();
    });

    it("carries the replay hint tooltip", () => {
      expect(tooltipFor(mountDrawer(), t("workflow.test.stepResult.replayHint"))).toBeTruthy();
    });
  });

  describe("history mode (read-only past run)", () => {
    // History carries the SAME per-node `inputs` map as a Test run — the drawer
    // renders Input/Output for every node, just read-only (no Replay).
    const historyResult = () => ({
      errors: { f1: { error_count: 1, errors: [["boom"]] } },
      inputs: { t1: [rec(1)], f1: [{ meta: { alert_name: "a" }, data: [{ x: 1 }] }], d1: [rec(3)] },
      ranNodeIds: ["t1", "f1", "d1"],
      blockedNodeIds: ["d1"],
      mode: "history",
      runId: "r1",
    });

    it("shows the per-node input, read-only", () => {
      setup({ result: historyResult() });
      const editor = inputEditor(mountDrawer());
      expect(editor.props("readOnly")).toBe(true);
      expect(JSON.parse(editor.props("query"))).toEqual([
        { meta: { alert_name: "a" }, data: [{ x: 1 }] },
      ]);
    });

    it("derives Output for a NON-error node too (not just error nodes)", () => {
      // f1 -> d1: f1's output == d1's input.
      setup({ result: historyResult() });
      expect(JSON.parse(outputEditor(mountDrawer()).props("query"))).toEqual([rec(3)]);
    });

    it("hides Replay (read-only) but KEEPS Use-as-input (seed a fresh test)", () => {
      setup({ result: historyResult() });
      const wrapper = mountDrawer();
      expect(replayBtn(wrapper).exists()).toBe(false);
      expect(useInputBtn(wrapper).exists()).toBe(true);
    });

    it("still shows the error output for the past run", () => {
      setup({ result: historyResult() });
      expect(mountDrawer().find('[data-test="workflow-step-result-error-line"]').text()).toBe(
        "boom",
      );
    });
  });

  describe("copy", () => {
    it("copies the input records with the input success message", async () => {
      const wrapper = mountDrawer();
      const btn = wrapper.find(`[title="${t("workflow.test.stepResult.copyInput")}"]`);
      await btn.trigger("click");
      expect(mockCopy).toHaveBeenCalledWith(
        JSON.stringify([rec(2)], null, 2),
        expect.any(Function),
        {
          successMessage: t("workflow.test.stepResult.copiedInput"),
        },
      );
    });

    it("copies the output records", async () => {
      const wrapper = mountDrawer();
      const btn = wrapper.find(`[title="${t("workflow.test.stepResult.copyOutput")}"]`);
      await btn.trigger("click");
      expect(mockCopy).toHaveBeenCalledWith(
        JSON.stringify([rec(3)], null, 2),
        expect.any(Function),
        {
          successMessage: t("workflow.test.stepResult.copiedOutput"),
        },
      );
    });

    it("copies error + forwarded together for an errored node", async () => {
      setup({ result: errorResult() });
      const wrapper = mountDrawer();
      const btn = wrapper.find(`[title="${t("workflow.test.stepResult.copyOutput")}"]`);
      await btn.trigger("click");
      const copied = mockCopy.mock.calls[0][0];
      expect(copied).toContain("boom");
      expect(copied).toContain('"x": 3'); // forwarded records included
    });
  });

  describe("fullscreen", () => {
    const fsButtons = (w: any) =>
      w.findAll(`[title="${t("workflow.test.stepResult.enterFullscreen")}"]`);

    it("toggles the Input+Output container as one unit", async () => {
      const wrapper = mountDrawer();
      await fsButtons(wrapper)[0].trigger("click");
      expect(mockToggleFullscreen).toHaveBeenCalledWith(
        wrapper.find('[data-test="workflow-step-io-container"]').element,
      );
    });

    it("logs (and does not throw) when the browser rejects the request", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockToggleFullscreen.mockReturnValueOnce(Promise.reject(new Error("denied")) as any);
      const wrapper = mountDrawer();
      await fsButtons(wrapper)[0].trigger("click");
      await flushPromises();
      expect(spy).toHaveBeenCalledWith("Failed to toggle fullscreen:", expect.any(Error));
      spy.mockRestore();
    });

    it("removes its fullscreen listeners on unmount", () => {
      const remove = vi.spyOn(document, "removeEventListener");
      mountDrawer().unmount();
      const events = remove.mock.calls.map((c) => c[0]);
      expect(events).toContain("fullscreenchange");
      expect(events).toContain("webkitfullscreenchange");
      remove.mockRestore();
    });
  });

  describe("closing", () => {
    it("clears the result drawer from the Close button", async () => {
      const wrapper = mountDrawer();
      const close = wrapper
        .findAll(".drawer-footer button")
        .find((b: any) => b.text() === t("common.close"))!;
      await close.trigger("click");
      expect(workflowObj.testRun.resultDrawer).toEqual({ show: false, nodeId: "" });
    });

    it("clears the result drawer when the drawer dismisses itself", async () => {
      const wrapper = mountDrawer();
      await wrapper.find(".drawer-dismiss").trigger("click");
      expect(workflowObj.testRun.resultDrawer.show).toBe(false);
    });
  });

  it("mounts fine with no node data and no result at all", () => {
    setup({ nodeId: "", nodes: [], edges: [], result: null });
    const wrapper = mountDrawer();
    expect(wrapper.find(".o-drawer").exists()).toBe(true);
  });
});
