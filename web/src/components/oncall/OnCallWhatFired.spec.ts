// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import OnCallWhatFired from "./OnCallWhatFired.vue";

const mountFired = (alert: any) =>
  mount(OnCallWhatFired, { props: { alert }, global: { plugins: [i18n] } });

describe("OnCallWhatFired", () => {
  /// L4: a condition wraps at word boundaries and breaks inside a word only when one word overflows.
  it("wraps the conditions between words, not mid-word", () => {
    const wrapper = mountFired({
      query_condition: {
        type: "custom",
        aggregation: {
          function: "avg",
          having: { column: "latency", operator: ">", value: 500 },
          warning_value: 300,
        },
      },
    });
    for (const hook of ["oncall-what-fired-condition", "oncall-what-fired-warning"]) {
      const classes = wrapper.find(`[data-test="${hook}"]`).classes();
      expect(classes, hook).toContain("wrap-anywhere");
      expect(classes, hook).not.toContain("break-all");
    }
  });

  it("wraps a long SQL condition without breaking mid-word, stacked under its label", () => {
    const sql = "SELECT count(*) FROM default\nWHERE eventName = 'ConsoleLogin'";
    const wrapper = mountFired({ query_condition: { type: "sql", sql } });
    const value = wrapper.find('[data-test="oncall-what-fired-condition"]');
    expect(value.classes()).not.toContain("break-all");
    expect(value.classes()).toEqual(
      expect.arrayContaining(["whitespace-pre-wrap", "wrap-anywhere"]),
    );
    expect(value.element.textContent).toBe(sql);
    const item = wrapper.find('[data-test="oncall-what-fired-condition-item"]');
    expect(item.classes()).toContain("flex-col");
    expect(wrapper.find('[data-test="oncall-what-fired-warning"]').exists()).toBe(false);
  });

  it("keeps a threshold and its warning on label rows, both wrapped the same way", () => {
    const wrapper = mountFired({
      query_condition: {
        aggregation: {
          function: "avg",
          having: { column: "latency", operator: ">", value: 500 },
          warning_value: 200,
        },
      },
    });
    const item = wrapper.find('[data-test="oncall-what-fired-condition-item"]');
    expect(item.classes()).not.toContain("flex-col");
    for (const key of ["condition", "warning"]) {
      const value = wrapper.find(`[data-test="oncall-what-fired-${key}"]`);
      expect(value.classes()).not.toContain("break-all");
      expect(value.classes()).toContain("whitespace-pre-wrap");
    }
  });
});
