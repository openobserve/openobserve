import { describe, it, expect, vi, afterEach } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import ODropdown from "./ODropdown.vue";

// Reka UI portals content into <body>. Disable portal for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    DropdownMenuPortal: actual.DropdownMenuContent, // render inline
  };
});

describe("ODropdown", () => {
  it("renders the trigger slot", () => {
    const wrapper = mount(ODropdown, {
      slots: { trigger: '<button data-testid="trigger">Open</button>' },
    });
    expect(wrapper.find('[data-testid="trigger"]').exists()).toBe(true);
  });

  it("is closed by default", () => {
    const wrapper = mount(ODropdown, {
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Menu</div>',
      },
    });
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(false);
  });

  it("emits update:open when the trigger is clicked", async () => {
    const wrapper = mount(ODropdown, {
      slots: { trigger: "<button>Open</button>" },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:open")).toBeDefined();
  });

  it("shows content when open=true", () => {
    const wrapper = mount(ODropdown, {
      props: { open: true },
      slots: {
        trigger: "<button>Open</button>",
        default: '<div data-testid="content">Menu</div>',
      },
    });
    expect(wrapper.find('[data-testid="content"]').exists()).toBe(true);
  });

  // A caller that opens a popover from an item must be able to stop focus going back to the trigger.
  it("forwards the content's close-auto-focus event", async () => {
    const wrapper = mount(ODropdown, {
      props: { open: true },
      slots: { trigger: "<button>Open</button>", default: "<div>Menu</div>" },
    });
    const event = new Event("focus");
    // The portal is stubbed with a content component, so the real content is the inner one.
    wrapper
      .findAllComponents({ name: "DropdownMenuContent" })
      .at(-1)!
      .vm.$emit("closeAutoFocus", event);
    expect(wrapper.emitted("close-auto-focus")?.[0]).toEqual([event]);
  });

  describe("close on scroll", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let frameSpies: { mockRestore: () => void }[] = [];

    // The trigger check runs in a frame callback, so the tests drive frames by hand.
    function stubFrames() {
      frameSpies = [
        vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
          frames.set(++nextFrame, cb);
          return nextFrame;
        }),
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
          frames.delete(id);
        }),
      ];
    }

    function runFrames() {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((cb) => cb(0));
    }

    afterEach(() => {
      frames.clear();
      frameSpies.forEach((spy) => spy.mockRestore());
      frameSpies = [];
    });

    async function openDropdown() {
      const wrapper = mount(ODropdown, {
        attachTo: document.body,
        props: { open: false },
        slots: { trigger: "<button>Open</button>", default: "<div>Menu</div>" },
      });
      await wrapper.setProps({ open: true });
      await nextTick();
      stubFrames();
      return wrapper;
    }

    // Scroll events are dispatched a frame late, so one queued before the open arrives after it.
    it("stays open on a scroll that did not move the trigger", async () => {
      const wrapper = await openDropdown();
      document.dispatchEvent(new Event("scroll"));
      runFrames();
      expect(wrapper.emitted("update:open")).toBeUndefined();
      wrapper.unmount();
    });

    it("closes on a scroll that moved the trigger", async () => {
      const wrapper = await openDropdown();
      const rect = vi
        .spyOn(Element.prototype, "getBoundingClientRect")
        .mockReturnValue(new DOMRect(0, 40, 10, 10));
      try {
        document.dispatchEvent(new Event("scroll"));
        runFrames();
      } finally {
        rect.mockRestore();
      }
      expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
      wrapper.unmount();
    });

    it("measures the trigger at most once per frame", async () => {
      const wrapper = await openDropdown();
      const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
      try {
        for (let i = 0; i < 3; i++) document.dispatchEvent(new Event("scroll"));
        expect(rect).not.toHaveBeenCalled();
        runFrames();
        expect(rect).toHaveBeenCalledTimes(1);
      } finally {
        rect.mockRestore();
      }
      wrapper.unmount();
    });
  });
});
