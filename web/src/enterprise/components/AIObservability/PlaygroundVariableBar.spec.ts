// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import PlaygroundVariableBar from "./PlaygroundVariableBar.vue";

vi.mock("@/types/i18n", async () => {
  const actual = await vi.importActual<typeof import("@/types/i18n")>("@/types/i18n");
  return { ...actual, useI18nTyped: () => ({ t: (key: string) => key }) };
});

const stubs = {
  OButton: {
    emits: ["click"],
    // Forwards the native event: the remove button uses `@click.stop`, which
    // needs a real event to call stopPropagation on.
    template: `<button v-bind="$attrs" @click="$emit('click', $event)"><slot /></button>`,
  },
  OIcon: true,
  OSeparator: true,
  ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
  ODropdownItem: {
    name: "ODropdownItem",
    emits: ["select"],
    template: `<button v-bind="$attrs" @click="$emit('select')"><slot /><slot name="icon-right" /></button>`,
  },
  OTag: true,
  PlaygroundVariablesMenu: true,
  PlaygroundToolsDialog: {
    name: "PlaygroundToolsDialog",
    props: ["open", "tools", "index"],
    template: "<div />",
  },
};

function mountBar(tools: Array<{ name: string }> = []) {
  return mount(PlaygroundVariableBar, {
    props: {
      varNames: [],
      vars: {},
      usedVarNames: [],
      tools: tools as any,
      provenance: null,
      sample: null,
    },
    global: { stubs },
  });
}

const dialog = (w: ReturnType<typeof mountBar>) =>
  w.findComponent({ name: "PlaygroundToolsDialog" });

describe("PlaygroundVariableBar — tools dropdown", () => {
  // Someone who opened the list to see what exists is already looking for the
  // way to add one, and the split button that does it is behind the menu.
  it("offers Add Tool inside the dropdown, with tools present", async () => {
    const wrapper = mountBar([{ name: "search" }]);
    const add = wrapper.get('[data-test="ai-playground-tool-add"]');

    await add.trigger("click");

    // `null` is "define a new one" — an index would reopen an existing tool.
    expect(dialog(wrapper).props("index")).toBeNull();
    expect(dialog(wrapper).props("open")).toBe(true);
  });

  it("offers Add Tool when there are none yet", async () => {
    const wrapper = mountBar();
    expect(wrapper.find('[data-test="ai-playground-tools-none"]').exists()).toBe(true);

    await wrapper.get('[data-test="ai-playground-tool-add"]').trigger("click");
    expect(dialog(wrapper).props("index")).toBeNull();
  });

  // The row still edits the tool it names, rather than being shadowed by Add.
  it("still opens an existing tool from its row", async () => {
    const wrapper = mountBar([{ name: "search" }, { name: "fetch" }]);
    await wrapper.get('[data-test="ai-playground-tool-item-1"]').trigger("click");
    expect(dialog(wrapper).props("index")).toBe(1);
  });

  // The list is one shared harness, so removing from it is a bench-wide edit
  // reported to the owner rather than kept here.
  it("reports a removal as the whole remaining list", async () => {
    const wrapper = mountBar([{ name: "search" }, { name: "fetch" }]);
    await wrapper.get('[data-test="ai-playground-tool-remove-0"]').trigger("click");
    expect(wrapper.emitted("set-tools")?.[0]).toEqual([[{ name: "fetch" }]]);
  });
});

describe("PlaygroundVariableBar — sample flash", () => {
  // A sample lands via PlaygroundPage, which only holds a ref on the bar —
  // this seam is what lets it reach the Variables button without knowing the
  // menu inside the bar exists.
  it("forwards flash() to the Variables menu inside it", () => {
    const flashSpy = vi.fn();
    const wrapper = mount(PlaygroundVariableBar, {
      props: {
        varNames: [],
        vars: {},
        usedVarNames: [],
        tools: [],
        provenance: null,
        sample: null,
      },
      global: {
        stubs: {
          ...stubs,
          PlaygroundVariablesMenu: {
            template: "<div />",
            methods: { flash: flashSpy },
          },
        },
      },
    });

    (wrapper.vm as unknown as { flash: () => void }).flash();

    expect(flashSpy).toHaveBeenCalledOnce();
  });
});
