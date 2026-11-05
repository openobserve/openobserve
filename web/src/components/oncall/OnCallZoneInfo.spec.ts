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

import OnCallZoneInfo from "@/components/oncall/OnCallZoneInfo.vue";
import i18n from "@/locales";

const IST = "Asia/Calcutta";
const RANGE = {
  from: Date.parse("2026-11-04T18:30:00Z") * 1000,
  to: Date.parse("2026-11-05T18:30:00Z") * 1000,
};

function render(props: Record<string, unknown>) {
  return mount(OnCallZoneInfo, {
    props: { timezone: IST, viewerTimezone: IST, range: RANGE, ...props },
    global: {
      plugins: [i18n],
      stubs: { OTooltip: { template: "<span data-test='tip'><slot name='content' /></span>" } },
    },
  });
}

describe("OnCallZoneInfo", () => {
  it("names the team's zone, and nothing else when every clock agrees", () => {
    const wrapper = render({});
    expect(wrapper.attributes("aria-label")).toBe(
      "Times are in the team's timezone (Asia/Calcutta).",
    );
    expect(wrapper.find('[data-test="oncall-zone-info-other"]').exists()).toBe(false);
  });

  it("restates the window on the reader's clock when theirs differs", () => {
    const wrapper = render({ viewerTimezone: "UTC" });
    const line = wrapper.find('[data-test="oncall-zone-info-other"]').text();
    expect(line).toMatch(/^Your local time: .*Nov.* → .*Nov/);
    expect(line).toMatch(/18:30|06:30\sPM/);
  });

  /// A picker that can change zone says the range on the zone picked there, not the reader's.
  it("restates the window on the picked zone when it differs from the team's", () => {
    const wrapper = render({ viewerTimezone: "UTC", pickedTimezone: "UTC" });
    expect(wrapper.find('[data-test="tip"]').text()).toContain(
      "Pick in any timezone — the range is converted.",
    );
    expect(wrapper.find('[data-test="oncall-zone-info-other"]').text()).toMatch(/^In UTC: /);
  });

  it("says nothing extra while the window is half picked", () => {
    const wrapper = render({ viewerTimezone: "UTC", range: { from: Number.NaN, to: Number.NaN } });
    expect(wrapper.find('[data-test="oncall-zone-info-other"]').exists()).toBe(false);
  });
});
