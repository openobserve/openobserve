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

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IDLE_FOCUS_MS,
  noteAssistantKeydown,
  resetIdleFocusForTests,
  useAssistantIdleFocus,
} from "./useAssistantIdleFocus";

function mountRoot(): {
  root: HTMLElement;
  button: HTMLButtonElement;
  textarea: HTMLTextAreaElement;
} {
  const root = document.createElement("aside");
  root.setAttribute("data-assistant-root", "");
  const button = document.createElement("button");
  const textarea = document.createElement("textarea");
  root.append(button, textarea);
  document.body.append(root);
  return { root, button, textarea };
}

describe("useAssistantIdleFocus", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    resetIdleFocusForTests();
    vi.unstubAllGlobals();
  });

  it("lets a card take focus from the page body", () => {
    expect(useAssistantIdleFocus().canTakeFocus()).toBe(true);
  });

  it("never takes focus from the composer textbox or from outside the assistant", () => {
    const { textarea } = mountRoot();
    textarea.focus();
    expect(useAssistantIdleFocus().canTakeFocus()).toBe(false);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(useAssistantIdleFocus().canTakeFocus()).toBe(false);
  });

  it("takes focus from an idle control in the root, but not within 1.5 s of a keydown there", () => {
    const { button } = mountRoot();
    button.focus();
    let now = 10_000;
    const idle = useAssistantIdleFocus(() => now);
    expect(idle.canTakeFocus()).toBe(true);
    noteAssistantKeydown(now);
    now += IDLE_FOCUS_MS - 1;
    expect(idle.canTakeFocus()).toBe(false);
    now += 1;
    expect(idle.canTakeFocus()).toBe(true);
  });

  it("ends the announcement with the chord, or with where the card is on a touch screen", () => {
    expect(useAssistantIdleFocus().jumpKey()).toBe("assistant.announce.approvalJump");
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" }));
    expect(useAssistantIdleFocus().jumpKey()).toBe("assistant.announce.approvalJumpTouch");
  });
});
