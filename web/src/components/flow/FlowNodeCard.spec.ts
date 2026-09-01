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

// FlowNodeCard is the SHARED node card rendered by BOTH the pipeline CustomNode
// and the workflow WorkflowNode. It is purely presentational — no composable
// coupling — so every test here is prop/slot driven.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";

// VueFlow's Handle needs a running VueFlow instance, so it is mocked. The stub
// keeps `type` / `position` observable (that is what the card actually drives)
// and lets `data-test` fall through to its root element.
vi.mock("@vue-flow/core", () => ({
  Handle: {
    name: "Handle",
    props: ["id", "type", "position"],
    template:
      '<div class="mock-handle" :data-handle-id="id" :data-handle-type="type" :data-position="position" />',
  },
  Position: {
    Left: "left",
    Top: "top",
    Right: "right",
    Bottom: "bottom",
  },
}));

import FlowNodeCard from "@/components/flow/FlowNodeCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

function mountCard(props: Record<string, any> = {}, options: Record<string, any> = {}) {
  return mount(FlowNodeCard as any, { props, ...options });
}

const handles = (wrapper: any) => wrapper.findAll(".mock-handle");
const inputHandle = (wrapper: any) => wrapper.find('[data-handle-type="target"]');
const outputHandle = (wrapper: any) => wrapper.find('[data-handle-type="source"]');

describe("FlowNodeCard", () => {
  let wrapper: any = null;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.clearAllMocks();
  });

  describe("mounting + structure", () => {
    it("mounts with no props at all (every prop has a default)", () => {
      wrapper = mountCard();
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".flow-node").exists()).toBe(true);
    });

    it("renders the icon slot area, a vertical separator and the body container", () => {
      wrapper = mountCard();
      expect(wrapper.find(".flow-node__icon").exists()).toBe(true);
      expect(wrapper.find(".flow-node__container").exists()).toBe(true);
      expect(wrapper.findComponent({ name: "OSeparator" }).exists()).toBe(true);
    });

    it("puts the shared node typography on the body container (text-sm / bold)", () => {
      wrapper = mountCard();
      // Was an arbitrary 0.9375rem (15px). There is no 15px step in the type
      // scale, so it was off-scale by definition and the design guard rejects it;
      // text-sm (14px) is the nearest registered step and is what main picked for
      // the same node label in the pipeline CustomNode, so both canvases agree.
      // Pinned here because this card is shared — a change lands on EVERY node
      // type at once.
      const classes = wrapper.find(".flow-node__container").classes();
      expect(classes).toContain("text-sm!");
      expect(classes).toContain("font-bold!");
      expect(classes).toContain("text-left");
    });
  });

  describe("icon prop", () => {
    it("passes the given glyph name to OIcon", () => {
      wrapper = mountCard({ icon: "code" });
      expect(wrapper.findComponent(OIcon).props("name")).toBe("code");
    });

    it('defaults to the "help" glyph when icon is not supplied', () => {
      wrapper = mountCard();
      expect(wrapper.findComponent(OIcon).props("name")).toBe("help");
    });

    it('falls back to "help" when icon is an empty string', () => {
      wrapper = mountCard({ icon: "" });
      expect(wrapper.findComponent(OIcon).props("name")).toBe("help");
    });

    it('renders an "img:<url>" icon as an image (pipeline node parity)', () => {
      wrapper = mountCard({ icon: "img:/images/pipeline/transform_function.png" });
      expect(wrapper.findComponent(OIcon).props("name")).toBe(
        "img:/images/pipeline/transform_function.png",
      );
      expect(wrapper.find("img").exists()).toBe(true);
    });
  });

  describe("handles: presence per hasInput / hasOutput", () => {
    it("renders both handles by default", () => {
      wrapper = mountCard();
      expect(handles(wrapper)).toHaveLength(2);
      expect(inputHandle(wrapper).exists()).toBe(true);
      expect(outputHandle(wrapper).exists()).toBe(true);
    });

    it("renders only the source handle for an input (trigger) node", () => {
      wrapper = mountCard({ ioType: "input", hasInput: false, hasOutput: true });
      expect(handles(wrapper)).toHaveLength(1);
      expect(inputHandle(wrapper).exists()).toBe(false);
      expect(outputHandle(wrapper).exists()).toBe(true);
    });

    it("renders only the target handle for an output (terminal) node", () => {
      wrapper = mountCard({ ioType: "output", hasInput: true, hasOutput: false });
      expect(handles(wrapper)).toHaveLength(1);
      expect(inputHandle(wrapper).exists()).toBe(true);
      expect(outputHandle(wrapper).exists()).toBe(false);
    });

    it("renders no handles when both are disabled", () => {
      wrapper = mountCard({ hasInput: false, hasOutput: false });
      expect(handles(wrapper)).toHaveLength(0);
    });

    it('gives the handles the fixed "input" / "output" ids', () => {
      wrapper = mountCard();
      expect(inputHandle(wrapper).attributes("data-handle-id")).toBe("input");
      expect(outputHandle(wrapper).attributes("data-handle-id")).toBe("output");
    });
  });

  // Multi-handle source nodes (workflow Branch: true/false, N-way Switch). This
  // card is SHARED with the Pipelines canvas, so the multi-handle support must be
  // ADDITIVE — omitting `outputHandles` has to keep today's single id="output"
  // handle or every pipeline node regresses.
  describe("handles: multiple source handles (outputHandles)", () => {
    const sourceHandles = (w: any) => w.findAll('[data-handle-type="source"]');

    it("renders one source handle per declared outputHandle", () => {
      wrapper = mountCard({ outputHandles: [{ id: "true" }, { id: "false" }] });
      expect(sourceHandles(wrapper)).toHaveLength(2);
    });

    it("gives each source handle its declared id, in order", () => {
      wrapper = mountCard({ outputHandles: [{ id: "true" }, { id: "false" }] });
      const ids = sourceHandles(wrapper).map((h: any) => h.attributes("data-handle-id"));
      expect(ids).toEqual(["true", "false"]);
    });

    it("generalises past two — an N-way switch renders N source handles", () => {
      wrapper = mountCard({
        outputHandles: [{ id: "case-0" }, { id: "case-1" }, { id: "case-2" }, { id: "else" }],
      });
      expect(sourceHandles(wrapper).map((h: any) => h.attributes("data-handle-id"))).toEqual([
        "case-0",
        "case-1",
        "case-2",
        "else",
      ]);
    });

    it("still honours hasOutput=false — a terminal node has no source handle", () => {
      wrapper = mountCard({ hasOutput: false, outputHandles: [{ id: "true" }, { id: "false" }] });
      expect(sourceHandles(wrapper)).toHaveLength(0);
    });

    // Pipelines compatibility: these three are the CURRENT behaviour and must keep
    // passing after the prop lands.
    it("PIPELINE COMPAT: renders exactly one source handle when outputHandles is omitted", () => {
      wrapper = mountCard();
      expect(sourceHandles(wrapper)).toHaveLength(1);
      expect(sourceHandles(wrapper)[0].attributes("data-handle-id")).toBe("output");
    });

    it('PIPELINE COMPAT: an empty outputHandles array still yields the single "output" handle', () => {
      wrapper = mountCard({ outputHandles: [] });
      expect(sourceHandles(wrapper)).toHaveLength(1);
      expect(sourceHandles(wrapper)[0].attributes("data-handle-id")).toBe("output");
    });

    it("emits outputClick with the handle id so the wrapper knows WHICH branch was clicked", async () => {
      wrapper = mountCard({ outputHandles: [{ id: "true" }, { id: "false" }] });
      await sourceHandles(wrapper)[1].trigger("click");
      const emitted = wrapper.emitted("outputClick");
      expect(emitted).toBeTruthy();
      expect(emitted[0][1]).toBe("false");
    });
  });

  // P0 — every fan-out handle used to render at the SAME coordinates (VueFlow pins
  // `.vue-flow__handle-bottom` at left:50%), so a Branch's arms were physically
  // unclickable and no drag could ever name an arm. Each handle must carry its own
  // offset.
  describe("handles: fan-out handles are spread, not stacked", () => {
    const sourceHandles = (w: any) => w.findAll('[data-handle-type="source"]');
    const offsets = (w: any) => sourceHandles(w).map((h: any) => h.attributes("style") || "");

    it("gives each of a 3-arm branch a DISTINCT offset", () => {
      wrapper = mountCard({ outputHandles: [{ id: "case-0" }, { id: "case-1" }, { id: "else" }] });
      const seen = offsets(wrapper);
      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(3);
    });

    it("spreads them evenly across the card at (i+1)/(n+1)", () => {
      wrapper = mountCard({ outputHandles: [{ id: "case-0" }, { id: "case-1" }, { id: "else" }] });
      const seen = offsets(wrapper);
      expect(seen[0]).toContain("25%");
      expect(seen[1]).toContain("50%");
      expect(seen[2]).toContain("75%");
    });

    it("two arms sit at a third and two thirds", () => {
      wrapper = mountCard({ outputHandles: [{ id: "true" }, { id: "false" }] });
      const seen = offsets(wrapper);
      expect(new Set(seen).size).toBe(2);
      expect(seen[0]).toContain("33.333");
      expect(seen[1]).toContain("66.666");
    });

    it("degrades to many arms — 8 handles are still all distinct and inside the card", () => {
      const many = Array.from({ length: 8 }, (_, i) => ({ id: `case-${i}` }));
      wrapper = mountCard({ outputHandles: many });
      const seen = offsets(wrapper);
      expect(seen).toHaveLength(8);
      expect(new Set(seen).size).toBe(8);
      for (const s of seen) {
        const pct = Number(/(-?[\d.]+)%/.exec(s)?.[1]);
        expect(pct).toBeGreaterThan(0);
        expect(pct).toBeLessThan(100);
      }
    });

    // The offset is keyed off the handle's POSITION AMONG THE RENDERED ARMS, but the
    // arms themselves are stable ids with gaps (case-0, case-2, else) — a gap must
    // not collapse two handles onto each other.
    it("a deleted middle path (case-0, case-2, else) still yields three distinct offsets", () => {
      wrapper = mountCard({ outputHandles: [{ id: "case-0" }, { id: "case-2" }, { id: "else" }] });
      const seen = offsets(wrapper);
      expect(new Set(seen).size).toBe(3);
      expect(sourceHandles(wrapper).map((h: any) => h.attributes("data-handle-id"))).toEqual([
        "case-0",
        "case-2",
        "else",
      ]);
    });

    it("PIPELINE COMPAT: a single-output node gets NO offset override at all", () => {
      wrapper = mountCard();
      expect(sourceHandles(wrapper)[0].attributes("style")).toBeFalsy();
    });

    it("PIPELINE COMPAT: an empty outputHandles array also gets no offset override", () => {
      wrapper = mountCard({ outputHandles: [] });
      expect(sourceHandles(wrapper)[0].attributes("style")).toBeFalsy();
    });
  });

  describe("handles: position", () => {
    it("defaults the input handle to top and the output handle to bottom", () => {
      wrapper = mountCard();
      expect(inputHandle(wrapper).attributes("data-position")).toBe("top");
      expect(outputHandle(wrapper).attributes("data-position")).toBe("bottom");
    });

    it("honours custom input/output positions", () => {
      wrapper = mountCard({ inputPosition: "left", outputPosition: "right" });
      expect(inputHandle(wrapper).attributes("data-position")).toBe("left");
      expect(outputHandle(wrapper).attributes("data-position")).toBe("right");
    });
  });

  describe("handles: colour class from ioType", () => {
    it.each([
      ["input", "handle_input"],
      ["output", "handle_output"],
      ["default", "handle_default"],
    ])("ioType=%s -> %s", (ioType, expected) => {
      wrapper = mountCard({ ioType });
      const classes = inputHandle(wrapper).classes();
      expect(classes).toContain("node_handle_custom");
      expect(classes).toContain(expected);
    });

    it("defaults to handle_default when ioType is not supplied", () => {
      wrapper = mountCard();
      expect(inputHandle(wrapper).classes()).toContain("handle_default");
    });

    it("falls back to handle_default when ioType is an empty string", () => {
      wrapper = mountCard({ ioType: "" });
      expect(inputHandle(wrapper).classes()).toContain("handle_default");
    });

    it("applies the same class to both handles", () => {
      wrapper = mountCard({ ioType: "input" });
      expect(outputHandle(wrapper).classes()).toContain("handle_input");
    });
  });

  describe("inputHandleTest / outputHandleTest (preserve pipeline E2E selectors)", () => {
    it("stamps the given data-test on each handle", () => {
      wrapper = mountCard({
        inputHandleTest: "pipeline-node-input-handle",
        outputHandleTest: "pipeline-node-output-handle",
      });
      expect(wrapper.find('[data-test="pipeline-node-input-handle"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="pipeline-node-output-handle"]').exists()).toBe(true);
    });

    it("omits data-test on the handles when the props are not supplied (workflow case)", () => {
      wrapper = mountCard();
      expect(inputHandle(wrapper).attributes("data-test")).toBeUndefined();
      expect(outputHandle(wrapper).attributes("data-test")).toBeUndefined();
    });
  });

  describe("slots", () => {
    it("renders #body content inside the body container", () => {
      wrapper = mountCard(
        {},
        { slots: { body: '<div class="my-body">Send To Destination</div>' } },
      );
      const container = wrapper.find(".flow-node__container");
      expect(container.find(".my-body").exists()).toBe(true);
      expect(container.text()).toBe("Send To Destination");
    });

    it("renders an empty body container when no #body slot is given (pipelines pass content via #body only)", () => {
      wrapper = mountCard();
      expect(wrapper.find(".flow-node__container").text()).toBe("");
    });

    it("renders #actions content (hover buttons) at the card root", () => {
      wrapper = mountCard({}, { slots: { actions: '<button class="delete-btn">x</button>' } });
      expect(wrapper.find(".delete-btn").exists()).toBe(true);
    });

    it("renders #footer content (hover-`+`) at the card root", () => {
      wrapper = mountCard({}, { slots: { footer: '<button class="add-btn">+</button>' } });
      expect(wrapper.find(".add-btn").exists()).toBe(true);
    });

    it("renders all three slots together", () => {
      wrapper = mountCard(
        {},
        {
          slots: {
            body: "<span class='b'>b</span>",
            actions: "<span class='a'>a</span>",
            footer: "<span class='f'>f</span>",
          },
        },
      );
      expect(wrapper.find(".b").exists()).toBe(true);
      expect(wrapper.find(".a").exists()).toBe(true);
      expect(wrapper.find(".f").exists()).toBe(true);
    });
  });

  describe("native event fall-through (the wrapper supplies the interactions)", () => {
    it("forwards click / mouseenter / mouseleave to the listeners on the root element", async () => {
      const onClick = vi.fn();
      const onMouseenter = vi.fn();
      const onMouseleave = vi.fn();
      wrapper = mountCard({}, { attrs: { onClick, onMouseenter, onMouseleave } });

      await wrapper.find(".flow-node").trigger("click");
      await wrapper.find(".flow-node").trigger("mouseenter");
      await wrapper.find(".flow-node").trigger("mouseleave");

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onMouseenter).toHaveBeenCalledTimes(1);
      expect(onMouseleave).toHaveBeenCalledTimes(1);
    });

    it("lets a slotted delete button run its own handler (delete is owned by the wrapper)", async () => {
      const onDelete = vi.fn();
      wrapper = mountCard(
        {},
        {
          slots: {
            actions: {
              template: '<button class="del" @click.stop="onDelete">x</button>',
              setup: () => ({ onDelete }),
            },
          },
          attrs: { onClick: vi.fn() },
        },
      );
      await wrapper.find(".del").trigger("click");
      expect(onDelete).toHaveBeenCalledTimes(1);
    });

    it("lets a slotted add-next `+` button run its own handler", async () => {
      const onAdd = vi.fn();
      wrapper = mountCard(
        {},
        {
          slots: {
            footer: {
              template: '<button class="plus" @click.stop="onAdd">+</button>',
              setup: () => ({ onAdd }),
            },
          },
        },
      );
      await wrapper.find(".plus").trigger("click");
      expect(onAdd).toHaveBeenCalledTimes(1);
    });

    it("forwards an arbitrary data-test attribute to the root element", () => {
      wrapper = mountCard({}, { attrs: { "data-test": "workflow-node-condition" } });
      expect(wrapper.find('[data-test="workflow-node-condition"]').classes()).toContain(
        "flow-node",
      );
    });
  });

  describe("reactivity", () => {
    it("re-computes the handle class when ioType changes", async () => {
      wrapper = mountCard({ ioType: "default" });
      expect(inputHandle(wrapper).classes()).toContain("handle_default");
      await wrapper.setProps({ ioType: "output" });
      expect(inputHandle(wrapper).classes()).toContain("handle_output");
    });

    it("adds/removes handles when hasInput / hasOutput change", async () => {
      wrapper = mountCard();
      expect(handles(wrapper)).toHaveLength(2);
      await wrapper.setProps({ hasInput: false });
      expect(handles(wrapper)).toHaveLength(1);
      await wrapper.setProps({ hasOutput: false });
      expect(handles(wrapper)).toHaveLength(0);
    });
  });
});
