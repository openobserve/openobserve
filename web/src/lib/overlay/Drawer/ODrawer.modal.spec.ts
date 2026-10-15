import { afterEach, describe, it, expect, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import ODrawer from "./ODrawer.vue";
import { DialogContent } from "reka-ui";

// A pass-through portal: the shared spec renders the portal as a second DialogContent, which dismisses on its own.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  const { defineComponent } = await import("vue");
  return {
    ...actual,
    DialogPortal: defineComponent(
      (_, { slots }) =>
        () =>
          slots.default?.(),
    ),
  };
});

// A drawer left mounted keeps reka's body pointer-events lock alive into the next test.
enableAutoUnmount(afterEach);

afterEach(() => {
  document.body.innerHTML = "";
});

function findDrawerPanel(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAllComponents(DialogContent)
    .find((c) => c.attributes("data-o2-drawer") !== undefined)!;
}

describe("ODrawer", () => {
  describe("modal", () => {
    function escapeFrom(target: Element) {
      const ev = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
      target.dispatchEvent(ev);
      return ev;
    }

    async function pointerDownOutside() {
      const outside = document.createElement("div");
      document.body.appendChild(outside);
      // reka registers its document pointerdown listener on a 0ms timer.
      await new Promise((resolve) => setTimeout(resolve));
      outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve));
    }

    it("leaves the page behind interactive when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Lens", modal: false },
      });
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.body.style.pointerEvents).not.toBe("none");
      wrapper.unmount();
    });

    it("blocks the page behind by default", async () => {
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Modal" },
      });
      await new Promise((resolve) => setTimeout(resolve));
      expect(document.body.style.pointerEvents).toBe("none");
      wrapper.unmount();
    });

    it("does not close on an outside pointer-down when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Lens", modal: false },
      });
      await pointerDownOutside();
      expect(wrapper.emitted("update:open")).toBeFalsy();
      wrapper.unmount();
    });

    it("prevents the interact-outside event when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Lens", modal: false },
      });
      const ev = new CustomEvent("interactOutside", {
        cancelable: true,
        detail: { originalEvent: { target: document.body } },
      });
      await findDrawerPanel(wrapper).vm.$emit("interactOutside", ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });

    it("still closes on an outside pointer-down by default", async () => {
      const wrapper = mount(ODrawer, {
        attachTo: document.body,
        props: { open: true, title: "Modal" },
      });
      await pointerDownOutside();
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
      wrapper.unmount();
    });

    it("keeps Escape inside an input or an open popper from closing when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Lens", modal: false },
      });
      const panel = findDrawerPanel(wrapper);
      const input = document.createElement("input");
      const popper = document.createElement("div");
      popper.setAttribute("data-reka-popper-content-wrapper", "");
      const option = document.createElement("span");
      popper.appendChild(option);
      document.body.append(input, popper);

      const fromInput = escapeFrom(input);
      await panel.vm.$emit("escapeKeyDown", fromInput);
      const fromPopper = escapeFrom(option);
      await panel.vm.$emit("escapeKeyDown", fromPopper);

      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(fromInput.defaultPrevented).toBe(true);
      expect(fromPopper.defaultPrevented).toBe(true);
    });

    it("closes on Escape from a non-editable target when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Lens", modal: false },
      });
      const div = document.createElement("div");
      document.body.appendChild(div);
      await findDrawerPanel(wrapper).vm.$emit("escapeKeyDown", escapeFrom(div));
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });

    it("still closes on Escape from an input by default", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Modal" },
      });
      const input = document.createElement("input");
      document.body.appendChild(input);
      await findDrawerPanel(wrapper).vm.$emit("escapeKeyDown", escapeFrom(input));
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });

    it("closes from the close button when modal=false", async () => {
      const wrapper = mount(ODrawer, {
        props: { open: true, title: "Lens", modal: false },
      });
      await wrapper.find('[data-test="o-drawer-close-btn"]').trigger("click");
      expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    });
  });
});
