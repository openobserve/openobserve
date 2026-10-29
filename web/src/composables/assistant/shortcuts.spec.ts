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
import { computed, defineComponent, h, ref } from "vue";

import { getManager, resetManager } from "@/lib/vue-shortcut-manager/manager";
import {
  SHORTCUT_REGISTRY,
  type ShortcutCapabilities,
} from "@/lib/vue-shortcut-manager/shortcutRegistry";

import type { GateCode } from "./assistantStore.types";
import { resetAssistantV2ForTests } from "./flags";
import {
  onAssistantOpen,
  registerAssistantFocusTarget,
  registerContainerCloser,
  registerEscapeRung,
  resetAssistantShortcutsForTests,
  runEscapeLadder,
  useAssistantOpenChord,
  useAssistantShortcuts,
} from "./shortcuts";

const { placement, openAssistant, storeClose } = vi.hoisted(() => ({
  placement: { kind: "hidden" } as { kind: string },
  openAssistant: vi.fn(),
  storeClose: vi.fn(),
}));

vi.mock("./runtime", () => ({
  getAssistantRuntime: () => ({ store: { state: { shell: { placement } }, close: storeClose } }),
}));

vi.mock("./openAssistant", () => ({ openAssistant }));

const CAPS: ShortcutCapabilities = {
  isEnterprise: true,
  isCloud: false,
  isMetaOrg: false,
  onlineEvalsEnabled: false,
  incidentsEnabled: false,
  modelPricingEnabled: false,
  rbacEnabled: true,
  aiEnabled: true,
  downtimesEnabled: false,
  assistantCanChat: true,
};

const visible = (id: string, caps: ShortcutCapabilities) => {
  const entry = SHORTCUT_REGISTRY.flatMap((g) => g.shortcuts).find((e) => e.id === id)!;
  return !entry.visible || entry.visible(caps);
};

// The header button binds the open chord and the host the rest; a layout mounts both.
function mountShortcuts(
  gate: GateCode,
  canChat = gate === "available" || gate === "unhealthy",
  layers: { chord?: boolean; host?: boolean } = { chord: true, host: true },
) {
  const gateRef = ref(gate);
  const canChatRef = ref(canChat);
  const wrapper = mount(
    defineComponent({
      setup() {
        const options = {
          gate: computed(() => gateRef.value),
          assistantCanChat: computed(() => canChatRef.value),
        };
        if (layers.chord) useAssistantOpenChord(options);
        if (layers.host) useAssistantShortcuts(options);
        return () =>
          h("div", [
            h("div", { "data-assistant-root": "" }, [h("textarea", { "data-test": "composer" })]),
            h("button", { "data-test": "page" }),
          ]);
      },
    }),
    { attachTo: document.body },
  );
  return { wrapper, gateRef, canChatRef };
}

const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  resetManager();
  resetAssistantShortcutsForTests();
  window.__O2_TELEMETRY_SINK__ = true;
  window.__o2telemetry = [];
});

afterEach(() => {
  resetManager();
  document.body.innerHTML = "";
  delete window.__O2_ASSISTANT_V2__;
  delete window.__O2_TELEMETRY_SINK__;
  delete window.__o2telemetry;
  resetAssistantV2ForTests();
  placement.kind = "hidden";
  openAssistant.mockClear();
});

describe("registration", () => {
  it.each(["loading", "not_entitled", "not_configured"] as const)(
    "registers nothing on %s",
    async (gate) => {
      const { wrapper } = mountShortcuts(gate);
      await flushPromises();
      expect(getManager()!.getById("assistantOpen")).toBeUndefined();
      expect(getManager()!.getById("assistantClose")).toBeUndefined();
      wrapper.unmount();
    },
  );

  it("binds the chord on available and leaves it unbound on no_permission", async () => {
    const { wrapper, gateRef, canChatRef } = mountShortcuts("available");
    await flushPromises();
    expect(getManager()!.getById("assistantOpen")?.key).toBe("ctrl+i");
    gateRef.value = "no_permission";
    canChatRef.value = false;
    await flushPromises();
    expect(getManager()!.getById("assistantOpen")).toBeUndefined();
    const event = press("i", { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    wrapper.unmount();
  });

  it("hands the chord to a remaining instance when the binding one unmounts", async () => {
    const first = mountShortcuts("available");
    const second = mountShortcuts("available");
    await flushPromises();
    first.wrapper.unmount();
    await flushPromises();
    expect(getManager()!.getById("assistantOpen")?.key).toBe("ctrl+i");
    press("i", { ctrlKey: true });
    expect(openAssistant).toHaveBeenCalledTimes(1);
    second.wrapper.unmount();
    await flushPromises();
    expect(getManager()!.getById("assistantOpen")).toBeUndefined();
  });

  it("leaves the open chord to the header button, so the host never binds a duplicate", async () => {
    const host = mountShortcuts("available", true, { host: true });
    await flushPromises();
    expect(getManager()!.getById("assistantOpen")).toBeUndefined();
    expect(getManager()!.getById("assistantHistory")).toBeDefined();
    host.wrapper.unmount();
  });

  it("opens from the chord before the async host has mounted", async () => {
    const header = mountShortcuts("available", true, { chord: true });
    await flushPromises();
    press("i", { ctrlKey: true });
    expect(openAssistant).toHaveBeenCalledTimes(1);
    const host = mountShortcuts("available", true, { host: true });
    await flushPromises();
    press("i", { ctrlKey: true });
    expect(openAssistant).toHaveBeenCalledTimes(2);
    host.wrapper.unmount();
    header.wrapper.unmount();
  });

  it("binds once per tab even when two layouts mount", async () => {
    const first = mountShortcuts("available");
    const second = mountShortcuts("available");
    await flushPromises();
    press("i", { ctrlKey: true });
    expect(openAssistant).toHaveBeenCalledTimes(1);
    second.wrapper.unmount();
    first.wrapper.unmount();
  });
});

describe("cheatsheet visibility", () => {
  it("hides every assistant row with the flag off", () => {
    window.__O2_ASSISTANT_V2__ = false;
    for (const id of [
      "assistantOpen",
      "assistantHistory",
      "assistantHelper",
      "assistantComposerSend",
    ])
      expect(visible(id, CAPS)).toBe(false);
  });

  it("hides the chord row on G2 and shows it on available with the flag on", () => {
    window.__O2_ASSISTANT_V2__ = true;
    expect(visible("assistantOpen", { ...CAPS, assistantCanChat: false })).toBe(false);
    expect(visible("assistantOpen", CAPS)).toBe(true);
    expect(visible("assistantClose", CAPS)).toBe(false);
  });
});

describe("the Escape ladder", () => {
  it("asks the rungs in order and stops at the first that handles the key", () => {
    const calls: string[] = [];
    registerEscapeRung("f", () => (calls.push("f"), true));
    registerEscapeRung("b", () => (calls.push("b"), false));
    const stopA = registerEscapeRung("a", () => (calls.push("a"), true));
    expect(runEscapeLadder(new KeyboardEvent("keydown", { key: "Escape" }))).toBe(true);
    expect(calls).toEqual(["a"]);
    stopA();
    calls.length = 0;
    runEscapeLadder(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(calls).toEqual(["b", "f"]);
  });

  it("does nothing while an IME is composing", () => {
    const rung = vi.fn(() => true);
    registerEscapeRung("f", rung);
    expect(
      runEscapeLadder(new KeyboardEvent("keydown", { key: "Escape", isComposing: true })),
    ).toBe(false);
    expect(runEscapeLadder(new KeyboardEvent("keydown", { key: "Escape", keyCode: 229 }))).toBe(
      false,
    );
    expect(rung).not.toHaveBeenCalled();
  });

  it("owns Escape only while focus is inside the assistant, so closeDialog never fires with it", async () => {
    const closeDialog = vi.fn();
    getManager()!.register({ id: "closeDialog", key: "escape", handler: closeDialog });
    const rung = vi.fn(() => true);
    registerEscapeRung("f", rung);
    const { wrapper } = mountShortcuts("available");
    await flushPromises();
    (wrapper.find('[data-test="composer"]').element as HTMLElement).focus();
    await flushPromises();
    press("Escape");
    expect(rung).toHaveBeenCalledTimes(1);
    expect(closeDialog).not.toHaveBeenCalled();
    (wrapper.find('[data-test="page"]').element as HTMLElement).focus();
    await flushPromises();
    press("Escape");
    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(rung).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

describe("container rungs f and h", () => {
  const rootWith = (placement: string) => {
    const root = document.createElement("div");
    root.setAttribute("data-assistant-root", "");
    root.dataset.placement = placement;
    const input = document.createElement("textarea");
    root.appendChild(input);
    document.body.appendChild(root);
    return input;
  };
  const escapeFrom = (target: Element) => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    Object.defineProperty(event, "target", { value: target });
    return event;
  };

  it("closes the sidebar or sheet from anywhere inside it, the composer included", async () => {
    const { wrapper } = mountShortcuts("available");
    await flushPromises();
    const close = vi.fn();
    registerContainerCloser(close);
    expect(runEscapeLadder(escapeFrom(rootWith("sidebar")))).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("lets the assistant's open popover take Escape first (rung a), but not a page's own menu", async () => {
    const { wrapper } = mountShortcuts("available");
    await flushPromises();
    const close = vi.fn();
    registerContainerCloser(close);
    const pageMenu = document.createElement("div");
    pageMenu.setAttribute("role", "menu");
    pageMenu.dataset.state = "open";
    document.body.appendChild(pageMenu);
    expect(runEscapeLadder(escapeFrom(rootWith("sidebar")))).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    pageMenu.remove();
    close.mockClear();
    const popover = document.createElement("div");
    popover.setAttribute("data-o-popover-content", "");
    popover.dataset.state = "open";
    popover.innerHTML = '<div data-test="assistant-composer-hints-popover"></div>';
    document.body.appendChild(popover);
    expect(runEscapeLadder(escapeFrom(rootWith("sidebar")))).toBe(true);
    expect(close).not.toHaveBeenCalled();
    popover.remove();
    expect(runEscapeLadder(escapeFrom(rootWith("sidebar")))).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("keeps the full view open and swallows the key there", async () => {
    const { wrapper } = mountShortcuts("available");
    await flushPromises();
    const close = vi.fn();
    registerContainerCloser(close);
    expect(runEscapeLadder(escapeFrom(rootWith("full")))).toBe(true);
    expect(close).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("closes only a docked chat on rung g, and leaves an IME candidate list alone", async () => {
    const { wrapper } = mountShortcuts("available");
    await flushPromises();
    const close = vi.fn();
    registerContainerCloser(close);
    placement.kind = "docked";
    storeClose.mockClear();
    expect(runEscapeLadder(escapeFrom(rootWith("docked")))).toBe(true);
    expect(storeClose).toHaveBeenCalledWith("escape");
    expect(close).not.toHaveBeenCalled();
    const composing = new KeyboardEvent("keydown", { key: "Escape", isComposing: true });
    expect(runEscapeLadder(composing)).toBe(false);
    expect(storeClose).toHaveBeenCalledTimes(1);
    placement.kind = "hidden";
    wrapper.unmount();
  });

  it("drops the rungs when the binding unmounts", async () => {
    const { wrapper } = mountShortcuts("available");
    await flushPromises();
    const close = vi.fn();
    registerContainerCloser(close);
    wrapper.unmount();
    expect(runEscapeLadder(escapeFrom(rootWith("sidebar")))).toBe(false);
  });
});

describe("assistantOpen", () => {
  it("opens through openAssistant when nothing is visible", () => {
    onAssistantOpen();
    expect(openAssistant).toHaveBeenCalledWith({
      entryKind: "shortcut",
      entryVerb: "ask",
      objectKind: "none",
      intent: "open",
      container: "auto",
    });
    expect(window.__o2telemetry?.at(-1)).toMatchObject({
      name: "ai_shortcut",
      properties: { shortcut_id: "assistantOpen", effect: "open" },
    });
  });

  it("focuses a pending card before the composer and never closes", () => {
    placement.kind = "sidebar";
    const composer = vi.fn(() => true);
    const card = vi.fn(() => true);
    registerAssistantFocusTarget("composer", composer);
    const stopCard = registerAssistantFocusTarget("card", card);
    onAssistantOpen();
    expect(card).toHaveBeenCalled();
    expect(composer).not.toHaveBeenCalled();
    stopCard();
    onAssistantOpen();
    expect(composer).toHaveBeenCalledTimes(1);
    expect(openAssistant).not.toHaveBeenCalled();
    expect(window.__o2telemetry?.at(-1)?.properties).toMatchObject({ effect: "focus" });
  });
});
