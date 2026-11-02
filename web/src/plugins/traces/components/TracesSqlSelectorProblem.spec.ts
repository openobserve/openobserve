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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import TracesSqlSelectorProblem from "./TracesSqlSelectorProblem.vue";
import OCode from "@/lib/core/Code/OCode.vue";

const suggestion = {
  before: "SELECT service_name, duration",
  after: "SELECT trace_id, service_name, duration",
};

const mountProblem = (props: Record<string, unknown>) =>
  mount(TracesSqlSelectorProblem, {
    props: { problem: "noTraceId", suggestion: null, aiEnabled: false, ...props },
    global: { plugins: [i18n, store] },
  });

describe("TracesSqlSelectorProblem", () => {
  it("shows the suggested change and Add trace_id and Run for a query without trace_id", async () => {
    const wrapper = mountProblem({ suggestion });
    expect(wrapper.attributes("data-test")).toBe("traces-sql-selector-problem");
    expect(wrapper.text()).toContain(i18n.global.t("traces.sqlMode.selector.title"));
    const diff = wrapper.find('[data-test="traces-sql-suggested-change"]');
    expect(diff.find('[data-test="traces-sql-suggested-change-before"]').text()).toContain(
      suggestion.before,
    );
    expect(diff.find('[data-test="traces-sql-suggested-change-after"]').text()).toContain(
      suggestion.after,
    );
    expect(diff.findComponent(OCode).props("wrap")).toBe(true);
    await wrapper.find('[data-test="traces-sql-add-trace-id-run-card"]').trigger("click");
    expect(wrapper.emitted("add-trace-id")).toHaveLength(1);
  });

  it("offers no change for a grouped query, only the Spans view", async () => {
    const wrapper = mountProblem({ suggestion: null });
    expect(wrapper.find('[data-test="traces-sql-suggested-change"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="traces-sql-add-trace-id-run-card"]').exists()).toBe(false);
    await wrapper.find('[data-test="traces-sql-open-in-spans-card"]').trigger("click");
    expect(wrapper.emitted("open-spans")).toHaveLength(1);
  });

  it.each(["selectAll", "notSingleSelect", "quotedMarker"])(
    "explains %s and offers the Spans view",
    (problem) => {
      const wrapper = mountProblem({ problem });
      expect(wrapper.text()).toContain(i18n.global.t(`traces.sqlMode.selector.${problem}`));
      expect(wrapper.find('[data-test="traces-sql-open-in-spans-card"]').exists()).toBe(true);
    },
  );

  it("names the quoted -- or ; problem in its own title", () => {
    const wrapper = mountProblem({ problem: "quotedMarker" });
    expect(wrapper.text()).toContain(i18n.global.t("traces.sqlMode.selector.quotedMarkerTitle"));
  });

  it("offers Ask AI only when AI is enabled", async () => {
    expect(mountProblem({}).find('[data-test="query-error-ask-ai-btn"]').exists()).toBe(false);
    const wrapper = mountProblem({ aiEnabled: true });
    await wrapper.find('[data-test="query-error-ask-ai-btn"]').trigger("click");
    expect(wrapper.emitted("ask-ai")).toHaveLength(1);
  });
});
