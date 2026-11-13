import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canAutoFocus, focusWhenReady } from "./focusComposer";

let field: HTMLTextAreaElement;
function coarse(on: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: on }) as never;
}

beforeEach(() => {
  coarse(false);
  field = document.createElement("textarea");
  document.body.append(field);
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("canAutoFocus", () => {
  it("allows an idle page", () => expect(canAutoFocus(field)).toBe(true));
  it("refuses on a coarse pointer", () => {
    coarse(true);
    expect(canAutoFocus(field)).toBe(false);
  });
  it("refuses while another field has focus", () => {
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    expect(canAutoFocus(field)).toBe(false);
  });
  it("refuses over a modal dialog but not inside it", () => {
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    document.body.append(dlg);
    expect(canAutoFocus(field)).toBe(false);
    const inner = document.createElement("textarea");
    dlg.append(inner);
    expect(canAutoFocus(inner)).toBe(true);
  });
});

describe("focusWhenReady", () => {
  it("focuses an enabled field", async () => {
    expect(await focusWhenReady(() => field)).toBe(true);
    expect(document.activeElement).toBe(field);
  });
  it("skips a disabled field", async () => {
    field.disabled = true;
    expect(await focusWhenReady(() => field)).toBe(false);
  });
  it("retries once when the field mounts late", async () => {
    let calls = 0;
    expect(await focusWhenReady(() => (++calls > 1 ? field : null))).toBe(true);
  });
});
