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

// OContextMenuItem requires a MenuRoot context — mount it inside an open menu.
async function mountItemInMenu(
  itemProps: Record<string, unknown> = {},
  itemSlots: Record<string, () => ReturnType<typeof h>> = {},
) {
  const wrapper = mount(OContextMenu, {
    slots: {
      trigger: "<div data-testid='region'>Right click me</div>",
      default: { render: () => h(OContextMenuItem, itemProps, itemSlots) },
    },
    attachTo: document.body,
  });
  await wrapper.find('[data-testid="region"]').trigger("contextmenu");
  await nextTick();
  await nextTick();
  return wrapper;
}

describe("OContextMenuItem", () => {
  it("renders slot content", async () => {
    const wrapper = await mountItemInMenu({}, { default: () => h("span", "Copy value") });
    expect(wrapper.text()).toContain("Copy value");
  });

  it("renders icon-left slot", async () => {
    const wrapper = await mountItemInMenu(
      {},
      { "icon-left": () => h("span", { "data-testid": "icon-left" }, "←") },
    );
    expect(wrapper.find('[data-testid="icon-left"]').exists()).toBe(true);
  });

  it("renders icon-right slot", async () => {
    const wrapper = await mountItemInMenu(
      {},
      { "icon-right": () => h("span", { "data-testid": "icon-right" }, "→") },
    );
    expect(wrapper.find('[data-testid="icon-right"]').exists()).toBe(true);
  });

  it("sets data-disabled when disabled=true", async () => {
    const wrapper = await mountItemInMenu({ disabled: true });
    expect(wrapper.find("[data-disabled]").exists()).toBe(true);
  });

  it("keeps an unavailable reason reachable without selecting", async () => {
    const wrapper = await mountItemInMenu(
      { disabled: true, focusableUnavailable: true, description: "Run the query first" },
      { default: () => h("span", "Copy link") },
    );
    const item = wrapper.findComponent(OContextMenuItem);
    expect(item.attributes("aria-disabled")).toBe("true");
    expect(item.attributes("data-disabled")).toBeUndefined();
    expect(wrapper.find(`#${item.attributes("aria-describedby")}`).text()).toBe(
      "Run the query first",
    );
    const reason = wrapper.get(`#${item.attributes("aria-describedby")}`);
    expect(reason.attributes("aria-hidden")).toBe("true");
    const nameContent = item.element.cloneNode(true) as HTMLElement;
    nameContent.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    expect(nameContent.textContent).toBe("Copy link");
    await item.trigger("click");
    await item.trigger("keydown", { key: "Enter" });
    expect(item.emitted("select")).toBeFalsy();
    wrapper.unmount();
  });

  it("applies default variant classes", async () => {
    const wrapper = await mountItemInMenu({}, { default: () => h("span", "Action") });
    expect(wrapper.find(".text-dropdown-item-text").exists()).toBe(true);
  });

  it("applies destructive variant classes", async () => {
    const wrapper = await mountItemInMenu(
      { variant: "destructive" },
      { default: () => h("span", "Delete") },
    );
    expect(wrapper.find(".text-dropdown-item-destructive-text").exists()).toBe(true);
  });

  it("emits select when clicked", async () => {
    const wrapper = await mountItemInMenu({}, { default: () => h("span", "Copy") });
    const item = wrapper.findComponent(OContextMenuItem);
    await item.trigger("click");
    expect(item.emitted("select")).toBeTruthy();
  });

  it("does not emit select when disabled", async () => {
    const wrapper = await mountItemInMenu({ disabled: true }, { default: () => h("span", "Copy") });
    const item = wrapper.findComponent(OContextMenuItem);
    await item.trigger("click");
    expect(item.emitted("select")).toBeFalsy();
  });
});
