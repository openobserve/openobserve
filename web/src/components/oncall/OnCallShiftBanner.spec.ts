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

import OnCallShiftBanner from "@/components/oncall/OnCallShiftBanner.vue";
import i18n from "@/locales";

const stubs = {
  OUserCell: { name: "OUserCell", props: ["value", "name"], template: "<span />" },
  OText: { name: "OText", template: "<span><slot /></span>" },
};

function render(over: Record<string, unknown> = {}) {
  return mount(OnCallShiftBanner, {
    props: {
      userEmail: "ana@o2.ai",
      rotation: "Primary",
      teamName: "Payments",
      ...over,
    } as any,
    global: { plugins: [i18n], stubs },
  });
}

describe("OnCallShiftBanner", () => {
  it("names the rotation that put the viewer on call", () => {
    expect(render().text()).toContain("You're on call — Primary");
  });

  it("names the team the shift belongs to", () => {
    expect(render().find('[data-test="oncall-shift-banner-team"]').text()).toBe("Payments");
  });

  /// Counts down rather than naming the instant: "3h 12m" is what somebody
  /// decides against, and it survives the reader being in another timezone.
  it("counts down to the handover", () => {
    const wrapper = render({ endsAt: (Date.now() + 3 * 3_600_000 + 12 * 60_000) * 1000 });
    expect(wrapper.find('[data-test="oncall-shift-banner-handover"]').text()).toMatch(/3h 1[12]m/);
  });

  /// The shift is over; a negative or zero countdown would be nonsense, and the
  /// rotation itself is the authority on who is on call now.
  it("drops the countdown once the handover has passed", () => {
    const wrapper = render({ endsAt: (Date.now() - 60_000) * 1000 });
    expect(wrapper.find('[data-test="oncall-shift-banner-handover"]').exists()).toBe(false);
  });

  it("omits the countdown when the handover cannot be resolved", () => {
    const wrapper = render({ endsAt: null });
    expect(wrapper.find('[data-test="oncall-shift-banner-handover"]').exists()).toBe(false);
  });

  /// Being on call for three teams at once is worth knowing, but naming them
  /// all would push the countdown off the header.
  it("counts the other teams rather than naming them", () => {
    const wrapper = render({ otherTeams: 2 });
    expect(wrapper.find('[data-test="oncall-shift-banner-team"]').text()).toContain(
      "+2 more teams",
    );
  });

  it("labels the viewer's own avatar as You", () => {
    expect(render().findComponent({ name: "OUserCell" }).props("name")).toBe("You");
  });
});
