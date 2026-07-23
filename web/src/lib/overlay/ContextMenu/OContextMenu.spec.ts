import { describe, it, expect, vi } from "vitest";
import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import OContextMenu from "./OContextMenu.vue";
import OContextMenuItem from "./OContextMenuItem.vue";

// Reka UI portals content into <body>. Disable portal for unit tests.
vi.mock("reka-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("reka-ui")>();
  return {
    ...actual,
    ContextMenuPortal: actual.ContextMenuContent, // render inline
  };
});

function mountMenu(props: Record<string, unknown> = {}) {
  return mount(OContextMenu, {
    props,
    slots: {
      trigger: "<div data-testid='region'>Right click me</div>",
      default: {
        render: () => h(OContextMenuItem, {}, { default: () => "Copy" }),
      },
    },
    attachTo: document.body,
  });
}

// ContextMenuTrigger awaits nextTick before opening, so callers need two ticks.
async function rightClick(wrapper: ReturnType<typeof mountMenu>) {
  await wrapper.find('[data-testid="region"]').trigger("contextmenu");
  await nextTick();
  await nextTick();
}

describe("OContextMenu", () => {
  it("renders the trigger slot as-child without a wrapper element", () => {
    const wrapper = mountMenu();
    const region = wrapper.find('[data-testid="region"]');
    expect(region.exists()).toBe(true);
    // as-child means the slot root IS the trigger — it carries the state attr
    expect(region.attributes("data-state")).toBe("closed");
  });

  it("stays closed until a contextmenu event fires", () => {
    const wrapper = mountMenu();
    expect(wrapper.text()).not.toContain("Copy");
  });

  it("opens on right-click and renders menu content", async () => {
    const wrapper = mountMenu();
    await rightClick(wrapper);
    expect(wrapper.emitted("update:open")?.[0]).toEqual([true]);
  });

  it("does not open when disabled", async () => {
    const wrapper = mountMenu({ disabled: true });
    await rightClick(wrapper);
    expect(wrapper.emitted("update:open")).toBeUndefined();
  });

  it("emits update:open(false) when Escape is pressed", async () => {
    const wrapper = mountMenu();
    await rightClick(wrapper);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await nextTick();
    await nextTick();
    const events = wrapper.emitted("update:open") ?? [];
    expect(events.at(-1)).toEqual([false]);
  });

  it("closes when an ancestor scrolls, since the menu is pointer-anchored", async () => {
    const wrapper = mountMenu();
    await rightClick(wrapper);
    window.dispatchEvent(new Event("scroll"));
    await nextTick();
    await nextTick();
    const events = wrapper.emitted("update:open") ?? [];
    expect(events.at(-1)).toEqual([false]);
  });
});
