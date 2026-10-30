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

import DbmSubheaderBand from "./DbmSubheaderBand.vue";

describe("DbmSubheaderBand", () => {
  /**
   * The band sits between the toolbar and the rows and must align with BOTH:
   * `px-page-edge` is the table's own gutter, and the row divider is what makes
   * it read as part of the table frame rather than as a floating panel.
   */
  it("aligns with the table gutter and closes with the row divider", () => {
    const wrapper = mount(DbmSubheaderBand, { props: { dataTest: "dbm-queries-summary" } });

    expect(wrapper.classes()).toEqual([
      "px-page-edge",
      "border-table-row-divider",
      "border-b",
      "py-1.5",
    ]);
  });

  /** The data-test was the one thing that differed across the five tables. */
  it("carries the page's data-test", () => {
    const wrapper = mount(DbmSubheaderBand, { props: { dataTest: "dbm-deadlocks-summary" } });

    expect(wrapper.attributes("data-test")).toBe("dbm-deadlocks-summary");
  });

  it("renders whatever the page puts in the band", () => {
    const wrapper = mount(DbmSubheaderBand, {
      props: { dataTest: "dbm-activity-summary" },
      slots: { default: '<div data-test="strip" />' },
    });

    expect(wrapper.find('[data-test="strip"]').exists()).toBe(true);
  });
});
