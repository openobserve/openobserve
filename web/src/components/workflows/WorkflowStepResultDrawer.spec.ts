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

// WorkflowStepResultDrawer — the "Test Step Result" drawer. By design it only
// opens for ERROR nodes: Input = the CENTRAL testRun.input (same payload the
// Test dialog edits), Output = the NodeErrors messages (the backend returns no
// per-node node_io), plus Replay (executeTestRun with fromNode). A history run
// is read-only: per-node captured input, no Replay.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

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
  // `title` is intentionally NOT declared so it falls through to the button.
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
  template: `<div class="code-editor" :data-readonly="String(!!readOnly)">{{ query }}</div>`,
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

const NODES = [
  { id: "t1", data: { node_type: "workflow_trigger" } },
  { id: "f1", data: { node_type: "function", name: "parse_json" } },
  { id: "d1", data: { node_type: "destination", destination_id: "sink-a" } },
];

const VALID_INPUT = '[{"meta":{"alert_name":"a"},"data":[{"x":1}]}]';

const errorResult = (extra: Record<string, any> = {}) => ({
  errors: {
    f1: { error_count: 2, errors: [["boom", { x: 1 }], ["bad record"]] },
  },
  ranNodeIds: ["t1", "f1", "d1"],
  blockedNodeIds: ["d1"],
  ...extra,
});

const setup = (opts: {
  nodeId?: string;
  input?: string;
  result?: any;
  nodes?: any[];
} = {}) => {
  workflowObj.currentSelectedWorkflow = {
    id: "wf1",
    name: "wf",
    nodes: opts.nodes ?? NODES,
    edges: [
      { source: "t1", target: "f1" },
      { source: "f1", target: "d1" },
    ],
  } as any;
  workflowObj.testRun = {
    show: false,
    input: opts.input ?? VALID_INPUT,
    fromNode: "",
    result: opts.result === undefined ? errorResult() : opts.result,
    resultDrawer: { show: true, nodeId: opts.nodeId ?? "f1" },
  } as any;
};

const mountDrawer = () =>
  mount(WorkflowStepResultDrawer, { global: globalConfig, attachTo: document.body });

const editorVm = (w: any) => w.findComponent(CodeQueryEditorStub as any);
const replayBtn = (w: any) => w.find('[data-test="workflow-step-replay-btn"]');
const iconButtons = (w: any) => w.findAll(".o-drawer button");

describe("WorkflowStepResultDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  describe("title", () => {
    it("shows '<Type> - <detail>' for the errored node", () => {
      const wrapper = mountDrawer();
      expect(wrapper.find(".o-drawer").attributes("data-title")).toBe(
        `${i18n.global.t("workflow.node.function")} - parse_json`,
      );
    });

    it("truncates a long title at 30 chars with an ellipsis", () => {
      setup({
        nodeId: "f1",
        nodes: [
          {
            id: "f1",
            data: {
              node_type: "function",
              name: "a_really_long_vrl_function_name_here",
            },
          },
        ],
      });
      const wrapper = mountDrawer();
      const title = wrapper.find(".o-drawer").attributes("data-title")!;
      expect(title).toHaveLength(31); // 30 chars + the ellipsis
      expect(title.endsWith("…")).toBe(true);
    });

    it("falls back to the raw node_type when it is not in the palette", () => {
      setup({ nodeId: "x1", nodes: [{ id: "x1", data: { node_type: "mystery" } }] });
      const wrapper = mountDrawer();
      expect(wrapper.find(".o-drawer").attributes("data-title")).toBe("mystery");
    });

    it("renders an empty title when the node id no longer exists", () => {
      setup({ nodeId: "ghost" });
      const wrapper = mountDrawer();
      expect(wrapper.find(".o-drawer").attributes("data-title")).toBe("");
    });
  });

  describe("status + output (errors only, by design)", () => {
    it("always shows the Errored badge (the drawer only opens for error nodes)", () => {
      const wrapper = mountDrawer();
      const badge = wrapper.find(".o-badge");
      expect(badge.attributes("data-variant")).toBe("error-soft");
      expect(badge.text()).toBe(
        i18n.global.t("workflow.test.stepResult.status.error"),
      );
    });

    it("renders each NodeErrors message as the Output — first tuple element only", () => {
      const wrapper = mountDrawer();
      const lines = wrapper.findAll("[data-test='workflow-step-result-error-line']");
      expect(lines).toHaveLength(2);
      expect(lines[0].text()).toBe("boom");
      expect(lines[1].text()).toBe("bad record");
    });

    it("stringifies a non-tuple error entry", () => {
      setup({
        result: {
          errors: { f1: { error_count: 1, errors: ["flat message"] } },
          ranNodeIds: [],
          blockedNodeIds: [],
        },
      });
      const wrapper = mountDrawer();
      expect(wrapper.find("[data-test='workflow-step-result-error-line']").text()).toBe("flat message");
    });

    it("shows the no-output placeholder when the node has no error entries", () => {
      setup({ result: { errors: {}, ranNodeIds: [], blockedNodeIds: [] } });
      const wrapper = mountDrawer();
      expect(wrapper.find("[data-test='workflow-step-result-error-line']").exists()).toBe(false);
      expect(wrapper.find("[data-test='workflow-step-result-no-output']").text()).toBe(
        i18n.global.t("workflow.test.stepResult.noOutput"),
      );
    });

    it("tolerates a null result and a malformed errors entry", () => {
      setup({ result: null });
      expect(mountDrawer().find("[data-test='workflow-step-result-no-output']").exists()).toBe(true);

      setup({
        result: { errors: { f1: { errors: "not-an-array" } } },
      });
      expect(mountDrawer().find("[data-test='workflow-step-result-no-output']").exists()).toBe(true);
    });
  });

  describe("input — bound to the central testRun.input (test mode)", () => {
    it("shows the central input, editable", () => {
      const wrapper = mountDrawer();
      expect(editorVm(wrapper).props("query")).toBe(VALID_INPUT);
      expect(editorVm(wrapper).props("readOnly")).toBe(false);
    });

    it("writes edits straight back to testRun.input (stays in sync with the Test dialog)", async () => {
      const wrapper = mountDrawer();
      editorVm(wrapper).vm.$emit("update:query", '[{"y":2}]');
      await nextTick();
      expect(workflowObj.testRun.input).toBe('[{"y":2}]');
      expect(editorVm(wrapper).props("query")).toBe('[{"y":2}]');
    });

    it("shows the invalid-JSON hint for a malformed payload", async () => {
      setup({ input: "{oops" });
      const wrapper = mountDrawer();
      expect(wrapper.find("[data-test='workflow-step-result-input-error']").text()).toBe(
        i18n.global.t("workflow.test.invalidJson"),
      );
    });

    it("treats a non-array payload as invalid", () => {
      setup({ input: '{"a":1}' });
      expect(mountDrawer().find("[data-test='workflow-step-result-input-error']").exists()).toBe(true);
    });

    it("treats an empty payload as invalid (nothing to replay)", () => {
      setup({ input: "   " });
      const wrapper = mountDrawer();
      expect(wrapper.find("[data-test='workflow-step-result-input-error']").exists()).toBe(true);
      expect(replayBtn(wrapper).attributes("disabled")).toBeDefined();
    });

    it("hides the invalid-JSON hint for a valid array", () => {
      expect(mountDrawer().find("[data-test='workflow-step-result-input-error']").exists()).toBe(false);
    });
  });

  describe("history mode (read-only past run)", () => {
    const historyResult = () =>
      errorResult({
        mode: "history",
        runId: "r1",
        nodeInputs: { f1: [{ meta: { alert_name: "a" }, data: [{ x: 1 }] }] },
      });

    it("shows the per-node captured input, pretty-printed and read-only", () => {
      setup({ result: historyResult() });
      const wrapper = mountDrawer();
      const editor = editorVm(wrapper);
      expect(editor.props("readOnly")).toBe(true);
      expect(editor.props("query")).toBe(
        JSON.stringify([{ meta: { alert_name: "a" }, data: [{ x: 1 }] }], null, 2),
      );
    });

    it("shows an empty input when the run captured none for this node", () => {
      setup({ result: errorResult({ mode: "history", nodeInputs: {} }) });
      expect(editorVm(mountDrawer()).props("query")).toBe("");
    });

    it("ignores editor writes (the setter no-ops) so the central input is untouched", async () => {
      setup({ result: historyResult() });
      const wrapper = mountDrawer();
      editorVm(wrapper).vm.$emit("update:query", "tampered");
      await nextTick();
      expect(workflowObj.testRun.input).toBe(VALID_INPUT);
    });

    it("hides Replay and the invalid-JSON hint (a past run is read-only)", () => {
      setup({ input: "{oops", result: historyResult() });
      const wrapper = mountDrawer();
      expect(replayBtn(wrapper).exists()).toBe(false);
      expect(wrapper.find("[data-test='workflow-step-result-input-error']").exists()).toBe(false);
    });

    it("still shows the error output for the past run", () => {
      setup({ result: historyResult() });
      expect(mountDrawer().findAll("[data-test='workflow-step-result-error-line']")).toHaveLength(2);
    });
  });

  describe("replay", () => {
    it("re-runs the workflow FROM this node with the edited input, then closes", async () => {
      mockTestWorkflow.mockResolvedValue({ data: { errors: {} } });
      const wrapper = mountDrawer();
      expect(replayBtn(wrapper).attributes("disabled")).toBeUndefined();

      await replayBtn(wrapper).trigger("click");
      await flushPromises();

      expect(mockTestWorkflow).toHaveBeenCalledWith({
        org_identifier: "default",
        id: "wf1",
        inputs: JSON.parse(VALID_INPUT),
        from_node: "f1",
      });
      expect(workflowObj.testRun.resultDrawer).toEqual({
        show: false,
        nodeId: "",
      });
    });

    it("keeps the drawer open and toasts the backend message on failure", async () => {
      mockTestWorkflow.mockRejectedValue({
        response: { data: { message: "vrl compile error" } },
      });
      const wrapper = mountDrawer();
      await replayBtn(wrapper).trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: "vrl compile error",
        variant: "error",
      });
      expect(workflowObj.testRun.resultDrawer.show).toBe(true);
    });

    it("falls back to the generic run error when the API gives no message", async () => {
      mockTestWorkflow.mockRejectedValue(new Error("network"));
      const wrapper = mountDrawer();
      await replayBtn(wrapper).trigger("click");
      await flushPromises();
      expect(mockToast).toHaveBeenCalledWith({
        message: i18n.global.t("workflow.test.runError"),
        variant: "error",
      });
    });

    it("is disabled and inert while a replay is in flight", async () => {
      let resolve!: (v: any) => void;
      mockTestWorkflow.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const wrapper = mountDrawer();
      await replayBtn(wrapper).trigger("click");
      await nextTick();

      expect(replayBtn(wrapper).attributes("data-loading")).toBe("true");
      expect(replayBtn(wrapper).attributes("disabled")).toBeDefined();
      // a second click while replaying is a no-op
      await replayBtn(wrapper).trigger("click");
      expect(mockTestWorkflow).toHaveBeenCalledTimes(1);

      resolve({ data: { errors: {} } });
      await flushPromises();
    });

    it("does not call the API when the input is not a valid JSON array", async () => {
      setup({ input: "not json" });
      const wrapper = mountDrawer();
      await replayBtn(wrapper).trigger("click");
      await flushPromises();
      expect(mockTestWorkflow).not.toHaveBeenCalled();
    });

    it("carries the replay hint tooltip", () => {
      expect(mountDrawer().find(".o-tooltip").attributes("data-content")).toBe(
        i18n.global.t("workflow.test.stepResult.replayHint"),
      );
    });
  });

  describe("copy", () => {
    it("copies the input with the input success message", async () => {
      const wrapper = mountDrawer();
      const btns = wrapper.findAll(
        `[title="${i18n.global.t("workflow.test.stepResult.copyInput")}"]`,
      );
      await btns[0].trigger("click");
      expect(mockCopy).toHaveBeenCalledWith(VALID_INPUT, {
        successMessage: i18n.global.t("workflow.test.stepResult.copiedInput"),
      });
    });

    it("copies the output as the joined error messages", async () => {
      const wrapper = mountDrawer();
      const btns = wrapper.findAll(
        `[title="${i18n.global.t("workflow.test.stepResult.copyOutput")}"]`,
      );
      await btns[0].trigger("click");
      expect(mockCopy).toHaveBeenCalledWith("boom\nbad record", {
        successMessage: i18n.global.t("workflow.test.stepResult.copiedOutput"),
      });
    });

    it("disables both copy buttons and copies nothing when there is no text", async () => {
      setup({ input: "", result: { errors: {} } });
      const wrapper = mountDrawer();
      const copyIn = wrapper.find(
        `[title="${i18n.global.t("workflow.test.stepResult.copyInput")}"]`,
      );
      const copyOut = wrapper.find(
        `[title="${i18n.global.t("workflow.test.stepResult.copyOutput")}"]`,
      );
      expect(copyIn.attributes("disabled")).toBeDefined();
      expect(copyOut.attributes("disabled")).toBeDefined();

      // even if invoked, an empty payload is a no-op
      await copyIn.trigger("click");
      await copyOut.trigger("click");
      expect(mockCopy).not.toHaveBeenCalled();
    });
  });

  describe("fullscreen", () => {
    const fsButtons = (w: any) =>
      w.findAll(
        `[title="${i18n.global.t("workflow.test.stepResult.enterFullscreen")}"]`,
      );

    it("toggles the Input+Output container as one unit", async () => {
      const wrapper = mountDrawer();
      await fsButtons(wrapper)[0].trigger("click");
      expect(mockToggleFullscreen).toHaveBeenCalledWith(
        wrapper.find("[data-test='workflow-step-io-container']").element,
      );
    });

    it("logs (and does not throw) when the browser rejects the request", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockToggleFullscreen.mockReturnValueOnce(
        Promise.reject(new Error("denied")) as any,
      );
      const wrapper = mountDrawer();
      await fsButtons(wrapper)[0].trigger("click");
      await flushPromises();
      expect(spy).toHaveBeenCalledWith(
        "Failed to toggle fullscreen:",
        expect.any(Error),
      );
      spy.mockRestore();
    });

    it("flips the icon + title once the document reports fullscreen", async () => {
      const wrapper = mountDrawer();
      const el = wrapper.find("[data-test='workflow-step-io-container']").element;
      expect(wrapper.findAll('[data-icon="fullscreen"]')).toHaveLength(2);

      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: el,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      await nextTick();

      expect(wrapper.findAll('[data-icon="fullscreen-exit"]')).toHaveLength(2);
      expect(
        wrapper.findAll(
          `[title="${i18n.global.t("workflow.test.stepResult.exitFullscreen")}"]`,
        ),
      ).toHaveLength(2);

      // leaving fullscreen flips it back
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: null,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      await nextTick();
      expect(wrapper.findAll('[data-icon="fullscreen"]')).toHaveLength(2);
    });

    it("removes its fullscreen listeners on unmount", async () => {
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
        .find((b: any) => b.text() === i18n.global.t("common.close"))!;
      await close.trigger("click");
      expect(workflowObj.testRun.resultDrawer).toEqual({
        show: false,
        nodeId: "",
      });
    });

    it("clears the result drawer when the drawer dismisses itself", async () => {
      const wrapper = mountDrawer();
      await wrapper.find(".drawer-dismiss").trigger("click");
      expect(workflowObj.testRun.resultDrawer.show).toBe(false);
    });

    it("keeps it open when the drawer reports open=true", async () => {
      const wrapper = mountDrawer();
      wrapper.findComponent(ODrawerStub as any).vm.$emit("update:open", true);
      await nextTick();
      expect(workflowObj.testRun.resultDrawer.show).toBe(true);
    });
  });

  it("mounts fine when there are only icon buttons and no node data at all", () => {
    setup({ nodeId: "", nodes: [], result: null });
    const wrapper = mountDrawer();
    expect(wrapper.find(".o-drawer").exists()).toBe(true);
    expect(iconButtons(wrapper).length).toBeGreaterThan(0);
  });
});
