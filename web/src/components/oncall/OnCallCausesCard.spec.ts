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

import OnCallCausesCard from "@/components/oncall/OnCallCausesCard.vue";
import i18n from "@/locales";
import type { CauseAnalytics } from "@/ts/interfaces/oncall";
import { MICROS_PER_DAY } from "@/ts/interfaces/oncall";

const stubs = {
  OIcon: { name: "OIcon", template: "<span />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
  OTooltip: { name: "OTooltip", props: ["content"], template: "<span />" },
};

const TO = 1_700_000_000_000_000;

function analytics(over: Partial<CauseAnalytics> = {}): CauseAnalytics {
  return {
    from: TO - 30 * MICROS_PER_DAY,
    to: TO,
    total: 10,
    causes: [
      { cause: "noisy_threshold", count: 6, last_title: "checkout_latency" },
      { cause: "genuine_defect", count: 4 },
    ],
    ...over,
  };
}

function render(a: CauseAnalytics | null) {
  return mount(OnCallCausesCard, {
    props: { analytics: a },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallCausesCard", () => {
  it("leads with the biggest cause and its share", () => {
    const wrapper = render(analytics());

    expect(wrapper.find('[data-test="oncall-causes-share"]').text()).toBe("60%");
    expect(wrapper.find('[data-test="oncall-causes-leader"]').text()).toBe("Noisy threshold");
  });

  /// The endpoint makes no ordering promise, and "what keeps breaking us" is
  /// meaningless if it names the wrong row.
  it("finds the leader even when the rows arrive out of order", () => {
    const wrapper = render(
      analytics({
        causes: [
          { cause: "genuine_defect", count: 2 },
          { cause: "capacity_or_load", count: 8 },
        ],
      }),
    );
    expect(wrapper.find('[data-test="oncall-causes-leader"]').text()).toBe("Capacity or load");
  });

  it("names the runner-up and the leader's most recent example", () => {
    const detail = render(analytics()).find('[data-test="oncall-causes-detail"]').text();

    expect(detail).toContain("40% Genuine defect");
    expect(detail).toContain("checkout_latency");
  });

  /// A cause is recorded at resolve, so an org that never fills it in has
  /// nothing here — a different fact from "nothing broke".
  it("says nothing has been given a cause rather than showing a zero", () => {
    const wrapper = render(analytics({ total: 0, causes: [] }));

    expect(wrapper.find('[data-test="oncall-causes-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-causes-share"]').exists()).toBe(false);
  });

  it("degrades to the empty state when the endpoint is unavailable", () => {
    expect(render(null).find('[data-test="oncall-causes-empty"]').exists()).toBe(true);
  });

  /// Labelled from the window the SERVER answered for: the endpoint defaults
  /// the range when the client omits it, so echoing a local guess could name a
  /// period it did not count.
  it("labels itself with the server's window, not a local constant", () => {
    const wrapper = render(analytics({ from: TO - 7 * MICROS_PER_DAY, to: TO }));
    expect(wrapper.text()).toContain("last 7 days");
  });

  /// I8: the detail line carries a real alert title, so it is exactly as long
  /// as whatever somebody named their alert — and this card is one column of a
  /// side rail.
  it("keeps the clipped detail line readable in full", () => {
    const wrapper = render(
      analytics({
        causes: [
          {
            cause: "noisy_threshold",
            count: 6,
            last_title: "checkout_latency_p99_above_threshold_for_five_minutes",
          },
          { cause: "genuine_defect", count: 4 },
        ],
      }),
    );

    const tip = wrapper.findComponent({ name: "OTooltip" });
    expect(String(tip.props("content"))).toContain(
      "checkout_latency_p99_above_threshold_for_five_minutes",
    );
  });
});
