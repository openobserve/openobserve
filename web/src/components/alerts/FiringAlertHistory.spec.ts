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
import { createStore } from "vuex";
import i18n from "@/locales";
import FiringAlertHistory from "./FiringAlertHistory.vue";

const store = createStore({ state: { timezone: "UTC" } });
const MIN = 60_000_000;
const NOW = 1_800_000_000_000_000;

const mountHistory = (props: Record<string, unknown>) =>
  mount(FiringAlertHistory, {
    props: {
      hits: [],
      nowUs: NOW,
      destinations: ["slack"],
      viewAll: "/alerts/detail/a1",
      ...props,
    },
    global: {
      provide: { store },
      plugins: [i18n],
      stubs: { RouterLink: { props: ["to"], template: "<a :href='to'><slot /></a>" } },
    },
  });

describe("FiringAlertHistory", () => {
  it("stretches the bar to the firing start and reads as such", () => {
    const wrapper = mountHistory({
      hits: [{ timestamp: NOW - MIN, status: "firing" }],
      firingStartedAt: NOW - 180 * MIN,
    });
    expect(wrapper.text()).toContain("last 3h 00m");
    expect(wrapper.text()).toContain("3h 00m firing");
    expect(wrapper.findAll('[data-test="alerts-firing-history-segment-firing"]')).toHaveLength(1);
  });

  it("marks what a partial read did not reach and invents no start at its edge", () => {
    const wrapper = mountHistory({
      hits: [{ timestamp: NOW - 30 * MIN, status: "firing" }],
      partial: true,
    });
    const unknown = wrapper.find('[data-test="alerts-firing-history-segment-unknown"]');
    expect(unknown.exists()).toBe(true);
    expect(unknown.classes()).toEqual(expect.arrayContaining(["bg-hatched", "border-dashed"]));
    expect(wrapper.text()).toContain("1h 30m not read");
    expect(wrapper.findAll('[data-test="alerts-firing-history-event"]')).toHaveLength(0);
  });

  it("covers the last 2h otherwise", () => {
    const wrapper = mountHistory({ hits: [{ timestamp: NOW - MIN, status: "normal" }] });
    expect(wrapper.text()).toContain("last 2h");
    expect(wrapper.text()).toContain("2h 00m ok");
  });

  it("writes the events as the mock does, with View all", () => {
    const wrapper = mountHistory({
      hits: [
        { timestamp: NOW - 2 * MIN, status: "firing", success_response: "destination slack ok;" },
        {
          timestamp: NOW - 42 * MIN,
          status: "firing",
          actual_value: 2.4,
          threshold_value: 2,
          threshold_operator: ">",
        },
        { timestamp: NOW - 94 * MIN, status: "normal", actual_value: 0.7 },
        { timestamp: NOW - 112 * MIN, status: "firing" },
        { timestamp: NOW - 118 * MIN, status: "normal" },
      ],
    });
    const lines = wrapper
      .findAll('[data-test="alerts-firing-history-event"]')
      .map((node) => node.text());
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("Notified slack");
    expect(lines[1]).toContain("Started firing");
    expect(lines[1]).toContain("2.4 > 2");
    expect(lines[1]).toContain("42m so far");
    expect(lines[2]).toContain("Recovered");
    expect(lines[2]).toContain("ok for 52m");
    expect(lines[3]).toContain("lasted 18m");
    expect(wrapper.find('[data-test="alerts-firing-history-view-all"]').attributes("href")).toBe(
      "/alerts/detail/a1",
    );
  });

  it("shows an ack in the shared history words", () => {
    const wrapper = mountHistory({
      hits: [{ timestamp: NOW - MIN, status: "ack_event", acked_by: "p@x", ack_action: "ack" }],
    });
    expect(wrapper.find('[data-test="alerts-firing-history-event"]').text()).toContain(
      "Acknowledged by p@x",
    );
  });

  it("tells a failed read from an empty one", () => {
    expect(mountHistory({}).find('[data-test="alerts-firing-history-empty"]').exists()).toBe(true);
    expect(
      mountHistory({ failed: true }).find('[data-test="alerts-firing-history-error"]').exists(),
    ).toBe(true);
  });
});
