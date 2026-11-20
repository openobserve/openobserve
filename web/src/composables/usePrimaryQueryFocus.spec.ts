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

import { describe, it, expect, afterEach } from "vitest";
import { focusPrimaryQuery } from "./usePrimaryQueryFocus";

// jsdom lays nothing out, so "shown" is stubbed per element.
const show = (element: Element) => {
  element.getClientRects = () => [{} as DOMRect] as unknown as DOMRectList;
};

describe("focusPrimaryQuery", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("focuses the shown field of the marked region and skips a hidden editor", () => {
    document.body.innerHTML = `
      <div data-primary-query>
        <textarea id="hidden-editor"></textarea>
        <input id="filter" />
      </div>
      <input id="field-search" />`;
    const region = document.querySelector("[data-primary-query]")!;
    show(region);
    show(document.getElementById("filter")!);

    expect(focusPrimaryQuery()).toBe(true);
    expect(document.activeElement?.id).toBe("filter");
  });

  it("falls back to an extra selector when no marked region is shown", () => {
    document.body.innerHTML = `
      <div data-primary-query><input id="grid-search" /></div>
      <div data-test="editor"><textarea id="promql"></textarea></div>`;
    show(document.querySelector('[data-test="editor"]')!);
    show(document.getElementById("promql")!);

    expect(focusPrimaryQuery(['[data-test="editor"]'])).toBe(true);
    expect(document.activeElement?.id).toBe("promql");
  });

  it("reports false when nothing can take focus", () => {
    document.body.innerHTML = `<div data-primary-query><input disabled /></div>`;
    show(document.querySelector("[data-primary-query]")!);
    expect(focusPrimaryQuery()).toBe(false);
  });
});
