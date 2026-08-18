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

import OnCallWhatFired from "@/components/oncall/OnCallWhatFired.vue";
import i18n from "@/locales";
import type { SubjectType } from "@/ts/interfaces/oncall";

const stubs = {
  OCard: { name: "OCard", template: "<div><slot /></div>" },
  OCardSection: { name: "OCardSection", template: "<div><slot /></div>" },
  OCode: { name: "OCode", template: "<code><slot /></code>" },
  OIcon: { name: "OIcon", template: "<i />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  // `to` reaches the rendered router-link through $attrs, exactly as `href`
  // does on the library's `as="a"` buttons — it is not a declared OButton prop.
  OButton: { name: "OButton", template: "<a><slot /></a>" },
  RouterLink: { name: "RouterLink", props: ["to"], template: "<a><slot /></a>" },
};

const OPENED_AT = 1_700_000_000_000_000;

const ALERT = {
  name: "checkout_error_ratio",
  stream_name: "gateway",
  stream_type: "logs",
  query_condition: {
    aggregation: { function: "avg", having: { column: "error_rate", operator: ">", value: 2 } },
  },
  trigger_condition: { period: 5 },
};

function render(props: Record<string, unknown> = {}) {
  return mount(OnCallWhatFired, {
    props: {
      orgId: "default",
      subjectType: "alert" as SubjectType,
      sourceId: "al_ckt",
      alert: ALERT,
      openedAt: OPENED_AT,
      ...props,
    },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallWhatFired", () => {
  it("states the condition and the window it was evaluated over", () => {
    expect(render().find('[data-test="oncall-what-fired-condition"]').text()).toBe(
      "avg(error_rate) > 2 over 5m",
    );
  });

  /// The record stores the threshold that fired but never the number that
  /// crossed it, so the value comes from the alert's own last evaluation —
  /// formatted by that screen's formatter rather than a second spelling.
  it("prints the observed value beside the threshold", () => {
    const wrapper = render({
      observed: { actual_value: 7.4, threshold_value: 2, threshold_operator: ">" },
    });
    expect(wrapper.find('[data-test="oncall-what-fired-observed"]').text()).toContain("7.4 > 2");
  });

  it("withholds the observation rather than guessing when there is none", () => {
    expect(render().find('[data-test="oncall-what-fired-observed"]').exists()).toBe(false);
    expect(
      render({ observed: {} }).find('[data-test="oncall-what-fired-observed"]').exists(),
    ).toBe(false);
  });

  /// `runbook_url` is hoisted onto the record by the API for exactly this row,
  /// and nothing in the app read it. Its absence is stated too — "no runbook"
  /// is a finding somebody can fix.
  it("links the runbook, and says so when there is none", () => {
    const withRunbook = render({ runbookUrl: "https://wiki/checkout" });
    const link = withRunbook.find('[data-test="oncall-what-fired-runbook"]');
    expect(link.attributes("href")).toBe("https://wiki/checkout");
    // A wiki link that replaces the page being triaged loses the page.
    expect(link.attributes("target")).toBe("_blank");

    expect(render().find('[data-test="oncall-what-fired-no-runbook"]').exists()).toBe(true);
  });

  /// The window is framed on the firing, not on now — by the time somebody
  /// opens this, now is not when it happened.
  it("frames the log window on the firing", () => {
    const to = render().findComponent({ name: "OButton" }).vm.$attrs.to as any;
    expect(to.query.stream).toBe("gateway");
    expect(to.query.from).toBe(OPENED_AT - 5 * 60 * 1_000_000);
    expect(to.query.to).toBe(OPENED_AT + 60 * 1_000_000);
  });

  /// A page outlives the rule it came from: with no alert there is no stream
  /// to open and no condition to print, and the card must still render.
  it("renders without the alert it describes", () => {
    const wrapper = render({ alert: null });
    expect(wrapper.find('[data-test="oncall-what-fired-condition"]').text()).toBe("—");
    expect(wrapper.find('[data-test="oncall-what-fired-logs"]').exists()).toBe(false);
  });

  // A synthetic has no alert rule to open, so it must not render a dead link.
  it("does not link a subject that is not an alert", () => {
    const wrapper = render({ subjectType: "synthetic" as SubjectType, alert: null });
    expect(wrapper.find('[data-test="oncall-what-fired-open-alert"]').exists()).toBe(false);
  });
});
