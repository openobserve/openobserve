// Copyright 2026 OpenObserve Inc.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { mount, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

const viewport = vi.hoisted(() => ({ mobile: { value: false } }));
vi.mock("@/composables/useBreakpoint", async () => {
  const { ref } = await import("vue");
  viewport.mobile = ref(false);
  return { default: () => ({ isMobile: viewport.mobile }) };
});

import OTableRowActions from "./OTableRowActions.vue";
import type { OTableRowAction } from "../OTable.types";
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
    emits: ["select"],
    template: `<button data-menu-item @click="$emit('select')"><slot /></button>`,
  },
};

function action(id: string, extra: Partial<OTableRowAction> = {}): OTableRowAction {
  return { id, label: raw(id), icon: "edit", onSelect: vi.fn(), ...extra };
}

function render(actions: OTableRowAction[], row: unknown = {}, extra: object = {}) {
  const wrapper = mount(OTableRowActions, {
    props: { actions, row, ...extra },
    global: { stubs },
  });
  return {
    wrapper,
    inline: wrapper
      .findAll("[data-row-action]:not([data-row-action-proxy])")
      .map((b) => b.attributes("data-row-action")),
    menu: wrapper
      .findAll("[data-menu-item]")
      .map((i) => i.attributes("data-test")?.replace(/^o2-table-row-action-|-menu$/g, "")),
  };
}

describe("OTableRowActions", () => {
  it.each<[string, OTableRowAction[], string[], string[]]>([
    ["no actions", [], [], []],
    ["one action", [action("delete")], ["delete"], []],
    [
      "three actions, edit first and delete last",
      [action("delete"), action("copy"), action("edit")],
      ["edit", "copy", "delete"],
      [],
    ],
    [
      "four actions keep the first two inline",
      [action("copy"), action("delete"), action("edit"), action("pause")],
      ["edit", "copy"],
      ["pause", "delete"],
    ],
    [
      "six actions with two marked inline",
      [
        action("edit"),
        action("copy"),
        action("pause", { inline: true }),
        action("export", { inline: true }),
        action("move", { inline: true }),
        action("delete"),
      ],
      ["pause", "export"],
      ["edit", "copy", "move", "delete"],
    ],
    [
      "one marked inline is joined by the first unmarked",
      [action("edit"), action("copy"), action("pause", { inline: true }), action("delete")],
      ["edit", "pause"],
      ["copy", "delete"],
    ],
    [
      "a hidden action leaves three, all inline",
      [action("edit"), action("copy", { visible: () => false }), action("pause"), action("delete")],
      ["edit", "pause", "delete"],
      [],
    ],
  ])("order and split: %s", (_name, actions, inline, menu) => {
    const out = render(actions);
    expect(out.inline).toEqual(inline);
    expect(out.menu).toEqual(menu);
  });

  it("below md every action is in one menu", () => {
    viewport.mobile.value = true;
    const out = render([action("delete"), action("copy"), action("edit")]);
    expect(out.inline).toEqual([]);
    expect(out.menu).toEqual(["edit", "copy", "delete"]);
  });

  it("a disabled action does not fire and exposes its reason", async () => {
    const row = { name: "a" };
    const blocked = action("edit", { disabled: () => raw("Built-in role") });
    const open = action("copy");
    const { wrapper } = render([blocked, open], row);

    const edit = wrapper.find('[data-row-action="edit"]');
    await edit.trigger("click");
    await wrapper.find('[data-row-action="copy"]').trigger("click");

    expect(blocked.onSelect).not.toHaveBeenCalled();
    expect(open.onSelect).toHaveBeenCalledWith(row);
    expect(edit.attributes("aria-disabled")).toBe("true");
    expect(edit.attributes("disabled")).toBeUndefined();
    const reason = wrapper.find(`#${edit.attributes("aria-describedby")}`);
    expect(reason.text()).toBe("Built-in role");
  });

  it("reads label, icon, tone and shortcut from the row", () => {
    const toggle = action("toggle", {
      label: (row) => raw(row.on ? "Disable" : "Enable"),
      icon: (row) => (row.on ? "pause" : "play-arrow"),
      tone: (row) => (row.on ? "destructive" : "success"),
      shortcut: (row) => (row.on ? "pause" : "resume"),
    });
    const facts = (row: unknown) => {
      const button = render([toggle], row).wrapper.find('[data-test="o2-table-row-action-toggle"]');
      const { "aria-label": label, "data-row-action": key, class: tone } = button.attributes();
      return [label, key, tone];
    };
    const [on, off] = [facts({ on: true }), facts({ on: false })];

    expect(on.slice(0, 2)).toEqual(["Disable", "pause"]);
    expect(off.slice(0, 2)).toEqual(["Enable", "resume"]);
    expect(on[2]).not.toBe(off[2]);
  });

  it("data-tests: the row index reaches dataTest and the more trigger takes an override", () => {
    const actions = ["edit", "copy", "pause", "delete"].map((id) =>
      action(id, { dataTest: (_row, index) => `${id}-${index}` }),
    );
    const { wrapper } = render(
      actions,
      { id: "a" },
      {
        index: 4,
        moreDataTest: (row: { id: string }, index: number) => `more-${row.id}-${index}`,
      },
    );

    expect(wrapper.find('[data-test="edit-4"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="delete-4-menu"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="more-a-4"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o2-table-row-more-actions"]').exists()).toBe(false);
  });

  it("a loading action shows a named spinner in place of its button", () => {
    const busy = action("toggle", {
      loading: (row) => row.busy && { label: raw("Disabling"), dataTest: "toggle-spinner" },
    });

    const idle = render([busy], { busy: false }).wrapper;
    expect(idle.find('[data-test="toggle-spinner"]').exists()).toBe(false);
    expect(idle.find('[data-row-action="toggle"]').exists()).toBe(true);

    const { wrapper } = render([busy], { busy: true });
    expect(wrapper.find('[data-test="toggle-spinner"]').exists()).toBe(true);
    expect(wrapper.find('[data-row-action="toggle"]').exists()).toBe(false);
  });

  it("a badge marks the inline button, or the menu item and the more trigger", () => {
    const copy = action("copy", {
      badge: (row, placement) => row.draft && { dataTest: `dot-${placement}` },
    });
    const dots = (actions: OTableRowAction[], row: unknown) =>
      render(actions, row)
        .wrapper.findAll('[data-test^="dot-"]')
        .map((d) => d.attributes("data-test"));
    const four = [action("edit"), action("pause"), copy, action("delete")];

    expect(dots([copy], { draft: false })).toEqual([]);
    expect(dots([copy], { draft: true })).toEqual(["dot-inline"]);
    expect(dots(four, { draft: true })).toEqual(["dot-more", "dot-menu"]);
  });

  it("an action inside the menu still answers its row shortcut", async () => {
    const actions = [action("edit"), action("pause"), action("copy"), action("delete")];
    const { wrapper } = render(actions);

    await wrapper.find('[data-row-action="delete"]').trigger("click");

    expect(actions[3].onSelect).toHaveBeenCalledTimes(1);
    expect(actions[2].onSelect).not.toHaveBeenCalled();
  });
});
