// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { tooltipNameTarget } from "./triggerName";

const build = (html: string, selector: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.querySelector(selector) as Element;
};

describe("tooltipNameTarget", () => {
  it("names the enclosing button when the trigger is only an icon inside it", () => {
    const icon = build('<button id="b"><span aria-hidden="true" id="i"></span></button>', "#i");
    expect(tooltipNameTarget(icon)?.id).toBe("b");
  });

  it("names nothing when the trigger sits in no control", () => {
    const trigger = build('<div><span id="i"></span></div>', "#i");
    expect(tooltipNameTarget(trigger)).toBeNull();
  });

  it("leaves a control that already has visible text or a name", () => {
    const text = build('<button>Save<span id="i"></span></button>', "#i");
    const named = build('<button aria-label="Own"><span id="i"></span></button>', "#i");
    expect(tooltipNameTarget(text)).toBeNull();
    expect(tooltipNameTarget(named)).toBeNull();
  });
});
