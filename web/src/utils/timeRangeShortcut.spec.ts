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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShortcutManager } from "@/lib/vue-shortcut-manager";
import { openPrimaryTimeRangePicker, registerTimeRangePicker } from "@/utils/timeRangeShortcut";

describe("time range shortcut", () => {
  const cleanups: (() => void)[] = [];

  // jsdom lays nothing out, so a rendered picker is one whose root reports a box.
  const picker = (parent: HTMLElement = document.body, eligible = true) => {
    const el = document.createElement("div");
    if (eligible) el.setAttribute("data-date-time-shortcut", "true");
    el.getClientRects = () => [{}] as unknown as DOMRectList;
    parent.appendChild(el);
    const open = vi.fn();
    cleanups.push(registerTimeRangePicker(el, open));
    return { el, open };
  };

  const keyT = (target: EventTarget) => {
    const event = new KeyboardEvent("keydown", { key: "t", bubbles: true, cancelable: true });
    Object.defineProperty(event, "target", { value: target });
    Object.defineProperty(event, "composedPath", { value: () => [target] });
    return event;
  };

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    cleanups.splice(0).forEach((stop) => stop());
    document.body.innerHTML = "";
  });

  it("opens the first eligible picker in document order", () => {
    const first = picker();
    const second = picker();
    document.body.insertBefore(second.el, first.el);

    openPrimaryTimeRangePicker();

    expect(second.open).toHaveBeenCalledOnce();
    expect(first.open).not.toHaveBeenCalled();
  });

  it("skips a picker that is disabled, hidden or inside a dialog", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    const inDialog = picker(dialog);
    const disabled = picker(document.body, false);
    const hidden = picker();
    hidden.el.getClientRects = () => [] as unknown as DOMRectList;
    const page = picker();

    openPrimaryTimeRangePicker();

    expect(inDialog.open).not.toHaveBeenCalled();
    expect(disabled.open).not.toHaveBeenCalled();
    expect(hidden.open).not.toHaveBeenCalled();
    expect(page.open).toHaveBeenCalledOnce();
  });

  it("keeps working for the other picker when one unmounts", () => {
    const first = picker();
    const second = picker();
    cleanups.shift()?.();
    first.el.remove();

    openPrimaryTimeRangePicker();

    expect(second.open).toHaveBeenCalledOnce();
  });

  describe("through the shortcut manager", () => {
    let manager: ShortcutManager;

    beforeEach(() => {
      manager = new ShortcutManager({ preventDefault: true });
      manager.register({ key: "t", handler: openPrimaryTimeRangePicker, description: "t" });
    });

    it("opens the picker and keeps the t out of the page", () => {
      const { open } = picker();
      const event = keyT(document.body);

      manager.handleKeyDown(event);

      expect(open).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it.each([
      ["an input", () => document.createElement("input")],
      ["a textarea", () => document.createElement("textarea")],
      [
        "a contenteditable",
        () => {
          const div = document.createElement("div");
          div.contentEditable = "true";
          // jsdom does not derive isContentEditable from the attribute.
          Object.defineProperty(div, "isContentEditable", { value: true });
          return div;
        },
      ],
    ])("does nothing while typing in %s", (_, make) => {
      const { open } = picker();
      const field = make();
      document.body.appendChild(field);

      manager.handleKeyDown(keyT(field));

      expect(open).not.toHaveBeenCalled();
    });

    it("does nothing inside a dialog or an open popover", () => {
      const { open } = picker();
      for (const attr of [
        ["role", "dialog"],
        ["data-reka-popper-content-wrapper", ""],
      ]) {
        const layer = document.createElement("div");
        layer.setAttribute(attr[0], attr[1]);
        const button = document.createElement("button");
        layer.appendChild(button);
        document.body.appendChild(layer);
        manager.handleKeyDown(keyT(button));
      }

      expect(open).not.toHaveBeenCalled();
    });
  });
});
