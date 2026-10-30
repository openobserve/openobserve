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
  parsePanelEditorFocus,
  revealAndFocus,
  scrollIntoOwnScroller,
  usePanelEditorFocus,
  waitForElement,
  withoutFocusParam,
} from "./usePanelEditorFocus";

describe("usePanelEditorFocus", () => {
  afterEach(() => {
    usePanelEditorFocus().requestFocus(null);
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("accepts only the known focus targets", () => {
    expect(parsePanelEditorFocus("top-n")).toBe("top-n");
    expect(parsePanelEditorFocus(["vrl"])).toBe("vrl");
    expect(parsePanelEditorFocus("legend")).toBeNull();
    expect(parsePanelEditorFocus(undefined)).toBeNull();
  });

  it("drops only the focus param from the route query", () => {
    expect(withoutFocusParam({ panelId: "p1", focus: "top-n", tab: "t" })).toEqual({
      panelId: "p1",
      tab: "t",
    });
  });

  it("hands a request to its owner once and ignores other owners", () => {
    const { requestFocus, takeFocus, pendingFocus } = usePanelEditorFocus();
    requestFocus("vrl");
    expect(takeFocus("top-n")).toBe(false);
    expect(pendingFocus.value).toBe("vrl");
    expect(takeFocus("vrl")).toBe(true);
    expect(takeFocus("vrl")).toBe(false);
  });

  it("waits for a late element and gives up after the timeout", async () => {
    setTimeout(() => {
      document.body.innerHTML = '<div id="late"></div>';
    }, 60);
    await expect(waitForElement(() => document.getElementById("late"), 1000)).resolves.not.toBe(
      null,
    );
    await expect(waitForElement(() => null, 120)).resolves.toBeNull();
  });

  it("focuses the editable child without adding a second ring around the field", () => {
    document.body.innerHTML = '<div id="target"><label>Top N</label><input id="n" /></div>';
    const target = document.getElementById("target")!;

    revealAndFocus(target);

    expect(document.activeElement?.id).toBe("n");
    expect(target.className).toBe("");
  });

  const fakeBox = (el: HTMLElement, top: number, height: number) => {
    el.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect;
  };

  it("scrolls only the nearest scroll container, never the outer editor body", () => {
    document.body.innerHTML =
      '<div id="outer" style="overflow-y:auto"><div id="inner" style="overflow-y:auto"><div id="t"></div></div></div>';
    const outer = document.getElementById("outer")!;
    const inner = document.getElementById("inner")!;
    const target = document.getElementById("t")!;
    for (const el of [outer, inner]) {
      Object.defineProperty(el, "scrollHeight", { value: 1000 });
      Object.defineProperty(el, "clientHeight", { value: 200 });
    }
    fakeBox(inner, 0, 200);
    fakeBox(target, 500, 40);

    scrollIntoOwnScroller(target);

    expect(inner.scrollTop).toBe(340);
    expect(outer.scrollTop).toBe(0);
  });

  it("leaves every scroll position alone when asked not to scroll", () => {
    document.body.innerHTML =
      '<div id="inner" style="overflow-y:auto"><div id="t"><textarea id="ta"></textarea></div></div>';
    const inner = document.getElementById("inner")!;
    Object.defineProperty(inner, "scrollHeight", { value: 1000 });
    Object.defineProperty(inner, "clientHeight", { value: 200 });
    fakeBox(inner, 0, 200);
    fakeBox(document.getElementById("t")!, 500, 40);

    revealAndFocus(document.getElementById("t")!, { scroll: false });

    expect(inner.scrollTop).toBe(0);
    expect(document.activeElement?.id).toBe("ta");
  });
});
