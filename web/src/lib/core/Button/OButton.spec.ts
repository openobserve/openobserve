import { describe, it, expect, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";
import OButton from "./OButton.vue";
import OButtonGroup from "./OButtonGroup.vue";
import { provideFeatureLock } from "@/composables/useFeatureLock";
import { BUTTON_SIZES, BUTTON_VARIANTS, type ButtonVariant } from "./OButton.types";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";
import { raw } from "@/types/i18n";

const TooltipStub = {
  name: "OTooltip",
  props: ["content", "shortcut"],
  template: `<span class="tooltip-stub" :data-content="content" :data-shortcut="shortcut" />`,
};
const global = { stubs: { OTooltip: TooltipStub } };

describe("OButton", () => {
  describe("API surface", () => {
    it("declares exactly the seven variants and four sizes", () => {
      expect([...BUTTON_VARIANTS]).toEqual([
        "primary",
        "secondary",
        "ghost",
        "accent-ghost",
        "danger",
        "danger-ghost",
        "link",
      ]);
      expect([...BUTTON_SIZES]).toEqual(["xs", "sm", "md", "lg"]);
    });

    it("defaults to a secondary md button, so a forgotten variant is never a primary", () => {
      const wrapper = mount(OButton, { slots: { default: "Export" } });
      expect(wrapper.attributes("data-o2-variant")).toBe("secondary");
      expect(wrapper.attributes("data-o2-size")).toBe("md");
      expect(wrapper.classes()).toContain("h-control-md");
      expect(wrapper.classes()).toContain("border-button-outline-border");
    });

    it.each([
      ["xs", "h-control-xs", "rounded-chip", "text-xs"],
      ["sm", "h-control-sm", "rounded-default", "text-compact"],
      ["md", "h-control-md", "rounded-default", "text-compact"],
      ["lg", "h-control-lg", "rounded-default", "text-sm"],
    ] as const)("sizes %s from the control token", (size, height, radius, text) => {
      const classes = mount(OButton, { props: { size }, slots: { default: "Save" } }).classes();
      expect(classes).toContain(height);
      expect(classes).toContain(radius);
      expect(classes).toContain(text);
      expect(classes.some((c) => /^h-(\d|\[)/.test(c))).toBe(false);
    });

    it("keeps a 6px icon gap at every size above xs", () => {
      for (const size of ["sm", "md", "lg"] as const) {
        expect(mount(OButton, { props: { size } }).classes()).toContain("gap-1.5");
      }
    });

    it.each(BUTTON_VARIANTS)("paints %s with token utilities only", (variant) => {
      const classes = mount(OButton, { props: { variant } }).classes();
      expect(classes.some((c) => /#|rgb\(|-\[(#|rgb)/.test(c))).toBe(false);
    });

    it.each([
      ["primary", "bg-button-primary"],
      ["secondary", "bg-button-secondary"],
      ["ghost", "text-text-secondary"],
      ["accent-ghost", "text-text-link"],
      ["danger", "bg-button-destructive"],
      ["danger-ghost", "text-button-ghost-destructive-text"],
      ["link", "text-text-link"],
    ] satisfies [ButtonVariant, string][])("gives %s its look", (variant, token) => {
      expect(mount(OButton, { props: { variant } }).classes()).toContain(token);
    });

    it("lets a link sit in running text without a control height or padding", () => {
      const classes = mount(OButton, { props: { variant: "link" } }).classes();
      expect(classes).toContain("h-auto");
      expect(classes).toContain("p-0");
      expect(classes).not.toContain("h-control-md");
    });
  });

  describe("content", () => {
    it("renders the label, the leading icon and the trailing icon", () => {
      const wrapper = mount(OButton, {
        props: { icon: "download", iconEnd: "arrow-drop-down", label: raw("Export") },
      });
      expect(wrapper.text()).toBe("Export");
      expect(wrapper.findAll("[aria-hidden='true']").length).toBeGreaterThanOrEqual(2);
    });

    it("lets the slots replace the icons", () => {
      const wrapper = mount(OButton, {
        slots: {
          icon: '<i data-testid="lead" />',
          "icon-end": '<i data-testid="trail" />',
          default: "Run",
        },
      });
      expect(wrapper.find('[data-testid="lead"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="trail"]').exists()).toBe(true);
    });

    it("shows a count pill after the label", () => {
      const wrapper = mount(OButton, { props: { count: 3 }, slots: { default: "Filters" } });
      expect(wrapper.find(".tabular-nums").text()).toBe("3");
    });

    it("paints a lock icon with the locked-icon token", () => {
      const wrapper = mount(OButton, { props: { icon: "lock" }, slots: { default: "Run" } });
      expect(wrapper.find(".lock-chip").exists()).toBe(true);
    });
  });

  describe("iconOnly", () => {
    it("is square at every size and turns its label into the name and the tooltip", () => {
      for (const size of BUTTON_SIZES) {
        const wrapper = mount(OButton, {
          props: { iconOnly: true, icon: "refresh", label: raw("Refresh"), size, shortcut: "r" },
          global,
        });
        expect(wrapper.classes()).toContain(`size-control-${size}`);
        expect(wrapper.attributes("aria-label")).toBe("Refresh");
        expect(wrapper.text()).toBe("");
        const tooltip = wrapper.get(".tooltip-stub");
        expect(tooltip.attributes("data-content")).toBe("Refresh");
        expect(tooltip.attributes("data-shortcut")).toBe("r");
      }
    });

    it("keeps a caller's aria-label over the label", () => {
      const wrapper = mount(OButton, {
        props: { iconOnly: true, icon: "close", label: raw("Close") },
        attrs: { "aria-label": "Close panel" },
        global,
      });
      expect(wrapper.attributes("aria-label")).toBe("Close panel");
    });
  });

  describe("pressed", () => {
    it("renders no aria-pressed for a plain button", () => {
      expect(mount(OButton).attributes("aria-pressed")).toBeUndefined();
    });

    it.each([true, false])("sets aria-pressed=%s for a toggle", (pressed) => {
      const wrapper = mount(OButton, { props: { pressed, variant: "ghost" } });
      expect(wrapper.attributes("aria-pressed")).toBe(String(pressed));
      expect(wrapper.classes().includes("bg-surface-accent-hover")).toBe(pressed);
    });

    it("marks the selected secondary with the selected border, never a fill colour of its own", () => {
      const classes = mount(OButton, { props: { pressed: true } }).classes();
      expect(classes).toContain("text-accent-on-tint");
      expect(classes).toContain("border-button-outline-hover-border");
      expect(classes).not.toContain("bg-button-primary");
    });
  });

  describe("native behaviour", () => {
    it('defaults to type="button" and forwards type', () => {
      expect(mount(OButton).attributes("type")).toBe("button");
      expect(mount(OButton, { props: { type: "submit" } }).attributes("type")).toBe("submit");
    });

    it("emits click with the MouseEvent", async () => {
      const wrapper = mount(OButton);
      await wrapper.trigger("click");
      expect(wrapper.emitted("click")?.[0]?.[0]).toBeInstanceOf(MouseEvent);
    });

    it("sets disabled and aria-disabled and emits no click when disabled", async () => {
      const wrapper = mount(OButton, { props: { disabled: true } });
      expect(wrapper.attributes("disabled")).toBeDefined();
      expect(wrapper.attributes("aria-disabled")).toBe("true");
      expect(wrapper.classes()).toContain("text-text-disabled");
      await wrapper.trigger("click");
      expect(wrapper.emitted("click")).toBeUndefined();
    });

    it("renders an anchor for href, never underlined, without a type", () => {
      const wrapper = mount(OButton, { props: { href: "https://openobserve.ai" } });
      expect(wrapper.element.tagName).toBe("A");
      expect(wrapper.attributes("href")).toBe("https://openobserve.ai");
      expect(wrapper.attributes("type")).toBeUndefined();
      expect(wrapper.classes()).toContain("no-underline");
    });

    it("renders a router link for to", async () => {
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: "/", component: { template: "<div />" } }],
      });
      const wrapper = mount(OButton, {
        props: { to: "/" },
        slots: { default: "Home" },
        global: { plugins: [router] },
      });
      await router.isReady();
      expect(wrapper.element.tagName).toBe("A");
      expect(wrapper.attributes("href")).toBe("/");
    });

    it("blocks a disabled link without a native disabled attribute", () => {
      const wrapper = mount(OButton, { props: { href: "#target", disabled: true } });
      expect(wrapper.attributes("href")).toBeUndefined();
      expect(wrapper.attributes("aria-disabled")).toBe("true");
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      wrapper.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it("renders a div host for an embedded switch", () => {
      expect(mount(OButton, { props: { as: "div" } }).element.tagName).toBe("DIV");
    });

    it("passes extra attributes to the root", () => {
      const wrapper = mount(OButton, { attrs: { "data-test": "save-btn", id: "save" } });
      expect(wrapper.attributes("data-test")).toBe("save-btn");
      expect(wrapper.attributes("id")).toBe("save");
    });

    it("draws an offset outline in the focus-ring token for focus", () => {
      const classes = mount(OButton).classes();
      expect(classes).toContain("focus-visible:outline-focus-ring-accent");
      expect(classes).toContain("focus-visible:outline-offset-2");
    });
  });

  describe("disabledReason", () => {
    it("keeps a disabled action focusable, connects its reason and shows it as the tooltip", async () => {
      const wrapper = mount(OButton, {
        props: { disabled: true, disabledReason: raw("Select alerts to pause them") },
        slots: { default: "Pause" },
        global,
      });
      expect(wrapper.attributes("disabled")).toBeUndefined();
      expect(wrapper.attributes("aria-disabled")).toBe("true");
      const reason = wrapper.get(".sr-only");
      expect(reason.text()).toBe("Select alerts to pause them");
      expect(reason.attributes("aria-hidden")).toBe("true");
      expect(wrapper.attributes("aria-describedby")).toBe(reason.attributes("id"));
      expect(wrapper.get(".tooltip-stub").attributes("data-content")).toBe(
        "Select alerts to pause them",
      );
      const click = new MouseEvent("click", { cancelable: true });
      wrapper.element.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(wrapper.emitted("click")).toBeUndefined();
    });

    it("ignores the reason while the button is enabled", () => {
      const wrapper = mount(OButton, {
        props: { disabledReason: raw("Run first") },
        slots: { default: "Pause" },
        global,
      });
      expect(wrapper.find(".sr-only").exists()).toBe(false);
      expect(wrapper.find(".tooltip-stub").exists()).toBe(false);
      expect(wrapper.attributes("aria-disabled")).toBeUndefined();
    });

    it.each(["Enter", " "])("stops %j before parent or caller activation", (key) => {
      const parentKeydown = vi.fn();
      const callerKeydown = vi.fn();
      const wrapper = mount(OButton, {
        props: { disabled: true, disabledReason: raw("Run first") },
        attrs: { onKeydown: callerKeydown },
        global,
      });
      const parent = document.createElement("div");
      parent.addEventListener("keydown", parentKeydown);
      parent.appendChild(wrapper.element);
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      wrapper.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(parentKeydown).not.toHaveBeenCalled();
      expect(callerKeydown).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it("joins a caller's aria-describedby with the reason", () => {
      const wrapper = mount(OButton, {
        props: { disabled: true, disabledReason: raw("Read only") },
        attrs: { "aria-describedby": "hint" },
        global,
      });
      expect(wrapper.attributes("aria-describedby")).toBe(
        `hint ${wrapper.get(".sr-only").attributes("id")}`,
      );
    });
  });

  describe("stale", () => {
    it("adds the stale dot on top of the variant", () => {
      const wrapper = mount(OButton, { props: { variant: "primary", stale: true } });
      expect(wrapper.find(".bg-warning-500").exists()).toBe(true);
      expect(wrapper.classes()).toContain("bg-button-primary");
      expect(wrapper.attributes("data-o2-stale")).toBe("true");
    });

    it("omits the stale hook when fresh", () => {
      expect(mount(OButton).attributes("data-o2-stale")).toBeUndefined();
    });
  });

  describe("motion", () => {
    it("colours on the shared control timing, never animating the outline", () => {
      const classes = mount(OButton).classes().join(" ");
      expect(classes).toContain("duration-(--duration-control)");
      expect(classes).toContain("ease-(--ease-control)");
      expect(classes).not.toMatch(/transition-\[[^\]]*outline/);
    });
  });

  describe("busy timing", () => {
    afterEach(() => vi.useRealTimers());

    it("is busy at once with its label kept, and shows no spinner yet", async () => {
      vi.useFakeTimers();
      const wrapper = mount(OButton, { props: { loading: true }, slots: { default: "Save" } });
      await nextTick();
      expect(wrapper.attributes("aria-busy")).toBe("true");
      expect(wrapper.attributes("disabled")).toBeUndefined();
      expect(wrapper.find(".animate-spin").exists()).toBe(false);
      await wrapper.trigger("click");
      expect(wrapper.emitted("click")).toBeUndefined();
    });

    it("shows the spinner once the load outlasts the loader delay and keeps the width", async () => {
      vi.useFakeTimers();
      const wrapper = mount(OButton, { props: { loading: true }, slots: { default: "Save" } });
      vi.advanceTimersByTime(LOADER_DELAY_MS);
      await nextTick();
      expect(wrapper.find(".animate-spin").classes()).toContain("o2-motion-keep");
      expect(wrapper.text()).toBe("Save");
      expect(wrapper.find("span.contents").classes()).toContain("text-transparent");
    });

    it("never shows a spinner for a load shorter than the loader delay", async () => {
      vi.useFakeTimers();
      const wrapper = mount(OButton, { slots: { default: "Save" } });
      await wrapper.setProps({ loading: true });
      vi.advanceTimersByTime(200);
      await wrapper.setProps({ loading: false });
      vi.advanceTimersByTime(LOADER_DELAY_MS);
      await nextTick();
      expect(wrapper.find(".animate-spin").exists()).toBe(false);
      expect(wrapper.attributes("aria-busy")).toBeUndefined();
    });

    it("keeps focus when a focused button turns busy", async () => {
      const wrapper = mount(OButton, { slots: { default: "Pause" }, attachTo: document.body });
      (wrapper.element as HTMLButtonElement).focus();
      await wrapper.setProps({ loading: true });
      expect(document.activeElement).toBe(wrapper.element);
      wrapper.unmount();
    });

    it("blocks a busy submit button's default action and its Enter or Space keys", () => {
      const onSubmit = vi.fn((event: Event) => event.preventDefault());
      const wrapper = mount(
        {
          render: () =>
            h("form", { onSubmit }, [h(OButton, { type: "submit", loading: true }, () => "Save")]),
        },
        { attachTo: document.body },
      );
      const button = wrapper.get("button");
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
      button.element.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      expect(onSubmit).not.toHaveBeenCalled();
      for (const key of ["Enter", " "]) {
        const keydown = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        button.element.dispatchEvent(keydown);
        expect(keydown.defaultPrevented).toBe(true);
      }
      wrapper.unmount();
    });
  });

  describe("inside an OButtonGroup", () => {
    it("inherits the group's size unless it sets its own", () => {
      const wrapper = mount({
        render: () =>
          h(OButtonGroup, { size: "sm" }, () => [
            h(OButton, { "data-test": "a" }, () => "A"),
            h(OButton, { "data-test": "b", size: "xs" }, () => "B"),
          ]),
      });
      expect(wrapper.get('[data-test="a"]').attributes("data-o2-size")).toBe("sm");
      expect(wrapper.get('[data-test="b"]').attributes("data-o2-size")).toBe("xs");
    });
  });

  describe("unnamed icon-only dev warning", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    const mountIconOnly = (attrs: Record<string, string> = {}) =>
      mount(OButton, { props: { iconOnly: true }, attrs, slots: { default: () => h("svg") } });

    it("schedules nothing under test", () => {
      vi.useFakeTimers();
      const wrapper = mountIconOnly();
      expect(vi.getTimerCount()).toBe(0);
      wrapper.unmount();
    });

    it("warns after the delay for a button nothing names", () => {
      vi.stubEnv("MODE", "development");
      vi.useFakeTimers();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const wrapper = mountIconOnly();
      expect(warn).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(warn).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    });

    it("stays quiet for a title", () => {
      vi.stubEnv("MODE", "development");
      vi.useFakeTimers();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mountIconOnly({ title: "Delete" });
      vi.advanceTimersByTime(1000);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("inside a license-locked page", () => {
    const mountLocked = (props: Record<string, unknown> = {}) => {
      const Locked = defineComponent({
        setup(_, { slots }) {
          provideFeatureLock(ref("workflows"));
          return () => slots.default?.();
        },
      });
      return mount(Locked, {
        slots: { default: () => h(OButton, { ...props, "data-test": "btn" }, () => "Save") },
      });
    };

    it("renders disabled and emits no click", async () => {
      const button = mountLocked().findComponent(OButton);
      expect(button.attributes("disabled")).toBeDefined();
      expect(button.attributes("aria-disabled")).toBe("true");
      await button.trigger("click");
      expect(button.emitted("click")).toBeUndefined();
    });

    it("blocks an anchor button, which has no native disabled", () => {
      const button = mountLocked({ href: "#target" }).findComponent(OButton);
      expect(button.classes()).toContain("cursor-not-allowed");
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      button.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(button.emitted("click")).toBeUndefined();
    });
  });
});
