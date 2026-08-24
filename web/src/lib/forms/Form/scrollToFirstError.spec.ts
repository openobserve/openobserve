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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { scrollToFirstError } from "./scrollToFirstError";

describe("scrollToFirstError", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // A single prototype stub is shared by every element, so "not called"
    // could never distinguish them — give each element its own spy.
    (Element.prototype as any).scrollIntoView = function () {};
  });

  function field(id: string, invalid: boolean) {
    const el = document.createElement("input");
    el.id = id;
    if (invalid) el.setAttribute("aria-invalid", "true");
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    return el;
  }

  it("scrolls the FIRST invalid control into view, not a later one", async () => {
    field("ok", false);
    const first = field("bad-1", true);
    const second = field("bad-2", true);

    const scrolled = await scrollToFirstError();

    expect(scrolled).toBe(true);
    expect(first.scrollIntoView).toHaveBeenCalled();
    expect(second.scrollIntoView).not.toHaveBeenCalled();
  });

  it("focuses the field so the user can start typing the fix", async () => {
    const el = field("bad", true);
    const focus = vi.spyOn(el, "focus");
    await scrollToFirstError();
    expect(focus).toHaveBeenCalled();
  });

  it("returns false and does nothing when no field is invalid", async () => {
    const el = field("ok", false);
    expect(await scrollToFirstError()).toBe(false);
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it('ignores aria-invalid="false" — only true marks an error', async () => {
    const el = field("ok", false);
    el.setAttribute("aria-invalid", "false");
    expect(await scrollToFirstError()).toBe(false);
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it("falls back to a non-focusable error container when no control is invalid", async () => {
    // The Monaco body editor is not a focusable control; its error state lives
    // on a wrapper (o2-enterprise#2394), which must still be scrolled to.
    const shell = document.createElement("div");
    shell.setAttribute("data-error", "true");
    shell.scrollIntoView = vi.fn();
    document.body.appendChild(shell);

    expect(await scrollToFirstError()).toBe(true);
    expect(shell.scrollIntoView).toHaveBeenCalled();
  });

  it("prefers a real invalid control over a data-error container", async () => {
    const shell = document.createElement("div");
    shell.setAttribute("data-error", "true");
    shell.scrollIntoView = vi.fn();
    document.body.appendChild(shell);
    const input = field("bad", true);

    await scrollToFirstError();

    expect(input.scrollIntoView).toHaveBeenCalled();
    expect(shell.scrollIntoView).not.toHaveBeenCalled();
  });

  it("searches only within the given root when one is passed", async () => {
    const outside = field("outside-bad", true);
    const root = document.createElement("div");
    const inside = document.createElement("input");
    inside.setAttribute("aria-invalid", "true");
    inside.scrollIntoView = vi.fn();
    root.appendChild(inside);
    document.body.appendChild(root);

    await scrollToFirstError(root);

    expect(inside.scrollIntoView).toHaveBeenCalled();
    expect(outside.scrollIntoView).not.toHaveBeenCalled();
  });
});
