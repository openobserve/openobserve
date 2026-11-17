// Copyright 2026 OpenObserve Inc.

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { hoversNestedTrigger } from "./nestedTrigger";

// jsdom has no :hover state, so the outer trigger reports which inner triggers are hovered.
function outerWith(...inner: HTMLElement[]) {
  const own = document.createElement("button");
  own.setAttribute("data-o-tooltip-trigger", "");
  inner.forEach((el) => own.appendChild(el));
  own.querySelectorAll = (() => inner) as unknown as typeof own.querySelectorAll;
  return own;
}
function trigger(marker: string, cut = false) {
  const el = document.createElement("span");
  el.setAttribute("data-o-tooltip-trigger", marker);
  Object.defineProperty(el, "scrollWidth", { value: cut ? 300 : 100 });
  Object.defineProperty(el, "clientWidth", { value: 100 });
  return el;
}

describe("hoversNestedTrigger", () => {
  it("lets the outer tooltip open over a label whose text fits", () => {
    expect(hoversNestedTrigger(outerWith(trigger("overflow")))).toBe(false);
  });

  it("yields to a label whose text is cut, since that one opens", () => {
    expect(hoversNestedTrigger(outerWith(trigger("overflow", true)))).toBe(true);
  });

  it("always yields to a nested control with its own tooltip", () => {
    expect(hoversNestedTrigger(outerWith(trigger("")))).toBe(true);
  });

  it("does not yield to itself or when nothing inside is hovered", () => {
    expect(hoversNestedTrigger(outerWith())).toBe(false);
    expect(hoversNestedTrigger(null)).toBe(false);
  });
});
