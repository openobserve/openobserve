// Copyright 2026 OpenObserve Inc.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mount, config } from "@vue/test-utils";
import { computed } from "vue";
import { createI18n } from "vue-i18n";

const viewport = vi.hoisted(() => ({ mobile: { value: false } }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { ref } = await import("vue");
  viewport.mobile = ref(false);
  return { default: () => ({ isMobile: viewport.mobile }) };
});

import OTableRowActions from "./OTableRowActions.vue";
import {
  OTableRowActionsKey,
  type OTableRowAction,
  type OTableRowDataTest,
  type OTableRowMenuItem,
} from "../OTable.types";
import { raw } from "@/types/i18n";

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });
beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
});
beforeEach(() => {
  viewport.mobile.value = false;
});

const stubs = {
  ODropdown: { template: `<div><slot name="trigger" /><div data-menu><slot /></div></div>` },
  ODropdownItem: {
    props: ["tone", "disabled", "disabledReason"],
    emits: ["select"],
    template: `<button data-menu-item :data-tone="tone" @click="$emit('select')"><slot /><slot name="end" /></button>`,
  },
};

function action(id: string, extra: Partial<OTableRowAction> = {}): OTableRowAction {
  return { id, label: raw(id), icon: "edit", onClick: vi.fn(), ...extra };
}

function item(id: string, extra: Partial<OTableRowMenuItem> = {}): OTableRowMenuItem {
  return { id, label: raw(id), onSelect: vi.fn(), ...extra };
}

function render(
  actions: OTableRowAction[],
  menu: OTableRowMenuItem[] = [],
  row: unknown = {},
  { index, menuDataTest }: { index?: number; menuDataTest?: OTableRowDataTest } = {},
) {
  const wrapper = mount(OTableRowActions, {
    props: { row, index },
    global: {
      stubs,
      provide: {
        [OTableRowActionsKey as symbol]: {
          actions: computed(() => actions),
          menu: computed(() => menu),
          menuDataTest: computed(() => menuDataTest),
        },
      },
    },
  });
  return {
    wrapper,
    inline: wrapper
      .findAll("[data-row-action]:not([data-row-action-proxy])")
      .map((b) => b.attributes("data-row-action")),
    menu: wrapper.findAll("[data-menu-item]").map((i) => i.attributes("data-test")),
  };
}

describe("OTableRowActions", () => {
  it("draws the declared inline actions and the menu with destructive items last (B7)", () => {
    const out = render(
      [action("edit"), action("pause")],
      [item("delete", { destructive: true }), item("duplicate")],
    );
    expect(out.inline).toEqual(["edit", "pause"]);
    expect(out.menu).toEqual(["o2-table-row-menu-duplicate", "o2-table-row-menu-delete"]);
    expect(out.wrapper.find('[data-menu-item][data-tone="danger"]').text()).toBe("delete");
  });

  it("leaves out hidden actions and draws no menu without items", () => {
    const out = render([action("edit"), action("copy", { hidden: () => true })]);
    expect(out.inline).toEqual(["edit"]);
    expect(out.wrapper.find('[data-test="o2-table-row-menu"]').exists()).toBe(false);
  });

  it("below md every action is in one menu, inline actions first", () => {
    viewport.mobile.value = true;
    const out = render([action("edit"), action("copy")], [item("delete", { destructive: true })]);
    expect(out.inline).toEqual([]);
    expect(out.menu).toEqual([
      "o2-table-row-action-edit-menu",
      "o2-table-row-action-copy-menu",
      "o2-table-row-menu-delete",
    ]);
  });

  it("a disabled action does not fire and exposes its reason", async () => {
    const row = { name: "a" };
    const blocked = action("edit", {
      disabled: () => true,
      disabledReason: () => raw("Built-in role"),
    });
    const open = action("copy");
    const { wrapper } = render([blocked, open], [], row);

    const edit = wrapper.find('[data-row-action="edit"]');
    await edit.trigger("click");
    await wrapper.find('[data-row-action="copy"]').trigger("click");

    expect(blocked.onClick).not.toHaveBeenCalled();
    expect(open.onClick).toHaveBeenCalledWith(row);
    expect(edit.attributes("aria-disabled")).toBe("true");
    expect(edit.attributes("disabled")).toBeUndefined();
    const reason = wrapper.find(`#${edit.attributes("aria-describedby")}`);
    expect(reason.text()).toBe("Built-in role");
  });

  it("reads label, icon and shortcut from the row", () => {
    const toggle = action("toggle", {
      label: (row) => raw(row.on ? "Disable" : "Enable"),
      icon: (row) => (row.on ? "pause" : "play-arrow"),
      shortcut: (row) => (row.on ? "pause" : "resume"),
    });
    const facts = (row: unknown) => {
      const button = render([toggle], [], row).wrapper.find(
        '[data-test="o2-table-row-action-toggle"]',
      );
      return [button.attributes("aria-label"), button.attributes("data-row-action")];
    };

    expect(facts({ on: true })).toEqual(["Disable", "pause"]);
    expect(facts({ on: false })).toEqual(["Enable", "resume"]);
  });

  it("data-tests: the row index reaches dataTest and the menu trigger takes an override", () => {
    const dataTest = (id: string) => (_row: unknown, index: number) => `${id}-${index}`;
    const { wrapper } = render(
      [action("edit", { dataTest: dataTest("edit") })],
      [item("delete", { destructive: true, dataTest: dataTest("delete") })],
      { id: "a" },
      {
        index: 4,
        menuDataTest: (row: any, index: number) => `more-${row.id}-${index}`,
      },
    );

    expect(wrapper.find('[data-test="edit-4"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="delete-4"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="more-a-4"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o2-table-row-menu"]').exists()).toBe(false);
  });

  it("a loading action shows a named spinner in place of its button", () => {
    const busy = action("toggle", {
      loading: (row) => row.busy && { label: raw("Disabling"), dataTest: "toggle-spinner" },
    });

    const idle = render([busy], [], { busy: false }).wrapper;
    expect(idle.find('[data-test="toggle-spinner"]').exists()).toBe(false);
    expect(idle.find('[data-row-action="toggle"]').exists()).toBe(true);

    const { wrapper } = render([busy], [], { busy: true });
    expect(wrapper.find('[data-test="toggle-spinner"]').exists()).toBe(true);
    expect(wrapper.find('[data-row-action="toggle"]').exists()).toBe(false);
  });

  it("a badge marks the inline button, or the menu item and the menu trigger", () => {
    const dots = (actions: OTableRowAction[], menu: OTableRowMenuItem[], row: unknown) =>
      render(actions, menu, row)
        .wrapper.findAll('[data-test^="dot-"]')
        .map((d) => d.attributes("data-test"));
    const inlineCopy = action("copy", { badge: (row) => row.draft && { dataTest: "dot-inline" } });
    const menuCopy = item("copy", {
      badge: (row, placement) => row.draft && { dataTest: `dot-${placement}` },
    });

    expect(dots([inlineCopy], [], { draft: false })).toEqual([]);
    expect(dots([inlineCopy], [], { draft: true })).toEqual(["dot-inline"]);
    expect(dots([action("edit")], [menuCopy], { draft: true })).toEqual(["dot-more", "dot-menu"]);
  });

  it("a badge or a running action keeps the actions visible without hover", () => {
    const bar = (actions: OTableRowAction[], row: unknown) =>
      render(actions, [], row).wrapper.find('[data-test="o2-table-row-actions"]').classes();
    const copy = action("copy", { badge: (row) => !!row.draft });

    expect(bar([copy], { draft: false })).toContain("opacity-0");
    expect(bar([copy], { draft: true })).toContain("opacity-100");
    expect(bar([action("toggle", { loading: () => true })], {})).toContain("opacity-100");
  });

  it("an action inside the menu still answers its row shortcut", async () => {
    const remove = item("delete", { destructive: true });
    const duplicate = item("duplicate");
    const { wrapper } = render([action("edit")], [duplicate, remove]);

    await wrapper.find('[data-row-action-proxy][data-row-action="delete"]').trigger("click");

    expect(remove.onSelect).toHaveBeenCalledTimes(1);
    expect(duplicate.onSelect).not.toHaveBeenCalled();
  });
});
