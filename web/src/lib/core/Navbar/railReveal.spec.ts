// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import {
  RAIL_FADE_REM,
  hrefPathname,
  isFocusVisible,
  railClickPath,
  revealScrollTop,
  type RevealMetrics,
} from "./railReveal";

// A 1000x600 rail: 560 px tall under a 40 px header, 12 tiles of 52 px, 96 px of overflow.
const FADE = RAIL_FADE_REM * 16;
function metrics(
  scrollTop: number,
  tileTop: number,
  extra: Partial<RevealMetrics> = {},
): RevealMetrics {
  return {
    railTop: 40,
    railBottom: 600,
    tileTop,
    tileBottom: tileTop + 52,
    scrollTop,
    maxScrollTop: 96,
    fadePx: FADE,
    ...extra,
  };
}

describe("revealScrollTop", () => {
  it("scrolls a tile below the fold up into the clear band, clamped to the end", () => {
    // Settings sits at 645 (its bottom at 697), 97 px below the rail's bottom edge.
    expect(revealScrollTop(metrics(0, 645))).toBe(96);
  });

  it("scrolls a tile above the rail down into the clear band, clamped to 0", () => {
    // At scrollTop 96 the top fade is drawn, so the clear band starts at 88: 88 px up.
    expect(revealScrollTop(metrics(96, 0))).toBe(8);
  });

  it("moves a tile half under the bottom fade just clear of it", () => {
    // Bottom fade is drawn (scrollTop 0 < 96), so the clear band ends at 600 - 48 = 552.
    expect(revealScrollTop(metrics(0, 530))).toBe(30);
  });

  it("moves a tile half under the top fade just clear of it", () => {
    // Top fade drawn at scrollTop 60: the clear band starts at 40 + 48 = 88.
    expect(revealScrollTop(metrics(60, 60))).toBe(32);
  });

  it("returns null when the tile already sits inside the clear band", () => {
    expect(revealScrollTop(metrics(0, 300))).toBeNull();
    expect(revealScrollTop(metrics(40, 88))).toBeNull();
  });

  it("counts no bottom fade at the end, so the last tile is clear there", () => {
    expect(revealScrollTop(metrics(96, 548))).toBeNull();
  });

  it("counts no top fade at the start, so the first tile is clear there", () => {
    expect(revealScrollTop(metrics(0, 40))).toBeNull();
  });

  it("rounds the result", () => {
    expect(revealScrollTop(metrics(0, 530.4))).toBe(30);
  });

  it("returns null when the rounded target equals the current scrollTop", () => {
    expect(revealScrollTop(metrics(30, 500.3))).toBeNull();
  });
});

describe("hrefPathname", () => {
  it("strips origin, query and hash", () => {
    expect(hrefPathname("http://localhost:5080/web/logs?org_identifier=x#top")).toBe("/web/logs");
    expect(hrefPathname("/logs?org_identifier=x")).toBe("/logs");
  });
});

describe("railClickPath", () => {
  function click(target: Element, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent("click", { bubbles: true, button: 0, ...init });
    Object.defineProperty(event, "target", { value: target });
    return event;
  }

  function anchor(href: string, target?: string): HTMLAnchorElement {
    const a = document.createElement("a");
    a.href = href;
    if (target) a.target = target;
    const inner = document.createElement("span");
    a.appendChild(inner);
    document.body.appendChild(a);
    return a;
  }

  it("returns the pathname for a plain left click on an in-app anchor, through a nested target", () => {
    const a = anchor("/web/logs?org_identifier=x");
    expect(railClickPath(click(a.firstElementChild!))).toBe("/web/logs");
  });

  it("returns null for a new-tab anchor, a modified click, a non-primary button and a non-anchor", () => {
    expect(railClickPath(click(anchor("/web/logs", "_blank")))).toBeNull();
    expect(railClickPath(click(anchor("/web/logs"), { metaKey: true }))).toBeNull();
    expect(railClickPath(click(anchor("/web/logs"), { ctrlKey: true }))).toBeNull();
    expect(railClickPath(click(anchor("/web/logs"), { shiftKey: true }))).toBeNull();
    expect(railClickPath(click(anchor("/web/logs"), { button: 1 }))).toBeNull();
    expect(railClickPath(click(document.createElement("div")))).toBeNull();
  });

  it("treats a keyboard-synthesised click (detail 0) like a pointer click", () => {
    expect(railClickPath(click(anchor("/web/settings"), { detail: 0 }))).toBe("/web/settings");
  });
});

describe("isFocusVisible", () => {
  it("returns the selector result and never throws when the engine rejects the pseudo-class", () => {
    const el = document.createElement("a");
    vi.spyOn(el, "matches").mockReturnValue(true);
    expect(isFocusVisible(el)).toBe(true);
    vi.spyOn(el, "matches").mockImplementation(() => {
      throw new SyntaxError("unsupported");
    });
    expect(isFocusVisible(el)).toBe(false);
  });
});
