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

// WorkflowDestination is a THIN WRAPPER over the shared DestinationPicker (which
// has its own spec). Tested here: the wrapper's own contract —
//   - initial-name seeded from the saved `destination_id`
//   - the picker's { org_id, destination_name } payload REMAPPED to the workflow
//     shape { destination_id, template_override }
//   - `createNewDestination` mirroring the picker's @expand (the drawer reads it
//     to hide its footer while the inline create form is open)

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
vi.mock("@/components/flow/forms/DestinationPicker.vue", () => ({
  default: {
    name: "DestinationPicker",
    props: ["initialName"],
    emits: ["expand"],
    methods: {
      submit: (...args: any[]) => pickerSubmit(...args),
    },
    template: '<div class="destination-picker-stub" />',
  },
}));

import { workflowObj } from "@/plugins/workflows/useWorkflowCanvas";
import WorkflowDestination from "./WorkflowDestination.vue";

function createWrapper() {
  return mount(WorkflowDestination, {
    global: { plugins: [i18n, store] },
  });
}

const picker = (wrapper: any) =>
  wrapper.findComponent({ name: "DestinationPicker" });

describe("WorkflowDestination", () => {
  beforeEach(() => {
    workflowObj.currentSelectedNodeData = null;
    pickerSubmit.mockReset();
  });
  afterEach(() => {
    workflowObj.currentSelectedNodeData = null;
    vi.clearAllMocks();
  });

  describe("props passed to the shared DestinationPicker", () => {
    it("renders the body and the shared picker", () => {
      const wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="workflow-destination-body"]').exists(),
      ).toBe(true);
      expect(picker(wrapper).exists()).toBe(true);
    });

    it("passes an empty initial-name when there is no selected node data", () => {
      const wrapper = createWrapper();
      expect(picker(wrapper).props("initialName")).toBe("");
    });

    it("passes an empty initial-name when the node has no destination_id", () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "destination" },
      } as any;
      const wrapper = createWrapper();
      expect(picker(wrapper).props("initialName")).toBe("");
    });

    it("seeds initial-name from the saved destination_id", () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: { node_type: "destination", destination_id: "sink-a" },
      } as any;
      const wrapper = createWrapper();
      expect(picker(wrapper).props("initialName")).toBe("sink-a");
    });
  });

  describe("createNewDestination (exposed to the drawer)", () => {
    it("starts false", () => {
      const wrapper = createWrapper();
      expect((wrapper.vm as any).createNewDestination).toBe(false);
    });

    it("mirrors the picker's @expand", async () => {
      const wrapper = createWrapper();
      picker(wrapper).vm.$emit("expand", true);
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).createNewDestination).toBe(true);

      picker(wrapper).vm.$emit("expand", false);
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).createNewDestination).toBe(false);
    });
  });

  describe("submit()", () => {
    it("remaps destination_name -> destination_id and defaults template_override to null", async () => {
      pickerSubmit.mockResolvedValue({
        org_id: "default",
        destination_name: "sink-a",
      });
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toEqual({
        destination_id: "sink-a",
        template_override: null,
      });
      // the picker's org_id is NOT carried into the workflow node payload
      expect(
        Object.keys(await (wrapper.vm as any).submit()),
      ).toEqual(["destination_id", "template_override"]);
    });

    it("preserves an existing template_override from the saved node data", async () => {
      workflowObj.currentSelectedNodeData = {
        id: "n1",
        data: {
          node_type: "destination",
          destination_id: "sink-a",
          template_override: "custom-tpl",
        },
      } as any;
      pickerSubmit.mockResolvedValue({
        org_id: "default",
        destination_name: "sink-b",
      });
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toEqual({
        destination_id: "sink-b",
        template_override: "custom-tpl",
      });
    });

    it("resolves null when the picker fails validation (returns null)", async () => {
      pickerSubmit.mockResolvedValue(null);
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toBeNull();
    });

    it("resolves null when the picker returns undefined", async () => {
      pickerSubmit.mockResolvedValue(undefined);
      const wrapper = createWrapper();
      await expect((wrapper.vm as any).submit()).resolves.toBeNull();
    });
  });
});
