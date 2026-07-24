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
vi.mock("@/services/workflows", () => ({ default: {} }));

const pickerSubmit = vi.fn();
vi.mock("@/components/flow/forms/FunctionPicker.vue", () => ({
  default: {
    name: "FunctionPicker",
    props: ["initialName", "initialAfterFlatten", "sampleEvents", "language", "defaultCode"],
    emits: ["expand"],
    methods: {
      submit: (...args: any[]) => pickerSubmit(...args),
    },
    template: '<div class="function-picker-stub" />',
  },
}));

import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import { buildTestSample } from "@/plugins/workflows/testSample";
import WorkflowFunction from "./WorkflowFunction.vue";

function createWrapper() {
  return mount(WorkflowFunction, { global: { plugins: [i18n, store] } });
}

const picker = (wrapper: any) => wrapper.findComponent({ name: "FunctionPicker" });

describe("WorkflowFunction", () => {
  beforeEach(() => {
    workflowObj.currentSelectedNodeData = null;
    workflowObj.dialog.expand = false;
    pickerSubmit.mockReset();
  });
  afterEach(() => {
    workflowObj.currentSelectedNodeData = null;
    workflowObj.dialog.expand = false;
    vi.clearAllMocks();
  });

  describe("props passed to the shared FunctionPicker", () => {
    it("renders the shared picker", () => {
      const wrapper = createWrapper();
      expect(picker(wrapper).exists()).toBe(true);
    });

    it("passes an empty initial-name and after-flatten=true by default", () => {
      const wrapper = createWrapper();
      expect(picker(wrapper).props("initialName")).toBe("");
      expect(picker(wrapper).props("initialAfterFlatten")).toBe(true);
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

    it("defaults after-flatten to true when only a name is saved", () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "function", name: "redact" },
      } as any;
      const wrapper = createWrapper();
      expect(picker(wrapper).props("initialAfterFlatten")).toBe(true);
    });

    it("seeds the inline editor with the fired-alert sample payload", () => {
      const wrapper = createWrapper();
      const events = picker(wrapper).props("sampleEvents");
      expect(events).toEqual(buildTestSample());
      // the envelope the trigger emits: { meta: {...}, data: [ row ] }
      expect(events[0]).toHaveProperty("meta.alert_name");
      expect(Array.isArray(events[0].data)).toBe(true);
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
  });
});
