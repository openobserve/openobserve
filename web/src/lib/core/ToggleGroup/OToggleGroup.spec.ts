import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { h } from "vue";
import OToggleGroup from "./OToggleGroup.vue";
import OToggleGroupItem from "./OToggleGroupItem.vue";

function mountGroup(
  groupProps: Record<string, unknown> = {},
  items: Array<{ value: string; label: string; disabled?: boolean }> = [],
) {
  return mount(OToggleGroup, {
    props: groupProps,
    slots: {
      default: items.map((item) =>
        h(
          OToggleGroupItem,
          { value: item.value, disabled: item.disabled },
          () => item.label,
        ),
      ),
    },
  });
}

describe("OToggleGroup", () => {
  // --- Defaults ---

  it("renders without crashing", () => {
    const wrapper = mountGroup();
    expect(wrapper.exists()).toBe(true);
  });

  it("applies horizontal flex class by default", () => {
    const wrapper = mountGroup();
    const element = wrapper.find("div").element as HTMLElement;
    expect(element.getAttribute("class") || "").toContain("flex-row");
  });

  it("applies outer border class", () => {
    const wrapper = mountGroup();
    const element = wrapper.find("div").element as HTMLElement;
    expect(element.getAttribute("class") || "").toContain("border");
  });

  // --- Orientation ---

  it('applies vertical flex class when orientation="vertical"', () => {
    const wrapper = mountGroup({ orientation: "vertical" });
    const element = wrapper.find("div").element as HTMLElement;
    expect(element.getAttribute("class") || "").toContain("flex-col");
  });

  // --- Children ---

  it("renders OToggleGroupItem children", () => {
    const wrapper = mountGroup({}, [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ]);
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("B");
  });

  // --- Controlled value ---

  it("emits update:modelValue when an item is clicked", async () => {
    const wrapper = mountGroup({ modelValue: "" }, [
      { value: "left", label: "Left" },
    ]);
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeDefined();
  });

  // --- v-model: active item has data-state=on ---

  it('marks the active item with data-state="on"', async () => {
    const wrapper = mountGroup({ modelValue: "left" }, [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ]);
    const buttons = wrapper.findAll("button");
    expect(buttons[0].attributes("data-state")).toBe("on");
    expect(buttons[1].attributes("data-state")).toBe("off");
  });

  // --- Drag to reorder (opt-in via `reorderable`) ---

  describe("reorderable", () => {
    /**
     * jsdom has no DataTransfer implementation, so drag events carry this
     * stand-in. Only setData/getData and the two effect fields are used.
     */
    function makeDataTransfer() {
      const store: Record<string, string> = {};
      return {
        effectAllowed: "",
        dropEffect: "",
        setData: (key: string, value: string) => {
          store[key] = value;
        },
        getData: (key: string) => store[key] ?? "",
      };
    }

    /**
     * jsdom reports a zero-sized rect for every element, which would make the
     * before/after midpoint test meaningless. Give the item a real box so the
     * pointer coordinate decides the drop side.
     */
    function stubRect(el: Element, box: { left: number; top: number }) {
      const WIDTH = 100;
      const HEIGHT = 20;
      el.getBoundingClientRect = () =>
        ({
          left: box.left,
          top: box.top,
          width: WIDTH,
          height: HEIGHT,
          right: box.left + WIDTH,
          bottom: box.top + HEIGHT,
          x: box.left,
          y: box.top,
          toJSON: () => ({}),
        }) as DOMRect;
    }

    function itemAt(wrapper: ReturnType<typeof mountGroup>, value: string) {
      return wrapper.get(`[data-otoggle-value="${value}"]`);
    }

    /** Drags `from` onto `to`, releasing at the given viewport coordinate. */
    async function dragOnto(
      wrapper: ReturnType<typeof mountGroup>,
      from: string,
      to: string,
      pointer: { clientX?: number; clientY?: number } = {},
    ) {
      const dataTransfer = makeDataTransfer();
      const target = itemAt(wrapper, to);
      stubRect(target.element, { left: 0, top: 0 });

      await itemAt(wrapper, from).trigger("dragstart", { dataTransfer });
      await target.trigger("dragover", {
        dataTransfer,
        clientX: 0,
        clientY: 0,
        ...pointer,
      });
      await target.trigger("drop", { dataTransfer });
    }

    const ITEMS = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
      { value: "c", label: "C" },
    ];

    it("does not mark items draggable by default", () => {
      const wrapper = mountGroup({}, ITEMS);
      expect(itemAt(wrapper, "a").attributes("draggable")).toBeUndefined();
    });

    it("marks items draggable when reorderable", () => {
      const wrapper = mountGroup({ reorderable: true }, ITEMS);
      expect(itemAt(wrapper, "a").attributes("draggable")).toBe("true");
    });

    it("never marks a disabled item draggable", () => {
      const wrapper = mountGroup({ reorderable: true }, [
        { value: "a", label: "A" },
        { value: "b", label: "B", disabled: true },
      ]);
      expect(itemAt(wrapper, "b").attributes("draggable")).toBeUndefined();
    });

    it("emits reorder with before=true when dropped on the target's leading half", async () => {
      const wrapper = mountGroup({ reorderable: true }, ITEMS);
      // Item spans x 0..100; release at x=10 → leading half.
      await dragOnto(wrapper, "a", "c", { clientX: 10 });

      expect(wrapper.emitted("reorder")).toHaveLength(1);
      expect(wrapper.emitted("reorder")![0][0]).toEqual({
        from: "a",
        to: "c",
        before: true,
      });
    });

    it("emits reorder with before=false when dropped on the target's trailing half", async () => {
      const wrapper = mountGroup({ reorderable: true }, ITEMS);
      // Release at x=90 → past the midpoint, so the item lands after the target.
      await dragOnto(wrapper, "a", "c", { clientX: 90 });

      expect(wrapper.emitted("reorder")![0][0]).toEqual({
        from: "a",
        to: "c",
        before: false,
      });
    });

    it("uses the vertical midpoint when orientation is vertical", async () => {
      const wrapper = mountGroup(
        { reorderable: true, orientation: "vertical" },
        ITEMS,
      );
      // Item spans y 0..20. x is deliberately past the horizontal midpoint to
      // prove the vertical axis is the one being consulted.
      await dragOnto(wrapper, "a", "c", { clientX: 90, clientY: 2 });

      expect(wrapper.emitted("reorder")![0][0]).toMatchObject({ before: true });
    });

    it("does not emit reorder when an item is dropped on itself", async () => {
      const wrapper = mountGroup({ reorderable: true }, ITEMS);
      await dragOnto(wrapper, "a", "a", { clientX: 10 });

      expect(wrapper.emitted("reorder")).toBeUndefined();
    });

    it("does not emit reorder when reorderable is false", async () => {
      const wrapper = mountGroup({}, ITEMS);
      await dragOnto(wrapper, "a", "c", { clientX: 10 });

      expect(wrapper.emitted("reorder")).toBeUndefined();
    });

    it("dims the dragged item and clears the state on dragend", async () => {
      const wrapper = mountGroup({ reorderable: true }, ITEMS);
      const dragged = itemAt(wrapper, "a");

      await dragged.trigger("dragstart", { dataTransfer: makeDataTransfer() });
      expect(dragged.classes()).toContain("opacity-40");

      await dragged.trigger("dragend");
      expect(itemAt(wrapper, "a").classes()).not.toContain("opacity-40");
    });
  });
});
