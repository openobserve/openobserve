import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, provide, computed, reactive } from "vue";
import { routeLocationKey, routerKey } from "vue-router";
import { TabsRoot, TabsList } from "reka-ui";
import OTab from "./OTab.vue";
import { TABS_CONTEXT_KEY } from "./OTabs.types";
import type { TabsContext } from "./OTabs.types";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Mount OTab inside the required TabsRoot > TabsList ancestor chain that
 * TabsTrigger (used internally) needs for its context injection.
 * The TABS_CONTEXT_KEY context is also provided so OTab's isCompact /
 * isVertical / isActive computed properties work correctly.
 */
function mountTab(
  options: {
    name?: string | number;
    label?: string;
    icon?: string;
    disabled?: boolean;
    activeTab?: string | number;
    isVertical?: boolean;
    size?: "page" | "compact";
    reorderable?: boolean;
    disableDrag?: boolean;
    locked?: boolean;
    lockedLabel?: string;
    count?: number | null;
    countTone?: "default" | "error";
    dirty?: boolean;
    tooltip?: string;
    slots?: Record<string, string>;
  } = {},
) {
  const {
    name = "tab1",
    label,
    icon,
    disabled = false,
    activeTab = "tab1",
    isVertical = false,
    size = "page",
    reorderable = false,
    disableDrag = false,
    locked,
    lockedLabel,
    count,
    countTone,
    dirty,
    tooltip,
    slots = {},
  } = options;

  const Wrapper = defineComponent({
    name: "TabTestWrapper",
    components: { TabsRoot, TabsList, OTab },
    setup() {
      provide(
        TABS_CONTEXT_KEY,
        computed<TabsContext>(() => ({
          modelValue: activeTab,
          isVertical,
          size,
          reorderable,
          collapseLabels: false,
          draggingName: null,
          dropTargetName: null,
          dropBefore: true,
          onTabClick: () => {},
        })),
      );
      return {
        tabProps: {
          name,
          label,
          icon,
          disabled,
          disableDrag,
          locked,
          lockedLabel,
          count,
          countTone,
          dirty,
          tooltip,
        },
        modelValue: activeTab,
        orientation: isVertical ? "vertical" : "horizontal",
      };
    },
    template: `
      <TabsRoot :model-value="modelValue" :orientation="orientation">
        <TabsList>
          <OTab v-bind="tabProps">
            <slot />
            <template v-if="$slots.trailing" #trailing><slot name="trailing" /></template>
          </OTab>
        </TabsList>
      </TabsRoot>
    `,
  });

  return mount(Wrapper, {
    slots,
    attachTo: document.body,
  });
}

// ─── OTab ────────────────────────────────────────────────────────────────────

describe("OTab", () => {
  // --- ARIA ---

  it('renders with role="tab"', () => {
    const wrapper = mountTab();
    expect(wrapper.find('[role="tab"]').attributes("role")).toBe("tab");
  });

  it('sets aria-selected="true" when it is the active tab', () => {
    const wrapper = mountTab({ name: "tab1", activeTab: "tab1" });
    expect(wrapper.find('[role="tab"]').attributes("aria-selected")).toBe("true");
  });

  it('sets aria-selected="false" when it is not the active tab', () => {
    const wrapper = mountTab({ name: "tab2", activeTab: "tab1" });
    expect(wrapper.find('[role="tab"]').attributes("aria-selected")).toBe("false");
  });

  it('has data-state="active" on the active tab', () => {
    const wrapper = mountTab({ name: "tab1", activeTab: "tab1" });
    expect(wrapper.find('[role="tab"]').attributes("data-state")).toBe("active");
  });

  it('has data-state="inactive" on inactive tabs', () => {
    const wrapper = mountTab({ name: "tab2", activeTab: "tab1" });
    expect(wrapper.find('[role="tab"]').attributes("data-state")).toBe("inactive");
  });

  it("keeps the active styling on a disabled active tab, and the disabled one elsewhere", () => {
    const active = mountTab({ name: "tab1", activeTab: "tab1", disabled: true });
    expect(active.find('[role="tab"]').classes()).toContain("text-tabs-active-text");
    expect(active.find('[role="tab"]').classes()).not.toContain("text-tabs-disabled-text");
    const inactive = mountTab({ name: "tab2", activeTab: "tab1", disabled: true });
    expect(inactive.find('[role="tab"]').classes()).toContain("text-tabs-disabled-text");
  });

  it("sets aria-disabled when disabled is true", () => {
    const wrapper = mountTab({ disabled: true });
    expect(wrapper.find('[role="tab"]').attributes("aria-disabled")).toBe("true");
  });

  // --- Label prop ---

  it("renders the label prop as text", () => {
    const wrapper = mountTab({ label: "Overview" });
    expect(wrapper.find('[role="tab"]').text()).toContain("Overview");
  });

  it("does not render label span when label is not provided", () => {
    const wrapper = mountTab({ name: "tab1" });
    expect(wrapper.find(".o-tab__label").exists()).toBe(false);
  });

  // --- Icon prop ---

  it("renders the icon when icon prop is provided", () => {
    const wrapper = mountTab({ icon: "home" });
    expect(wrapper.find(".o-tab__icon").exists()).toBe(true);
    // 'home' is a registered OIcon — rendered as SVG inside the span, not as text
    expect(wrapper.find(".o-tab__icon").html()).not.toBe("");
  });

  // --- Lock suffix ---

  it("paints a lock glyph with the locked-icon token when locked", () => {
    const wrapper = mountTab({ label: "Alerts", locked: true });
    expect(wrapper.find(".lock-chip").exists()).toBe(true);
  });

  it("paints no lock glyph by default", () => {
    const wrapper = mountTab({ label: "Alerts" });
    expect(wrapper.find(".lock-chip").exists()).toBe(false);
  });

  it("gives the lock screen-reader text from lockedLabel, else the tooltip", () => {
    const explicit = mountTab({
      label: "Alerts",
      locked: true,
      lockedLabel: "Locked: needs Alerts",
      tooltip: "tip",
    });
    expect(explicit.get(".sr-only").text()).toBe("Locked: needs Alerts");
    const fallback = mountTab({ label: "Alerts", locked: true, tooltip: "Locked: needs X" });
    expect(fallback.get(".sr-only").text()).toBe("Locked: needs X");
  });

  // --- One weight, sizes ---

  it("uses one font weight whether active or not, horizontal and vertical", () => {
    for (const isVertical of [false, true]) {
      const active = mountTab({ name: "tab1", activeTab: "tab1", isVertical, label: "A" });
      const idle = mountTab({ name: "tab2", activeTab: "tab1", isVertical, label: "B" });
      for (const w of [active, idle]) {
        const classes = w.find('[role="tab"]').classes();
        expect(classes).toContain("font-medium");
        expect(classes).toContain("text-compact");
        expect(classes).not.toContain("font-normal");
      }
    }
  });

  it("is 40 high on a page strip and 32 high on a compact one", () => {
    expect(mountTab({ size: "page" }).find('[role="tab"]').classes()).toContain("h-tabs-height");
    expect(mountTab({ size: "compact" }).find('[role="tab"]').classes()).toContain("h-control-md");
  });

  it("sizes a vertical tab from the control tokens", () => {
    const page = mountTab({ isVertical: true });
    expect(page.find('[role="tab"]').classes()).toContain("min-h-control-md");
    const compact = mountTab({ isVertical: true, size: "compact" });
    expect(compact.find('[role="tab"]').classes()).toContain("min-h-control-sm");
  });

  // --- Count, dirty ---

  it("renders a tabular count that reserves the width of 999+", () => {
    const wrapper = mountTab({ label: "Runs", count: 3 });
    const chip = wrapper.get('[data-test="o-tab-count"]');
    expect(chip.text()).toBe("3");
    expect(chip.classes()).toContain("tabular-nums");
    expect(chip.classes()).toContain("min-w-[calc(4ch+0.625rem)]");
  });

  it("caps the count at 999+", () => {
    const wrapper = mountTab({ label: "Runs", count: 12345 });
    expect(wrapper.get('[data-test="o-tab-count"]').text()).toBe("999+");
  });

  it("reserves the count's place while it loads (null)", () => {
    const wrapper = mountTab({ label: "Runs", count: null });
    const chip = wrapper.get('[data-test="o-tab-count"]');
    expect(chip.text()).toBe("");
    expect(chip.classes()).toContain("invisible");
  });

  it("renders no count chip when count is not set", () => {
    const wrapper = mountTab({ label: "Runs" });
    expect(wrapper.find('[data-test="o-tab-count"]').exists()).toBe(false);
  });

  it("tints the count for an error tone", () => {
    const wrapper = mountTab({ label: "Firing", count: 2, countTone: "error" });
    expect(wrapper.get('[data-test="o-tab-count"]').classes()).toContain("bg-badge-error-soft-bg");
  });

  it("shows the unsaved dot when dirty", () => {
    const dirty = mountTab({ label: "Settings", dirty: true });
    expect(dirty.find('[data-test="o-tab-dirty"]').exists()).toBe(true);
    const clean = mountTab({ label: "Settings" });
    expect(clean.find('[data-test="o-tab-dirty"]').exists()).toBe(false);
  });

  // --- Default slot (custom content) ---

  it("renders default slot content instead of icon+label", () => {
    const wrapper = mountTab({
      slots: { default: '<span data-testid="custom">Custom Tab</span>' },
    });
    expect(wrapper.find('[data-testid="custom"]').exists()).toBe(true);
    // Label should NOT appear since slot content takes over
    expect(wrapper.find(".o-tab__label").exists()).toBe(false);
  });

  it("renders a badge inside the default slot", () => {
    const wrapper = mountTab({
      slots: { default: 'Logs <span class="badge">3</span>' },
    });
    expect(wrapper.find(".badge").exists()).toBe(true);
    expect(wrapper.find(".badge").text()).toBe("3");
  });

  it("renders trailing controls beside the trigger, not inside it", () => {
    const wrapper = mountTab({
      label: "Logs",
      slots: { trailing: '<button data-testid="eye">Hide</button>' },
    });
    const eye = wrapper.find('[data-testid="eye"]').element;
    expect(eye.closest('[role="tab"]')).toBeNull();
    expect(eye.closest("[data-otab-trailing]")).not.toBeNull();
    expect(wrapper.find('[role="tab"]').text()).toBe("Logs");
  });

  it("renders no trailing wrapper without trailing content", () => {
    const wrapper = mountTab({ label: "Logs" });
    expect(wrapper.find("[data-otab-trailing]").exists()).toBe(false);
  });

  // --- Element type + CSS class ---

  it("has o-tab class", () => {
    const wrapper = mountTab();
    expect(wrapper.find('[role="tab"]').classes()).toContain("o-tab");
  });

  it("is a native button element", () => {
    const wrapper = mountTab();
    expect(wrapper.find('[role="tab"]').element.tagName).toBe("BUTTON");
  });

  it("is disabled when disabled is true", () => {
    const wrapper = mountTab({ disabled: true });
    expect(wrapper.find('[role="tab"]').attributes("disabled")).toBeDefined();
  });

  it("is not disabled by default", () => {
    const wrapper = mountTab();
    expect(wrapper.find('[role="tab"]').attributes("disabled")).toBeUndefined();
  });

  // --- Transition & focus outline ---

  it("puts the shared control motion tokens on the colour transition", () => {
    const classes = mountTab().find('[role="tab"]').classes();
    expect(classes).toContain(
      "transition-[color,background-color,border-color,text-decoration-color,fill,stroke]",
    );
    expect(classes).toContain("duration-(--duration-control)");
    expect(classes).toContain("ease-(--ease-control)");
    expect(classes).not.toContain("transition-colors");
  });

  it("uses an accent outline, not a box-shadow ring, for focus", () => {
    const classes = mountTab().find('[role="tab"]').classes();
    expect(classes).toEqual(
      expect.arrayContaining([
        "focus-visible:outline-solid",
        "focus-visible:outline-2",
        "focus-visible:outline-focus-ring-accent",
      ]),
    );
    expect(classes.some((c) => /(^|:)ring-/.test(c))).toBe(false);
  });

  it("uses a negative focus outline offset on a horizontal tab", () => {
    const classes = mountTab().find('[role="tab"]').classes();
    expect(classes).toContain("focus-visible:-outline-offset-2");
    expect(classes).not.toContain("focus-visible:outline-offset-2");
  });

  it("keeps the focus outline inside the rail inset on a vertical tab", () => {
    const classes = mountTab({ isVertical: true }).find('[role="tab"]').classes();
    expect(classes).toContain("focus-visible:outline-offset-0");
    expect(classes).not.toContain("focus-visible:-outline-offset-2");
  });

  it("keeps the focus outline classes on disabled and active tabs", () => {
    for (const opts of [{ disabled: true }, { name: "tab1", activeTab: "tab1" }]) {
      const classes = mountTab(opts).find('[role="tab"]').classes();
      expect(classes).toContain("focus-visible:outline-2");
      expect(classes).toContain("focus-visible:outline-focus-ring-accent");
    }
  });

  // --- Grip-gated drag (reorderable) ---

  describe("drag grip", () => {
    it("should not render a grip when the tab bar is not reorderable", () => {
      const wrapper = mountTab();
      expect(wrapper.find("[data-otab-grip]").exists()).toBe(false);
    });

    it("should render a hover-revealed grip inside the left gutter when reorderable", () => {
      const wrapper = mountTab({ reorderable: true });
      const grip = wrapper.find("[data-otab-grip]");
      expect(grip.exists()).toBe(true);
      expect(grip.classes()).toContain("opacity-0");
      expect(grip.classes()).toContain("group-hover/otab:opacity-50");
      // The gutter is padding on the tab, not flow width from the grip.
      expect(wrapper.find('[role="tab"]').classes()).toContain("ps-3");
      expect(grip.classes()).toContain("absolute");
    });

    it("should not be draggable until the grip is pressed", () => {
      const wrapper = mountTab({ reorderable: true });
      expect(wrapper.find('[role="tab"]').attributes("draggable")).toBeUndefined();
    });

    it("should keep a grip press from reaching the trigger, which selects on press", async () => {
      const wrapper = mountTab({ reorderable: true });
      const pressed = vi.fn();
      wrapper.find('[role="tab"]').element.addEventListener("mousedown", pressed);
      await wrapper.find("[data-otab-grip]").trigger("mousedown");
      expect(pressed).not.toHaveBeenCalled();
    });

    it("should arm dragging on grip mousedown and disarm on mouseup", async () => {
      const wrapper = mountTab({ reorderable: true });

      await wrapper.find("[data-otab-grip]").trigger("mousedown");
      expect(wrapper.find('[role="tab"]').attributes("draggable")).toBe("true");

      // useDragHandle disarms on the document-level mouseup (press released
      // without a drag) so a later body-drag can't start a reorder.
      document.dispatchEvent(new Event("mouseup"));
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[role="tab"]').attributes("draggable")).toBeUndefined();
    });

    it("should keep the grip mounted but inert while disableDrag is set", async () => {
      const wrapper = mountTab({ reorderable: true, disableDrag: true });

      // Mounted (so the tab's geometry never changes) but non-interactive.
      const grip = wrapper.find("[data-otab-grip]");
      expect(grip.exists()).toBe(true);
      expect(grip.classes()).toContain("pointer-events-none");

      // Even a programmatic press must not make the tab draggable.
      await grip.trigger("mousedown");
      expect(wrapper.find('[role="tab"]').attributes("draggable")).toBeUndefined();
    });

    it("should not render a grip on a disabled tab", () => {
      const wrapper = mountTab({ reorderable: true, disabled: true });
      expect(wrapper.find("[data-otab-grip]").exists()).toBe(false);
    });
  });

  // --- Route tab ---

  describe("route tab (to)", () => {
    function mountRouteTab(routeName: string, onTabClick = vi.fn()) {
      const push = vi.fn();
      const route = reactive({ name: routeName });
      const Wrapper = defineComponent({
        components: { TabsRoot, TabsList, OTab },
        setup() {
          provide(
            TABS_CONTEXT_KEY,
            computed<TabsContext>(() => ({
              modelValue: "other",
              isVertical: false,
              size: "page",
              reorderable: false,
              collapseLabels: false,
              draggingName: null,
              dropTargetName: null,
              dropBefore: true,
              onTabClick,
            })),
          );
          provide(routerKey, { push } as never);
          provide(routeLocationKey, route as never);
        },
        template: `
          <TabsRoot model-value="other">
            <TabsList>
              <OTab name="alerts" label="Alerts" :to="{ name: 'alerts' }" data-test="route-tab" />
            </TabsList>
          </TabsRoot>
        `,
      });
      return { wrapper: mount(Wrapper, { attachTo: document.body }), push, onTabClick, route };
    }

    it("navigates to its route on click", async () => {
      const { wrapper, push } = mountRouteTab("home");
      await wrapper.get('[data-test="route-tab"]').trigger("click");
      expect(push).toHaveBeenCalledWith({ name: "alerts" });
    });

    it("selects itself while the route name equals its name", () => {
      const { onTabClick } = mountRouteTab("alerts");
      expect(onTabClick).toHaveBeenCalledWith("alerts");
    });
  });
});
