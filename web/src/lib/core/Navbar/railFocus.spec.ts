// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findContentFocusTarget, findHeaderFocusTarget, isVisibleFocusable } from "./railFocus";

// jsdom lays nothing out, so an element has rects exactly when it is not display:none.
function stubClientRects() {
  return vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    const hidden = getComputedStyle(this).display === "none";
    return (hidden ? [] : [{}]) as unknown as DOMRectList;
  });
}

describe("railFocus", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spy = stubClientRects();
    document.body.innerHTML = `
      <header class="o2-app-header">
        <button data-test="hamburger" style="display: none">menu</button>
        <a data-test="logo" href="/web/">logo</a>
        <button data-test="ai">ai</button>
      </header>
      <div class="o2-content-scroll">
        <button data-test="disabled" disabled>no</button>
        <input data-test="search" />
        <a data-test="link" href="/x">x</a>
      </div>`;
  });

  afterEach(() => {
    spy.mockRestore();
    document.body.innerHTML = "";
  });

  it("treats a display-none element as not focusable", () => {
    expect(isVisibleFocusable(document.querySelector('[data-test="hamburger"]')!)).toBe(false);
    expect(isVisibleFocusable(document.querySelector('[data-test="logo"]')!)).toBe(true);
  });

  it("skips the hidden hamburger and returns the first visible header control", () => {
    expect(findHeaderFocusTarget()?.getAttribute("data-test")).toBe("logo");
  });

  it("returns the hamburger when it is visible (mobile header)", () => {
    (document.querySelector('[data-test="hamburger"]') as HTMLElement).style.display = "";
    expect(findHeaderFocusTarget()?.getAttribute("data-test")).toBe("hamburger");
  });

  it("returns null without throwing when no header control exists", () => {
    document.querySelector("header")!.remove();
    expect(findHeaderFocusTarget()).toBeNull();
  });

  it("returns the first enabled content control", () => {
    expect(findContentFocusTarget()?.getAttribute("data-test")).toBe("search");
  });

  it("skips a hidden content control", () => {
    (document.querySelector('[data-test="search"]') as HTMLElement).style.display = "none";
    expect(findContentFocusTarget()?.getAttribute("data-test")).toBe("link");
  });
});
