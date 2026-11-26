// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";

import type { AssistantHostAdapter } from "@/composables/assistant";
import {
  registerEscapeRung,
  resetAssistantShortcutsForTests,
} from "@/composables/assistant/shortcuts";
import { raw } from "@/types/i18n";

import { fakeAssistant } from "../__tests__/fakeAssistant";
import AssistantDock from "./AssistantDock.vue";

const { fake, lg, widths } = vi.hoisted(() => ({
  fake: { current: null as any },
  lg: { value: true },
  widths: vi.fn(),
}));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed, reactive } = await import("vue");
  const state = reactive(lg);
  return {
    default: () => ({
      lgUp: computed(() => state.value),
      mdUp: computed(() => state.value),
      isMobile: computed(() => !state.value),
    }),
    __state: state,
  };
});
vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantHistory: () => fake.current.history,
  useAssistantCapability: () => fake.current.handle,
  useAssistantPanelWidth: () => ({}),
  reportDockWidth: widths,
}));
vi.mock("./AssistantShell.vue", () => ({
  default: {
    name: "AssistantShell",
    props: ["placement", "host", "sheet"],
    template:
      '<section data-assistant-root :data-placement="placement" data-test="assistant-shell-docked"><textarea data-assistant-composer data-test="composer"></textarea></section>',
  },
}));

const host: AssistantHostAdapter = {
  id: "alert_query",
  objectKind: "alert",
  objectTitle: () => raw("Alert · checkout"),
  language: "sql",
  getBuffer: () => "",
  getContext: () => ({}),
  previewInsert: vi.fn(),
  revert: vi.fn(),
  isDirty: () => false,
  focusEditor: vi.fn(),
  dockSlot: ref(null),
};

function setup(gate: Parameters<typeof fakeAssistant>[0] = "available") {
  fake.current = fakeAssistant(gate);
  const outer = vi.fn();
  const toggle = ref<HTMLElement | null>(null);
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h("div", { onKeydown: outer, "data-test": "host" }, [
          h("button", { ref: toggle, "data-test": "toggle" }, "toggle"),
          h(AssistantDock, { host }),
        ]),
    }),
    { attachTo: document.body },
  );
  return { wrapper, outer, store: fake.current.store, toggle };
}

const breakpoint = async () =>
  (await import("@/composables/useBreakpoint")) as unknown as { __state: { value: boolean } };

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  widths.mockClear();
});

afterEach(async () => {
  resetAssistantShortcutsForTests();
  (await breakpoint()).__state.value = true;
  document.body.innerHTML = "";
});

describe("AssistantDock", () => {
  it("renders nothing until this host's dock is the placement, then a 20 rem flex column", async () => {
    const { wrapper, store } = setup();
    expect(wrapper.find('[data-test="assistant-dock-column"]').exists()).toBe(false);
    store.open({ kind: "docked", hostId: "json_editor" }, { focus: "none" });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-dock-column"]').exists()).toBe(false);
    store.open({ kind: "docked", hostId: "alert_query" }, { focus: "none" });
    await flushPromises();
    const column = wrapper.get('[data-test="assistant-dock-column"]');
    expect(column.attributes("data-host")).toBe("alert_query");
    for (const cls of ["flex", "h-full", "min-h-0", "min-w-80", "shrink-0", "border-s"])
      expect(column.classes()).toContain(cls);
    expect(column.attributes("style")).toBeUndefined();
    expect(column.get('[data-test="assistant-shell-docked"]').attributes("data-placement")).toBe(
      "docked",
    );
    expect(widths).toHaveBeenCalledWith("alert_query", expect.any(Number));
  });

  it("stops Escape at the chat: the chat closes, the host never sees the key", async () => {
    const { wrapper, store, outer } = setup();
    registerEscapeRung("g", () => {
      store.close("escape");
      return true;
    });
    store.open({ kind: "docked", hostId: "alert_query" }, { focus: "none" });
    await flushPromises();
    const composer = wrapper.get('[data-test="composer"]').element as HTMLElement;
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(outer).not.toHaveBeenCalled();
    expect(store.state.shell.placement.kind).toBe("hidden");
  });

  it("lets an IME's Escape through to whoever owns the candidate list", async () => {
    const { wrapper, store, outer } = setup();
    store.open({ kind: "docked", hostId: "alert_query" }, { focus: "none" });
    await flushPromises();
    const composer = wrapper.get('[data-test="composer"]').element as HTMLElement;
    composer.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }),
    );
    expect(outer).toHaveBeenCalledTimes(1);
    expect(store.state.shell.placement.kind).toBe("docked");
  });

  it("returns focus to the toggle that opened it when the chat closes from inside", async () => {
    const { wrapper, store, toggle } = setup();
    const sid = store.createSession({
      origin: { entryKind: "editor_toggle", objectKind: "alert", container: "docked.alert_query" },
    });
    store.open(
      { kind: "docked", hostId: "alert_query" },
      { sid, focus: "none", invoker: toggle.value },
    );
    await flushPromises();
    (wrapper.get('[data-test="composer"]').element as HTMLElement).focus();
    store.close("close");
    await flushPromises();
    expect(document.activeElement).toBe(toggle.value);
  });

  it("is the sheet below lg, rendered inside the host so a modal drawer keeps it reachable", async () => {
    (await breakpoint()).__state.value = false;
    const { wrapper, store } = setup();
    store.open({ kind: "docked", hostId: "alert_query" }, { focus: "none" });
    await flushPromises();
    const sheet = wrapper.find('[data-test="assistant-dock-sheet"]');
    expect(sheet.exists()).toBe(true);
    expect(store.state.shell.sheetSnap).toBe("half");
    expect(wrapper.find('[data-test="assistant-dock-column"]').exists()).toBe(false);
  });

  it("below lg, stops Escape from the sheet's own controls too, and peeks with the chat's title", async () => {
    (await breakpoint()).__state.value = false;
    const { wrapper, store, outer } = setup();
    registerEscapeRung("g", () => {
      store.close("escape");
      return true;
    });
    store.open({ kind: "docked", hostId: "alert_query" }, { focus: "none" });
    await flushPromises();
    const expand = wrapper.get('[data-test="assistant-dock-sheet-expand"]').element as HTMLElement;
    expand.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(outer).not.toHaveBeenCalled();
    expect(store.state.shell.placement.kind).toBe("hidden");
    store.open({ kind: "docked", hostId: "alert_query" }, { focus: "none" });
    store.setSheetSnap("peek");
    await flushPromises();
    expect(wrapper.get('[data-test="assistant-dock-sheet-status"]').text()).toContain(
      "Alert · checkout",
    );
  });

  it("mounts nothing where the assistant is not set up", async () => {
    const { wrapper, store } = setup("not_configured");
    store.open({ kind: "docked", hostId: "alert_query" }, { focus: "none" });
    await flushPromises();
    expect(wrapper.find('[data-test="assistant-shell-docked"]').exists()).toBe(false);
  });
});
