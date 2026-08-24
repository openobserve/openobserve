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

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { raw } from "@/types/i18n";

import DbmSection from "./DbmSection.vue";

const mountSection = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
  mount(DbmSection, { props: { title: raw("Query plans"), ...props }, slots });

describe("DbmSection", () => {
  /**
   * The shell the query detail page stacked six copies of. Pinned exactly,
   * because this component exists to keep those six cards identical — a class
   * dropped here silently restyles every section on the page at once.
   */
  it("renders the bordered card shell", () => {
    const wrapper = mountSection();

    expect(wrapper.element.tagName).toBe("SECTION");
    expect(wrapper.classes()).toEqual(
      expect.arrayContaining([
        "card-container",
        "border-border-default",
        "rounded-surface",
        "flex",
        "flex-col",
        "border",
      ]),
    );
  });

  it("renders the title as the card's heading", () => {
    const heading = mountSection().get("h3");
    expect(heading.text()).toBe("Query plans");
    expect(heading.classes()).toEqual(
      expect.arrayContaining(["text-text-heading", "text-sm", "font-medium"]),
    );
  });

  /**
   * Three alignments, not a free-form class. `baseline` sits a trailing note on
   * the heading's baseline, `center` centres a row carrying a control, and
   * `between` pushes a single note to the card's far edge — the three the page
   * actually uses, and nothing else.
   */
  it.each([
    ["baseline", "flex flex-wrap items-baseline gap-2 p-3 pb-1"],
    ["center", "flex flex-wrap items-center gap-2 p-3 pb-1"],
    ["between", "flex items-center justify-between gap-2 p-3 pb-1"],
  ])("lays the header out for headerAlign=%s", (headerAlign, expected) => {
    const header = mountSection({ headerAlign }).get("h3").element.parentElement;
    expect(header?.getAttribute("class")).toBe(expected);
  });

  /** Baseline is the common case, so it is what an unqualified section gets. */
  it("defaults to the baseline header", () => {
    const header = mountSection().get("h3").element.parentElement;
    expect(header?.getAttribute("class")).toBe("flex flex-wrap items-baseline gap-2 p-3 pb-1");
  });

  /**
   * `#hint` and `#actions` belong to the HEADER row — they sit beside the
   * heading. The default slot is the card BODY, outside that row, so a table or
   * a tile grid is not squeezed into a flex header.
   */
  it("puts hint and actions in the header row and the body outside it", () => {
    const wrapper = mountSection(
      {},
      {
        hint: '<span data-test="hint">tracked windows only</span>',
        actions: '<button data-test="action">Show all</button>',
        default: '<table data-test="body"></table>',
      },
    );

    const header = wrapper.get("h3").element.parentElement;
    expect(header?.querySelector('[data-test="hint"]')).not.toBeNull();
    expect(header?.querySelector('[data-test="action"]')).not.toBeNull();
    expect(header?.querySelector('[data-test="body"]')).toBeNull();
    expect(wrapper.find('[data-test="body"]').exists()).toBe(true);
  });

  /** The hint reads before the actions — a note about the card, then its control. */
  it("orders the header hint before the actions", () => {
    const wrapper = mountSection(
      {},
      { hint: '<span id="hint"></span>', actions: '<span id="action"></span>' },
    );
    const html = wrapper.html();
    expect(html.indexOf('id="hint"')).toBeLessThan(html.indexOf('id="action"'));
  });

  /**
   * Every caller identifies its card by `data-test`, and the tests that drive
   * this page find sections by it — so it has to land on the `<section>`, not
   * be swallowed by the component.
   */
  it("passes the caller's data-test through to the section", () => {
    const wrapper = mountSection({ "data-test": "dbm-detail-plans" });
    expect(wrapper.attributes("data-test")).toBe("dbm-detail-plans");
  });
});
