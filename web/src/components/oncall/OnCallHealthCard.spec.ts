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

import OnCallHealthCard from "@/components/oncall/OnCallHealthCard.vue";
import i18n from "@/locales";
import type { ResponseHealth } from "@/utils/oncall";

const stubs = {
  OIcon: { name: "OIcon", template: "<span />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
};

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1_000_000;

function render(health: Partial<ResponseHealth> = {}, windowMicros = SEVEN_DAYS) {
  return mount(OnCallHealthCard, {
    props: {
      windowMicros,
      health: {
        sampleSize: 0,
        medianAckMicros: null,
        ackedBeforeEscalatingPct: null,
        topAlert: null,
        ...health,
      },
    },
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallHealthCard", () => {
  it("leads with the median time to ack", () => {
    const wrapper = render({ sampleSize: 40, medianAckMicros: 108_000_000 });
    expect(wrapper.find('[data-test="oncall-health-median"]').text()).toBe("1m 48s");
  });

  /// A zero would read as "answered instantly" rather than "nobody has".
  it("says nothing has been acknowledged rather than showing a zero", () => {
    const wrapper = render({ sampleSize: 12, medianAckMicros: null });
    expect(wrapper.find('[data-test="oncall-health-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="oncall-health-median"]').exists()).toBe(false);
  });

  it("reports the share acked before the ladder moved", () => {
    const wrapper = render({ medianAckMicros: 1_000_000, ackedBeforeEscalatingPct: 0.94 });
    expect(wrapper.find('[data-test="oncall-health-detail"]').text()).toContain(
      "94% acked before escalating",
    );
  });

  it("names the noisiest alert", () => {
    const wrapper = render({
      medianAckMicros: 1_000_000,
      topAlert: { title: "checkout latency", share: 0.38 },
    });
    expect(wrapper.find('[data-test="oncall-health-detail"]').text()).toContain(
      "38% from one alert (checkout latency)",
    );
  });

  /// The heading is written from the window it was handed, so widening the
  /// window cannot leave the card describing a period it did not read.
  it("names the window it actually covers", () => {
    expect(render().text()).toContain("7 days");
    expect(render({}, 24 * 60 * 60 * 1_000_000).text()).toContain("1 day");
  });

  /// Rounded to whole percent: a tenth of a percent on a sample of forty pages
  /// is precision the number does not have.
  it("rounds the shares to whole percent", () => {
    const wrapper = render({
      medianAckMicros: 1_000_000,
      ackedBeforeEscalatingPct: 2 / 3,
    });
    expect(wrapper.find('[data-test="oncall-health-detail"]').text()).toContain("67%");
  });

  it("omits a figure the sample could not answer", () => {
    const wrapper = render({ medianAckMicros: 1_000_000, ackedBeforeEscalatingPct: null });
    const detail = wrapper.find('[data-test="oncall-health-detail"]').text();
    expect(detail).not.toContain("acked before escalating");
  });
});
