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

// @vitest-environment jsdom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import { raw } from "@/types/i18n";

import OStatCard from "./OStatCard.vue";

const card = (props: Record<string, unknown> = {}) =>
  mount(OStatCard, { props: { label: raw("Alerts"), value: 2, sub: raw("1 paused"), ...props } });

describe("OStatCard", () => {
  it("keeps the qualifier beside the label by default", () => {
    const wrapper = card();
    expect(wrapper.text()).toContain("1 paused");
    expect(wrapper.find('[data-test="o-stat-card-sub-below"]').exists()).toBe(false);
  });

  it("moves the qualifier to its own line on subBelow", () => {
    const wrapper = card({ subBelow: true });
    expect(wrapper.get('[data-test="o-stat-card-sub-below"]').text()).toBe("1 paused");
    expect(wrapper.text().match(/1 paused/g)).toHaveLength(1);
  });

  it("drops the proportion bar on hideBar", () => {
    expect(card().find(".h-1").exists()).toBe(true);
    expect(card({ hideBar: true }).find(".h-1").exists()).toBe(false);
  });
});
