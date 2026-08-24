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

import OIcon from "@/lib/core/Icon/OIcon.vue";

import DbmDisclosureLine from "./DbmDisclosureLine.vue";

const mountLine = (props: Record<string, unknown> = {}, slot = "Counters are cumulative.") =>
  mount(DbmDisclosureLine, { props, slots: { default: slot } });

describe("DbmDisclosureLine", () => {
  /**
   * `items-start`, not `items-center`. These lines wrap, and a centred glyph on
   * a two-line caveat floats into the gap between the lines rather than marking
   * where the sentence starts.
   */
  it("anchors its glyph to the first line of a wrapping caveat", () => {
    const wrapper = mountLine();

    expect(wrapper.classes()).toEqual([
      "text-text-secondary",
      "text-2xs",
      "flex",
      "items-start",
      "gap-1.5",
    ]);
    expect(wrapper.findComponent(OIcon).classes()).toEqual(
      expect.arrayContaining(["mt-px", "shrink-0"]),
    );
  });

  /** A caveat and an all-clear are opposite claims and must not wear one glyph. */
  it("defaults to the caveat glyph and takes the all-clear one on request", () => {
    expect(mountLine().findComponent(OIcon).props("name")).toBe("info");
    expect(mountLine({ icon: "check" }).findComponent(OIcon).props("name")).toBe("check");
  });

  it("states the caveat, markup and all", () => {
    const wrapper = mountLine({}, "<strong>Lifetime</strong> — not this window");

    expect(wrapper.text()).toContain("Lifetime");
    expect(wrapper.find("strong").exists()).toBe(true);
  });

  /** Some of these lines are asserted by name in the page's own specs. */
  it("carries a data-test when the page names it, and none when it does not", () => {
    expect(mountLine({ dataTest: "dbm-recommendations-cumulative" }).attributes("data-test")).toBe(
      "dbm-recommendations-cumulative",
    );
    expect(mountLine().attributes("data-test")).toBeUndefined();
  });
});
