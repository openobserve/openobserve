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

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isAssistantV2, resetAssistantV2ForTests } from "@/composables/assistant/flags";

import {
  GO_TO_EDITOR_ACTION_ID,
  SHORTCUT_REGISTRY,
  getShortcutDef,
  getShortcutDisplay,
  setDictationReady,
  resolveShortcutKeys,
  type ShortcutCapabilities,
} from "../shortcutRegistry";

// Everything on: the audit must hold on the build that shows the most rows.
const ALL_ON: ShortcutCapabilities = {
  isEnterprise: true,
  isCloud: true,
  isMetaOrg: true,
  onlineEvalsEnabled: true,
  incidentsEnabled: true,
  modelPricingEnabled: true,
  rbacEnabled: true,
  aiEnabled: true,
  downtimesEnabled: true,
  assistantCanChat: true,
};

// The dashboard binds Escape to both layout-edit and kiosk exit; only one of them is ever live.
const SHARED_ON_PURPOSE = ["dashboard escape"];

/** Every visible, registerable binding as `scope keys` for one platform. */
function visibleBindings(mac: boolean): string[] {
  return SHORTCUT_REGISTRY.flatMap((group) => {
    if (group.visible && !group.visible(ALL_ON)) return [];
    return group.shortcuts
      .filter((entry) => !entry.visible || entry.visible(ALL_ON))
      .flatMap((entry) => {
        const def = getShortcutDef(entry.id);
        if (!def) return [];
        return resolveShortcutKeys(def, mac).map((key) => `${group.scope ?? "global"} ${key}`);
      });
  });
}

beforeEach(() => {
  window.__O2_ASSISTANT_V2__ = true;
});

afterEach(() => {
  delete window.__O2_ASSISTANT_V2__;
  resetAssistantV2ForTests();
});

describe("shortcut conflict audit (10 §6.4)", () => {
  it.each([false, true])("no two visible entries share keys and scope (mac: %s)", (mac) => {
    const bindings = visibleBindings(mac);
    const duplicates = bindings.filter(
      (b, i) => bindings.indexOf(b) !== i && !SHARED_ON_PURPOSE.includes(b),
    );
    expect(duplicates).toEqual([]);
  });

  it("keeps Ctrl+I global and the editor helper on the same chord in its own scope", () => {
    const bindings = visibleBindings(false);
    expect(bindings).toContain("global ctrl+i");
    expect(bindings).toContain("editor ctrl+i");
  });

  it("puts the assistant's Escape in its own scope, apart from closeDialog", () => {
    expect(getShortcutDef("assistantClose")?.scope).toBe("assistant");
    expect(getShortcutDef("closeDialog")?.scope).toBeUndefined();
  });

  it("covers the go-to-answer and tab-focus rows of round 2 (X-24, X-28)", () => {
    expect(visibleBindings(false)).toEqual(
      expect.arrayContaining(["assistantComposer ctrl+up", "editor ctrl+m"]),
    );
    expect(visibleBindings(true)).toEqual(
      expect.arrayContaining(["assistantComposer meta+up", "editor ctrl+shift+m"]),
    );
  });

  it("shares the dictate chord with assistantOpen on purpose, as a display entry that binds nothing", () => {
    expect(getShortcutDef("assistantComposerDictate")).toBeUndefined();
    expect(getShortcutDisplay("assistantComposerDictate")).toBe("ctrl+i");
    expect(getShortcutDisplay("assistantOpen")).toBe("ctrl+i");
  });

  it("lists the dictate chord only while the assistant says dictation is ready", () => {
    const entry = SHORTCUT_REGISTRY.flatMap((group) => group.shortcuts).find(
      (shortcut) => shortcut.id === "assistantComposerDictate",
    )!;
    expect(entry.visible!(ALL_ON)).toBe(false);
    setDictationReady(true);
    expect(entry.visible!(ALL_ON)).toBe(isAssistantV2());
    setDictationReady(false);
  });

  it("never binds the palette chord to the assistant", () => {
    const assistantKeys = ["assistantOpen", "assistantHelper", "assistantHistory"].flatMap((id) =>
      resolveShortcutKeys(getShortcutDef(id)!, true),
    );
    expect(assistantKeys).not.toContain("meta+k");
  });

  it("binds goTo globally on the palette chord, so the scoped K8s palette still wins inside kubernetes", () => {
    for (const mac of [false, true]) {
      const key = mac ? "meta+k" : "ctrl+k";
      const bindings = visibleBindings(mac);
      expect(bindings).toContain(`global ${key}`);
      expect(bindings).toContain(`kubernetes ${key}`);
      expect(bindings.filter((b) => b === `global ${key}`)).toHaveLength(1);
    }
    expect(getShortcutDef("goTo")?.scope).toBeUndefined();
    expect(getShortcutDef("k8sPalette")?.scope).toBe("kubernetes");
  });

  it("lists the editor Go to action id on the goTo chord", () => {
    expect(GO_TO_EDITOR_ACTION_ID).toBe("o2.goTo");
    const def = getShortcutDef("goTo")!;
    expect(resolveShortcutKeys(def, true)).toEqual(["meta+k"]);
    expect(resolveShortcutKeys(def, false)).toEqual(["ctrl+k"]);
  });
});
