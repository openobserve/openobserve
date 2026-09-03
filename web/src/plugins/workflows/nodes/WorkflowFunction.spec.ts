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

// WorkflowFunction is a THIN WRAPPER over the shared FunctionPicker (which has
// its own spec — it's the one that filters to VRL-only functions). Tested here:
//   - the initial name / after-flatten seeded from the saved node data
//   - the fired-alert sample events handed to the inline editor
//   - @expand driving workflowObj.dialog.expand (drawer widens, footer hides)
//     and the unmount reset
//   - submit() proxying the picker and normalizing undefined -> null

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/utils/zincutils", () => ({
  getImageURL: (p: string) => p,
  getUUID: () => "uuid",
}));
vi.mock("@/services/workflows", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});

const pickerSubmit = vi.fn();
vi.mock("@/components/flow/forms/FunctionPicker.vue", () => ({
  default: {
    name: "FunctionPicker",
    // Object form (not an array): boolean props must be typed Boolean so a shorthand
    // attribute coerces to `true` instead of surfacing as `""`.
    props: {
      initialName: {},
      initialRawFn: {},
      initialAfterFlatten: {},
      sampleEvents: {},
      language: {},
      defaultCode: {},
      optional: { type: Boolean, default: false },
      createButton: { type: Boolean, default: false },
    },
    emits: ["expand"],
    methods: {
      submit: (...args: any[]) => pickerSubmit(...args),
    },
    template: '<div class="function-picker-stub" />',
  },
}));

import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { buildTestSample } from "@/plugins/workflows/testSample";
import { buildIncidentSample } from "@/plugins/workflows/incidentSample";
import WorkflowFunction from "./WorkflowFunction.vue";

// The "Events" sample comes from the CURRENT trigger's kind, so seed a trigger
// node in the graph. Default = alert; individual tests override it.
const seedTrigger = (kind = "alert_fired") => {
  workflowObj.currentSelectedWorkflow.nodes = [
    { id: "t1", data: { node_type: "workflow_trigger", trigger_kind: kind } },
  ];
};

function createWrapper() {
  return mount(WorkflowFunction, { global: { plugins: [i18n, store] } });
}

const picker = (wrapper: any) => wrapper.findComponent({ name: "FunctionPicker" });

describe("WorkflowFunction", () => {
  beforeEach(() => {
    workflowObj.currentSelectedNodeData = null;
    workflowObj.dialog.expand = false;
    seedTrigger();
    pickerSubmit.mockReset();
  });
  afterEach(() => {
    workflowObj.currentSelectedNodeData = null;
    workflowObj.currentSelectedWorkflow.nodes = [];
    workflowObj.dialog.expand = false;
    vi.clearAllMocks();
  });

  describe("props passed to the shared FunctionPicker", () => {
    it("renders the shared picker", () => {
      const wrapper = createWrapper();
      expect(picker(wrapper).exists()).toBe(true);
    });

    it("renders the picker as optional (empty selection = dummy node)", () => {
      const wrapper = createWrapper();
      expect(picker(wrapper).props("optional")).toBe(true);
    });

    it("uses single-screen mode (create-button, no mode switch)", () => {
      const wrapper = createWrapper();
      expect(picker(wrapper).props("createButton")).toBe(true);
    });

    it("passes an empty initial-name and after-flatten=false by default", () => {
      const wrapper = createWrapper();
      expect(picker(wrapper).props("initialName")).toBe("");
      // Workflow function nodes default After-Flatten to false ([RBF]).
      expect(picker(wrapper).props("initialAfterFlatten")).toBe(false);
    });

    it("seeds initial-name / after-flatten from the saved node data", () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "function", name: "redact", after_flatten: false },
      } as any;
      const wrapper = createWrapper();
      expect(picker(wrapper).props("initialName")).toBe("redact");
      expect(picker(wrapper).props("initialAfterFlatten")).toBe(false);
    });

    it("seeds initial-raw-fn from a saved inline (nameless) node", () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "function", name: "", raw_fn: "() => 1", after_flatten: true },
      } as any;
      const wrapper = createWrapper();
      expect(picker(wrapper).props("initialName")).toBe("");
      expect(picker(wrapper).props("initialRawFn")).toBe("() => 1");
    });

    it("defaults after-flatten to false when only a name is saved", () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "function", name: "redact" },
      } as any;
      const wrapper = createWrapper();
      expect(picker(wrapper).props("initialAfterFlatten")).toBe(false);
    });

    it("seeds the inline editor with the fired-alert sample for an alert trigger", () => {
      seedTrigger("alert_fired");
      const wrapper = createWrapper();
      const events = picker(wrapper).props("sampleEvents");
      expect(events).toEqual(buildTestSample());
      // the envelope the trigger emits: { meta: {...}, data: [ row ] }
      expect(events[0]).toHaveProperty("meta.alert_name");
      expect(Array.isArray(events[0].data)).toBe(true);
    });

    it("seeds the incident sample for an incident trigger", () => {
      seedTrigger("incident_event");
      const wrapper = createWrapper();
      const events = picker(wrapper).props("sampleEvents");
      expect(events).toEqual(buildIncidentSample());
      expect(events[0]).toHaveProperty("meta.incident_id");
      expect(events[0]).toHaveProperty("meta.event_type");
    });

    it("seeds no sample when the workflow has no trigger", () => {
      workflowObj.currentSelectedWorkflow.nodes = [];
      const wrapper = createWrapper();
      expect(picker(wrapper).props("sampleEvents")).toEqual([]);
    });

    it("locks the inline editor to JavaScript and seeds a concise comment", () => {
      const wrapper = createWrapper();
      expect(picker(wrapper).props("language")).toBe("javascript");
      const code = picker(wrapper).props("defaultCode");
      // A concise comment seed (mutate-in-place) — no `return row;` and not the
      // old comment-heavy block that bloated saved functions.
      expect(code).toContain("row.meta");
      expect(code).not.toContain("return row");
      // lean — a few comment lines, not a big worked example
      expect(code.split("\n").length).toBeLessThan(5);
    });
  });

  describe("inline create (@expand)", () => {
    it("widens the drawer by flipping workflowObj.dialog.expand", async () => {
      const wrapper = createWrapper();
      expect(workflowObj.dialog.expand).toBe(false);

      picker(wrapper).vm.$emit("expand", true);
      await wrapper.vm.$nextTick();
      expect(workflowObj.dialog.expand).toBe(true);

      picker(wrapper).vm.$emit("expand", false);
      await wrapper.vm.$nextTick();
      expect(workflowObj.dialog.expand).toBe(false);
    });

    it("resets dialog.expand on unmount", async () => {
      const wrapper = createWrapper();
      picker(wrapper).vm.$emit("expand", true);
      await wrapper.vm.$nextTick();
      expect(workflowObj.dialog.expand).toBe(true);

      wrapper.unmount();
      expect(workflowObj.dialog.expand).toBe(false);
    });
  });

  describe("submit()", () => {
    it("proxies the picker's { name, after_flatten } payload", async () => {
      pickerSubmit.mockResolvedValue({ name: "redact", after_flatten: true });
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toEqual({
        name: "redact",
        after_flatten: true,
      });
      expect(pickerSubmit).toHaveBeenCalledTimes(1);
    });

    it("resolves null when the picker fails validation (returns null)", async () => {
      pickerSubmit.mockResolvedValue(null);
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toBeNull();
    });

    it("normalizes an undefined picker result to null", async () => {
      pickerSubmit.mockResolvedValue(undefined);
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toBeNull();
    });

    it("proxies an inline raw_fn payload and flags incomplete (empty name)", async () => {
      workflowObj.currentSelectedNodeData = { id: "f1", data: { node_type: "function" } } as any;
      pickerSubmit.mockResolvedValue({ name: "", raw_fn: "() => 2", after_flatten: true });
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toEqual({
        name: "",
        raw_fn: "() => 2",
        after_flatten: true,
      });
      // raw_fn has an empty name → treated the same as a dummy (blocks Publish).
      expect(workflowObj.currentSelectedNodeData.meta?.incomplete).toBe("true");
    });
  });

  // Dummy-node model (C1): no "Set up later" toggle. An empty picker result saves
  // the node as a placeholder (empty name + meta.incomplete); a real selection
  // clears it. submit() always defers to the (optional) picker.
  describe("dummy-node placeholder (no toggle)", () => {
    it("does not render a 'Set up later' toggle", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test="workflow-function-set-up-later"]').exists()).toBe(false);
    });

    it("flags meta.incomplete when the picker returns an empty function name", async () => {
      workflowObj.currentSelectedNodeData = {
        id: "f1",
        data: { node_type: "function" },
      } as any;
      pickerSubmit.mockResolvedValue({ name: "", after_flatten: false });
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toEqual({
        name: "",
        after_flatten: false,
      });
      expect(workflowObj.currentSelectedNodeData.meta?.incomplete).toBe("true");
    });

    it("clears meta.incomplete when a real function is chosen", async () => {
      workflowObj.currentSelectedNodeData = {
        id: "f1",
        data: { node_type: "function" },
        meta: { incomplete: "true" },
      } as any;
      pickerSubmit.mockResolvedValue({ name: "redact", after_flatten: false });
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toEqual({
        name: "redact",
        after_flatten: false,
      });
      expect(workflowObj.currentSelectedNodeData.meta?.incomplete).toBeUndefined();
    });
  });
});
