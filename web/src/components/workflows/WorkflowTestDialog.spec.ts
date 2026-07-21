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

// WorkflowTestDialog — the dry-run "Test" input popup. It seeds a sample alert
// payload, lets the user pick a "Run From" step, validates the JSON, and runs
// the SAVED workflow through executeTestRun (the /test endpoint is a validator:
// it returns per-node ERRORS only).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));

const mockTestWorkflow = vi.fn();
vi.mock("@/services/workflows", () => ({
  default: {
    testWorkflow: (...a: any[]) => mockTestWorkflow(...a),
    getWorkflowRun: vi.fn(),
  },
}));

import WorkflowTestDialog from "./WorkflowTestDialog.vue";
import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { buildTestSampleText } from "@/plugins/workflows/testSample";

// ── stubs ────────────────────────────────────────────────────────────────────
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "size",
    "title",
    "primaryButtonLabel",
    "primaryButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div class="o-drawer" :data-open="String(open)">
      <button class="dlg-primary" data-test="dlg-primary"
        :disabled="primaryButtonDisabled"
        :data-loading="String(!!primaryButtonLoading)"
        @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button class="dlg-secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button class="dlg-dismiss" @click="$emit('update:open', false)">x</button>
      <slot />
    </div>`,
};

const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options", "label", "loading", "multiple", "searchable", "placeholder"],
  emits: ["update:modelValue"],
  template: `<div class="o-select" :data-value="String(modelValue)" />`,
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading", "iconLeft", "title"],
  template: `<button :disabled="disabled"><slot /></button>`,
};

const OTextStub = {
  name: "OText",
  props: ["variant", "as"],
  template: `<span class="o-text"><slot /></span>`,
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
    OSelect: OSelectStub,
    OButton: OButtonStub,
    OText: OTextStub,
    CodeQueryEditor: CodeQueryEditorStub,
  },
};

const triggerNode = { id: "t1", data: { node_type: "workflow_trigger" } };
const fnNode = { id: "f1", data: { node_type: "function", name: "parse_json" } };
const fnNode2 = { id: "f2", data: { node_type: "function", name: "enrich" } };
const destNode = {
  id: "d1",
  data: { node_type: "destination", destination_id: "sink-a" },
};

const setWorkflow = (nodes: any[], edges: any[]) => {
  workflowObj.currentSelectedWorkflow = {
    id: "wf1",
    name: "wf",
    nodes,
    edges,
  } as any;
};

const resetState = () => {
  setWorkflow(
    [triggerNode, fnNode, destNode],
    [
      { source: "t1", target: "f1" },
      { source: "f1", target: "d1" },
    ],
  );
  workflowObj.testRun = {
    show: true,
    input: "",
    fromNode: "",
    result: null,
    resultDrawer: { show: false, nodeId: "" },
  } as any;
};

const mountDialog = () => mount(WorkflowTestDialog, { global: globalConfig });

const selectVm = (w: any) => w.findComponent(OSelectStub as any);
const editorVm = (w: any) => w.findComponent(CodeQueryEditorStub as any);
const primary = (w: any) => w.find('[data-test="dlg-primary"]');

const VALID_INPUT = '[{"meta":{"alert_name":"a"},"data":[{"x":1}]}]';

describe("WorkflowTestDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  describe("sample seeding", () => {
    it("seeds the sample payload on mount when the input is empty", async () => {
      const wrapper = mountDialog();
      expect(workflowObj.testRun.input).toBe(buildTestSampleText());
      await nextTick();
      expect(editorVm(wrapper).props("query")).toBe(buildTestSampleText());
    });

    it("keeps an existing input (persisted across opens) instead of reseeding", () => {
      workflowObj.testRun.input = VALID_INPUT;
      mountDialog();
      expect(workflowObj.testRun.input).toBe(VALID_INPUT);
    });

    it('"Reset" restores the generated sample', async () => {
      workflowObj.testRun.input = "garbage";
      const wrapper = mountDialog();
      await wrapper
        .find('[data-test="workflow-test-reset-sample"]')
        .trigger("click");
      expect(workflowObj.testRun.input).toBe(buildTestSampleText());
    });

    it("writes editor edits back to the central testRun.input", async () => {
      const wrapper = mountDialog();
      editorVm(wrapper).vm.$emit("update:query", VALID_INPUT);
      await nextTick();
      expect(workflowObj.testRun.input).toBe(VALID_INPUT);
    });
  });

  describe("run-from options", () => {
    it("lists Beginning first, then the non-trigger steps in flow order", () => {
      const wrapper = mountDialog();
      const opts = selectVm(wrapper).props("options") as any[];
      expect(opts[0]).toEqual({
        label: i18n.global.t("workflow.test.runFromBeginning"),
        value: "__beginning__",
      });
      expect(opts.map((o) => o.value)).toEqual(["__beginning__", "f1", "d1"]);
      // detail suffix comes from nodeConfigDetail
      expect(opts[1].label).toContain("parse_json");
      expect(opts[2].label).toContain("sink-a");
    });

    it("numbers repeated node types and omits numbering for unique ones", () => {
      setWorkflow(
        [triggerNode, fnNode, fnNode2, destNode],
        [
          { source: "t1", target: "f1" },
          { source: "f1", target: "f2" },
          { source: "f2", target: "d1" },
        ],
      );
      const wrapper = mountDialog();
      const opts = selectVm(wrapper).props("options") as any[];
      const fnTitle = i18n.global.t("workflow.node.function");
      expect(opts[1].label).toBe(`${fnTitle} 1 · parse_json`);
      expect(opts[2].label).toBe(`${fnTitle} 2 · enrich`);
      // single destination -> no number
      expect(opts[3].label).toBe(
        `${i18n.global.t("workflow.node.sendToDestination")} · sink-a`,
      );
    });

    it("omits the ' · detail' suffix when the node has no configured detail", () => {
      setWorkflow(
        [triggerNode, { id: "c1", data: { node_type: "condition" } }],
        [{ source: "t1", target: "c1" }],
      );
      const wrapper = mountDialog();
      const opts = selectVm(wrapper).props("options") as any[];
      expect(opts[1].label).toBe(i18n.global.t("workflow.node.condition"));
    });

    it("handles an empty workflow (only the Beginning option)", () => {
      workflowObj.currentSelectedWorkflow = null as any;
      const wrapper = mountDialog();
      expect(selectVm(wrapper).props("options")).toHaveLength(1);
    });
  });

  describe("run-from proxy (sentinel <-> fromNode)", () => {
    it('shows the sentinel when fromNode is "" (beginning)', () => {
      const wrapper = mountDialog();
      expect(selectVm(wrapper).props("modelValue")).toBe("__beginning__");
    });

    it("shows the node id when a run-from node is set, and notes the partial run", async () => {
      workflowObj.testRun.fromNode = "f1";
      const wrapper = mountDialog();
      await nextTick();
      expect(selectVm(wrapper).props("modelValue")).toBe("f1");
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.test.runFromNote"),
      );
    });

    it("hides the partial-run note when running from the beginning", () => {
      const wrapper = mountDialog();
      expect(wrapper.text()).not.toContain(
        i18n.global.t("workflow.test.runFromNote"),
      );
    });

    it("writes a picked node id through to fromNode", async () => {
      const wrapper = mountDialog();
      selectVm(wrapper).vm.$emit("update:modelValue", "d1");
      await nextTick();
      expect(workflowObj.testRun.fromNode).toBe("d1");
    });

    it('maps the sentinel back to "" (never leaks to the API payload)', async () => {
      workflowObj.testRun.fromNode = "f1";
      const wrapper = mountDialog();
      selectVm(wrapper).vm.$emit("update:modelValue", "__beginning__");
      await nextTick();
      expect(workflowObj.testRun.fromNode).toBe("");
    });
  });

  describe("input validation", () => {
    it("accepts a JSON array and enables Run", async () => {
      workflowObj.testRun.input = VALID_INPUT;
      const wrapper = mountDialog();
      await nextTick();
      expect(primary(wrapper).attributes("disabled")).toBeUndefined();
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.test.resultHint"),
      );
      expect(wrapper.text()).not.toContain(
        i18n.global.t("workflow.test.invalidJson"),
      );
    });

    it("rejects malformed JSON — shows the error and disables Run", async () => {
      workflowObj.testRun.input = "{not json";
      const wrapper = mountDialog();
      await nextTick();
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.test.invalidJson"),
      );
      expect(primary(wrapper).attributes("disabled")).toBeDefined();
    });

    it("rejects valid JSON that is not an array (a bare object)", async () => {
      workflowObj.testRun.input = '{"a":1}';
      const wrapper = mountDialog();
      await nextTick();
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.test.invalidJson"),
      );
      expect(primary(wrapper).attributes("disabled")).toBeDefined();
    });

    it("does not call the test API when the payload is invalid", async () => {
      workflowObj.testRun.input = "nope";
      const wrapper = mountDialog();
      await primary(wrapper).trigger("click");
      await flushPromises();
      expect(mockTestWorkflow).not.toHaveBeenCalled();
    });
  });

  describe("running the test", () => {
    it("posts the parsed inputs for the saved workflow and closes on success", async () => {
      mockTestWorkflow.mockResolvedValue({ data: { errors: {} } });
      workflowObj.testRun.input = VALID_INPUT;
      const wrapper = mountDialog();
      await primary(wrapper).trigger("click");
      await flushPromises();

      expect(mockTestWorkflow).toHaveBeenCalledWith({
        org_identifier: "default",
        id: "wf1",
        inputs: JSON.parse(VALID_INPUT),
        from_node: undefined,
      });
      // success -> the popup closes and the result is stored for the canvas badges
      expect(workflowObj.testRun.show).toBe(false);
      expect(workflowObj.testRun.result).toMatchObject({ errors: {} });
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("passes from_node when a run-from step is chosen", async () => {
      mockTestWorkflow.mockResolvedValue({ data: { errors: {} } });
      workflowObj.testRun.input = VALID_INPUT;
      workflowObj.testRun.fromNode = "f1";
      const wrapper = mountDialog();
      await primary(wrapper).trigger("click");
      await flushPromises();
      expect(mockTestWorkflow.mock.calls[0][0].from_node).toBe("f1");
      // only f1 + downstream count as "ran"
      expect(workflowObj.testRun.result.ranNodeIds.sort()).toEqual(["d1", "f1"]);
    });

    it("stores per-node errors (validator returns errors only) and still closes", async () => {
      mockTestWorkflow.mockResolvedValue({
        data: { errors: { f1: { error_count: 1, errors: [["boom"]] } } },
      });
      workflowObj.testRun.input = VALID_INPUT;
      const wrapper = mountDialog();
      await primary(wrapper).trigger("click");
      await flushPromises();

      expect(workflowObj.testRun.result.errors.f1.errors[0][0]).toBe("boom");
      // d1 is downstream of the errored f1 -> not verified
      expect(workflowObj.testRun.result.blockedNodeIds).toEqual(["d1"]);
      expect(workflowObj.testRun.show).toBe(false);
    });

    it("toasts the backend message and stays open on API failure", async () => {
      mockTestWorkflow.mockRejectedValue({
        response: { data: { message: "workflow not saved" } },
      });
      workflowObj.testRun.input = VALID_INPUT;
      const wrapper = mountDialog();
      await primary(wrapper).trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: "workflow not saved",
        variant: "error",
      });
      expect(workflowObj.testRun.show).toBe(true);
    });

    it("falls back to the generic run error when the API gives no message", async () => {
      mockTestWorkflow.mockRejectedValue(new Error("network"));
      workflowObj.testRun.input = VALID_INPUT;
      const wrapper = mountDialog();
      await primary(wrapper).trigger("click");
      await flushPromises();
      expect(mockToast).toHaveBeenCalledWith({
        message: i18n.global.t("workflow.test.runError"),
        variant: "error",
      });
    });

    it("shows the loading state and blocks a second run while in flight", async () => {
      let resolve!: (v: any) => void;
      mockTestWorkflow.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      workflowObj.testRun.input = VALID_INPUT;
      const wrapper = mountDialog();
      await primary(wrapper).trigger("click");
      await nextTick();

      expect(primary(wrapper).attributes("data-loading")).toBe("true");
      expect(primary(wrapper).attributes("disabled")).toBeDefined();

      // a click while running is a no-op (canRun is false)
      await primary(wrapper).trigger("click");
      expect(mockTestWorkflow).toHaveBeenCalledTimes(1);

      resolve({ data: { errors: {} } });
      await flushPromises();
      expect(primary(wrapper).attributes("data-loading")).toBe("false");
    });
  });

  describe("closing", () => {
    it("clears the show flag from the secondary (Close) button", async () => {
      const wrapper = mountDialog();
      await wrapper.find(".dlg-secondary").trigger("click");
      expect(workflowObj.testRun.show).toBe(false);
    });

    it("clears the show flag when the dialog dismisses itself (X / overlay)", async () => {
      const wrapper = mountDialog();
      await wrapper.find(".dlg-dismiss").trigger("click");
      expect(workflowObj.testRun.show).toBe(false);
    });

    it("mirrors testRun.show into the dialog's open prop", async () => {
      const wrapper = mountDialog();
      expect(wrapper.findComponent(ODrawerStub as any).props("open")).toBe(true);
      workflowObj.testRun.show = false;
      await nextTick();
      expect(wrapper.findComponent(ODrawerStub as any).props("open")).toBe(
        false,
      );
    });
  });
});
