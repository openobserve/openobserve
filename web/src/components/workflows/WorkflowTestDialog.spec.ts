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
const mockHistory = vi.fn().mockResolvedValue({ data: [] });
const mockGetRun = vi.fn().mockResolvedValue({ data: {} });
vi.mock("@/services/workflows", () => ({
  default: {
    testWorkflow: (...a: any[]) => mockTestWorkflow(...a),
    getWorkflowHistory: (...a: any[]) => mockHistory(...a),
    getWorkflowRun: (...a: any[]) => mockGetRun(...a),
  },
}));

import WorkflowTestDialog from "./WorkflowTestDialog.vue";
import { workflowObj, LAST_TEST_RUN } from "@/plugins/workflows/useWorkflowCanvas";
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

const OSwitchStub = {
  name: "OSwitch",
  props: ["modelValue", "label", "labelPosition"],
  emits: ["update:modelValue"],
  template: `<button class="o-switch" :data-value="String(modelValue)"
    @click="$emit('update:modelValue', !modelValue)">{{ label }}</button>`,
};

const OBannerStub = {
  name: "OBanner",
  props: ["variant", "content", "icon", "dense", "dataTest"],
  template: `<div class="o-banner" :data-variant="variant" :data-test="dataTest"><slot />{{ content }}</div>`,
};

const globalConfig = {
  plugins: [i18n, store],
  stubs: {
    ODrawer: ODrawerStub,
    OSelect: OSelectStub,
    OButton: OButtonStub,
    OText: OTextStub,
    OSwitch: OSwitchStub,
    OBanner: OBannerStub,
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

    it("seeds the INCIDENT sample when the trigger is an incident event", () => {
      // The Test drawer must prefill the payload of the CURRENT trigger kind —
      // an incident workflow should not seed an alert sample.
      setWorkflow(
        [
          {
            id: "t1",
            data: { node_type: "workflow_trigger", trigger_kind: "incident_event" },
          },
          destNode,
        ],
        [{ source: "t1", target: "d1" }],
      );
      workflowObj.testRun.input = "";
      mountDialog();
      const [{ meta }] = JSON.parse(workflowObj.testRun.input);
      expect(meta).toHaveProperty("incident_id");
      expect(meta).toHaveProperty("event_type");
      expect(meta).not.toHaveProperty("alert_name"); // not the alert sample
    });

    it("keeps an existing input (persisted across opens) instead of reseeding", () => {
      workflowObj.testRun.input = VALID_INPUT;
      mountDialog();
      expect(workflowObj.testRun.input).toBe(VALID_INPUT);
    });

    it('"Reset" restores the generated sample', async () => {
      workflowObj.testRun.input = "garbage";
      const wrapper = mountDialog();
      await wrapper.find('[data-test="workflow-test-reset-sample"]').trigger("click");
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
      // Options now also carry a per-type `icon` (rendered via OSelect iconKey), so
      // match the essential fields rather than the exact object.
      expect(opts[0]).toMatchObject({
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
      expect(opts[3].label).toBe(`${i18n.global.t("workflow.node.sendToDestination")} · sink-a`);
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
      expect(wrapper.text()).toContain(i18n.global.t("workflow.test.runFromNote"));
    });

    it("hides the partial-run note when running from the beginning", () => {
      const wrapper = mountDialog();
      expect(wrapper.text()).not.toContain(i18n.global.t("workflow.test.runFromNote"));
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
      expect(wrapper.text()).toContain(i18n.global.t("workflow.test.resultHint"));
      expect(wrapper.text()).not.toContain(i18n.global.t("workflow.test.invalidJson"));
    });

    it("rejects malformed JSON — shows the error and disables Run", async () => {
      workflowObj.testRun.input = "{not json";
      const wrapper = mountDialog();
      await nextTick();
      expect(wrapper.text()).toContain(i18n.global.t("workflow.test.invalidJson"));
      expect(primary(wrapper).attributes("disabled")).toBeDefined();
    });

    it("rejects valid JSON that is not an array (a bare object)", async () => {
      workflowObj.testRun.input = '{"a":1}';
      const wrapper = mountDialog();
      await nextTick();
      expect(wrapper.text()).toContain(i18n.global.t("workflow.test.invalidJson"));
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

      // The whole in-memory graph is sent (test-without-saving), not just an id.
      expect(mockTestWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          org_identifier: "default",
          inputs: JSON.parse(VALID_INPUT),
          from_node: undefined,
          workflow: expect.objectContaining({
            id: "wf1",
            name: "wf",
            nodes: expect.arrayContaining([expect.objectContaining({ id: "t1" })]),
          }),
        }),
      );
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
      expect(wrapper.findComponent(ODrawerStub as any).props("open")).toBe(false);
    });
  });
});

// Tuning a workflow means re-running the payload that actually reached it. The
// author opens Test with NOTHING loaded, so the dialog must let them PICK a past
// run from a labelled dropdown — and must show up front which runs are usable,
// rather than accepting a pick and then reporting it has no input.
describe("picking a previous run as the test input", () => {
  const runPicker = (w: any) =>
    w.findAllComponents(OSelectStub as any).find((c: any) => c.props("options")?.[0]?.isRunOption);

  beforeEach(() => {
    mockHistory.mockClear();
    mockHistory.mockResolvedValue({ data: [] });
    mockGetRun.mockClear();
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "w",
      nodes: [{ id: "t1", data: { node_type: "workflow_trigger" }, position: { x: 0, y: 0 } }],
      edges: [],
    } as any;
    workflowObj.testRun.input = "";
    workflowObj.testRun.fromNode = "";
    workflowObj.testRun.result = null;
    workflowObj.runsHistory.list = [];
  });

  const realRun = {
    run_id: "r1",
    start_time: 1,
    end_time: 2,
    event_type: "AlertFired",
    error: null,
  };
  const testRunRow = { run_id: "r2", start_time: 3, end_time: 4, event_type: "Test", error: null };

  it("fetches the run list when the dialog opens", async () => {
    mountDialog();
    await flushPromises();
    expect(mockHistory).toHaveBeenCalled();
  });

  it("renders a dropdown of previous runs", async () => {
    mockHistory.mockResolvedValue({ data: [realRun] });
    const w = mountDialog();
    await flushPromises();
    expect(runPicker(w)).toBeTruthy();
  });

  it("hides the dropdown when the workflow has never run", async () => {
    const w = mountDialog();
    await flushPromises();
    expect(runPicker(w)).toBeFalsy();
  });

  // A test run has no server-side payload, and the ONE test run we can replay is
  // already offered as "Last test run" from local state. Listing the rest as dead
  // greyed rows is just noise the author cannot act on, so they are not listed.
  it("never lists an unpickable test run", async () => {
    mockHistory.mockResolvedValue({ data: [realRun, testRunRow] });
    const w = mountDialog();
    await flushPromises();
    const opts = runPicker(w).props("options");
    expect(opts.some((o: any) => o.value === "r2")).toBe(false);
    expect(opts.every((o: any) => !o.disabled)).toBe(true);
  });

  // ...and it must not appear twice: once greyed, once as the local entry.
  it("does not duplicate the last test run as a dead row", async () => {
    workflowObj.testRun.result = { inputs: { t1: [{ a: 1 }] } } as any;
    mockHistory.mockResolvedValue({ data: [testRunRow] });
    const w = mountDialog();
    await flushPromises();
    const opts = runPicker(w).props("options");
    expect(opts.filter((o: any) => o.disabled).length).toBe(0);
    expect(opts.some((o: any) => o.value === LAST_TEST_RUN)).toBe(true);
  });

  // ONE fetch for the whole run, then slice the node we need out of its input_map.
  it("loads the chosen run and seeds the input from it", async () => {
    mockHistory.mockResolvedValue({ data: [realRun] });
    mockGetRun.mockResolvedValue({
      data: { data: { input_map: { t1: [{ meta: { alert_count: 5000 } }] } }, errors: null },
    });
    const w = mountDialog();
    await flushPromises();
    await runPicker(w).vm.$emit("update:modelValue", "r1");
    await flushPromises();
    expect(mockGetRun).toHaveBeenCalledTimes(1);
    expect(JSON.parse(workflowObj.testRun.input)).toEqual([{ meta: { alert_count: 5000 } }]);
  });
});

// The last test run IS available client-side (sessionStorage keeps its per-node
// inputs), so refusing to offer it while offering server-side runs is arbitrary —
// re-running your own last test is the commonest case of all.
describe("the last test run is pickable from local state", () => {
  const runPicker = (w: any) =>
    w.findAllComponents(OSelectStub as any).find((c: any) => c.props("options")?.[0]?.isRunOption);

  beforeEach(() => {
    mockHistory.mockClear();
    mockHistory.mockResolvedValue({ data: [] });
    mockGetRun.mockClear();
    workflowObj.currentSelectedWorkflow = {
      id: "wf",
      name: "w",
      nodes: [{ id: "t1", data: { node_type: "workflow_trigger" }, position: { x: 0, y: 0 } }],
      edges: [],
    } as any;
    workflowObj.testRun.input = "";
    workflowObj.testRun.fromNode = "";
    workflowObj.runsHistory.list = [];
    workflowObj.testRun.result = null;
  });

  it("offers the in-memory test run even when no server run exists", async () => {
    workflowObj.testRun.result = { inputs: { t1: [{ meta: { alert_count: 5000 } }] } } as any;
    const w = mountDialog();
    await flushPromises();
    const opts = runPicker(w)?.props("options") || [];
    expect(opts.some((o: any) => o.value === LAST_TEST_RUN)).toBe(true);
  });

  // Seeding from local state must NOT hit the network — the data is already here.
  it("seeds from it without fetching a run", async () => {
    workflowObj.testRun.result = { inputs: { t1: [{ meta: { alert_count: 5000 } }] } } as any;
    const w = mountDialog();
    await flushPromises();
    await runPicker(w).vm.$emit("update:modelValue", LAST_TEST_RUN);
    await flushPromises();
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(JSON.parse(workflowObj.testRun.input)).toEqual([{ meta: { alert_count: 5000 } }]);
  });

  it("is absent when no test run has happened", async () => {
    const w = mountDialog();
    await flushPromises();
    expect(runPicker(w)).toBeFalsy();
  });
});

// Gap: the input pane labelled every payload "Sample Input" — a hand-tampered
// payload, a payload seeded from a real run, and the generated sample were
// indistinguishable, so an author could publish believing they tested real data.
describe("test input provenance", () => {
  const runPicker = (w: any) =>
    w.findAllComponents(OSelectStub as any).find((c: any) => c.props("options")?.[0]?.isRunOption);
  const provenance = (w: any) => w.find('[data-test="workflow-test-input-source"]');
  const revert = (w: any) => w.find('[data-test="workflow-test-revert-input"]');

  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    mockHistory.mockResolvedValue({ data: [] });
    workflowObj.testRun.inputSource = "sample";
    workflowObj.testRun.inputRunLabel = "";
  });

  it("labels the generated sample as generated, with no revert offered", async () => {
    const wrapper = mountDialog();
    await nextTick();
    expect(provenance(wrapper).text()).toContain(i18n.global.t("workflow.test.source.sample"));
    expect(revert(wrapper).exists()).toBe(false);
  });

  it("marks the payload edited the moment the author types in the editor", async () => {
    const wrapper = mountDialog();
    await nextTick();
    editorVm(wrapper).vm.$emit("update:query", '[{"meta":{"alert_name":"TAMPERED"}}]');
    await nextTick();
    expect(workflowObj.testRun.inputSource).toBe("edited");
    expect(provenance(wrapper).text()).toContain(i18n.global.t("workflow.test.source.edited"));
  });

  it("offers a revert once edited, and reverting restores the generated sample", async () => {
    const wrapper = mountDialog();
    await nextTick();
    editorVm(wrapper).vm.$emit("update:query", "tampered");
    await nextTick();
    expect(revert(wrapper).exists()).toBe(true);
    await revert(wrapper).trigger("click");
    expect(workflowObj.testRun.input).toBe(buildTestSampleText());
    expect(workflowObj.testRun.inputSource).toBe("sample");
  });

  // Reset is the seeding control; it must also clear the edited provenance, or the
  // label keeps claiming "edited" over a freshly generated sample.
  it("Reset clears the edited provenance", async () => {
    workflowObj.testRun.inputSource = "edited";
    const wrapper = mountDialog();
    await wrapper.find('[data-test="workflow-test-reset-sample"]').trigger("click");
    await nextTick();
    expect(workflowObj.testRun.inputSource).toBe("sample");
  });

  // Re-seeding the exact same text is not an edit — the editor emits on mount and a
  // no-op emit must not silently relabel an untouched sample as hand-edited.
  it("does not mark an identical re-emit as an edit", async () => {
    const wrapper = mountDialog();
    await nextTick();
    editorVm(wrapper).vm.$emit("update:query", workflowObj.testRun.input);
    await nextTick();
    expect(workflowObj.testRun.inputSource).toBe("sample");
  });

  it("names the run a payload was seeded from, and reverting drops back to the sample", async () => {
    workflowObj.testRun.result = { inputs: { t1: [{ meta: { alert_count: 5000 } }] } } as any;
    const wrapper = mountDialog();
    await flushPromises();
    await runPicker(wrapper).vm.$emit("update:modelValue", LAST_TEST_RUN);
    await flushPromises();
    expect(workflowObj.testRun.inputSource).toBe("run");
    expect(provenance(wrapper).text()).toContain(i18n.global.t("workflow.test.lastTestRun"));
    // A run-seeded payload is also non-generated data, so it stays revertible.
    expect(revert(wrapper).exists()).toBe(true);
  });

  it("marks a run-seeded payload edited once the author changes it", async () => {
    workflowObj.testRun.result = { inputs: { t1: [{ meta: { alert_count: 5000 } }] } } as any;
    const wrapper = mountDialog();
    await flushPromises();
    await runPicker(wrapper).vm.$emit("update:modelValue", LAST_TEST_RUN);
    await flushPromises();
    editorVm(wrapper).vm.$emit("update:query", "hand edited");
    await nextTick();
    expect(workflowObj.testRun.inputSource).toBe("edited");
    expect(provenance(wrapper).text()).toContain(i18n.global.t("workflow.test.source.edited"));
  });
});

describe("destination suppression (P0 safety)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
  });

  const suppressToggle = (w: any) => w.find('[data-test="workflow-test-suppress-destinations"]');
  const warning = (w: any) => w.find('[data-test="workflow-test-dispatch-warning"]');

  it("defaults the suppress-destinations toggle ON so a Test cannot page on-call", async () => {
    const wrapper = mountDialog();
    await nextTick();
    expect(workflowObj.testRun.suppressDestinations).toBe(true);
    expect(suppressToggle(wrapper).attributes("data-value")).toBe("true");
  });

  it("sends suppress_destinations=true to the backend by default", async () => {
    mockTestWorkflow.mockResolvedValue({ data: { errors: {} } });
    workflowObj.testRun.input = VALID_INPUT;
    const wrapper = mountDialog();
    await primary(wrapper).trigger("click");
    await flushPromises();
    expect(mockTestWorkflow.mock.calls[0][0].suppress_destinations).toBe(true);
  });

  it("hides the live-dispatch warning while suppression is on", async () => {
    const wrapper = mountDialog();
    await nextTick();
    expect(warning(wrapper).exists()).toBe(false);
  });

  it("warns and names the destinations that will fire once suppression is switched off", async () => {
    const wrapper = mountDialog();
    await nextTick();
    await suppressToggle(wrapper).trigger("click");
    await nextTick();
    expect(workflowObj.testRun.suppressDestinations).toBe(false);
    const w = warning(wrapper);
    expect(w.exists()).toBe(true);
    expect(w.attributes("data-variant")).toBe("warning");
    // the warning must NAME the destination, not just say "destinations"
    expect(w.text()).toContain("sink-a");
  });

  it("sends suppress_destinations=false once the author opts into a live dispatch", async () => {
    mockTestWorkflow.mockResolvedValue({ data: { errors: {} } });
    workflowObj.testRun.input = VALID_INPUT;
    const wrapper = mountDialog();
    await nextTick();
    await suppressToggle(wrapper).trigger("click");
    await primary(wrapper).trigger("click");
    await flushPromises();
    expect(mockTestWorkflow.mock.calls[0][0].suppress_destinations).toBe(false);
  });
});
