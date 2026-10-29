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

import { afterEach, describe, expect, it } from "vitest";

import { LAYER_ROOT_ATTR, hideAllBut } from "./drawerInset";

afterEach(() => {
  document.body.innerHTML = "";
});

function page(html: string) {
  document.body.innerHTML = html;
  return (selector: string) => document.querySelector(selector)!;
}

const hidden = (el: Element) =>
  el.hasAttribute("inert") || el.getAttribute("aria-hidden") === "true";

describe("hideAllBut", () => {
  it.each([
    [
      "the toast viewport",
      `<div id="app"><main id="page"></main><ol ${LAYER_ROOT_ATTR} id="layer"></ol></div>`,
    ],
    [
      "a portaled popover or menu",
      `<main id="page"></main><div data-reka-popper-content-wrapper id="layer"></div>`,
    ],
    ["a portaled dialog or sheet", `<main id="page"></main><div role="dialog" id="layer"></div>`],
    ["a live region", `<main id="page"></main><div aria-live="polite" id="layer"></div>`],
  ])("keeps %s usable while the page is hidden and inert", (_, html) => {
    const q = page(`${html}<aside id="drawer"></aside>`);
    const undo = hideAllBut([q("#drawer")]);
    expect(hidden(q("#page"))).toBe(true);
    expect(hidden(q("#layer"))).toBe(false);
    expect(hidden(q("#drawer"))).toBe(false);
    undo();
    expect(hidden(q("#page"))).toBe(false);
  });

  it("leaves a branch that was already inert as it found it", () => {
    const q = page('<main id="page" inert></main><aside id="drawer"></aside>');
    const undo = hideAllBut([q("#drawer")]);
    expect(q("#page").getAttribute("aria-hidden")).toBe("true");
    undo();
    expect(q("#page").hasAttribute("inert")).toBe(true);
    expect(q("#page").hasAttribute("aria-hidden")).toBe(false);
  });
});
