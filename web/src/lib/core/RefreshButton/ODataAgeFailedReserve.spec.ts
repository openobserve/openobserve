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
import ODataAge from "./ODataAge.vue";
import ODataAgeFailedReserve from "./ODataAgeFailedReserve.vue";

const stubs = { OTooltip: { template: "<span />" } };

describe("ODataAgeFailedReserve", () => {
  it("has the short failed marker's box, icon and words, so a slot it sizes fits the marker exactly", () => {
    const marker = mount(ODataAge, {
      props: { at: 1, failedAt: 2, short: true },
      global: { stubs },
    }).get('[data-state="failed"]');
    const reserve = mount(ODataAgeFailedReserve).get('[data-test="data-age-failed-reserve"]');
    expect(reserve.classes().filter((c) => c !== "invisible")).toEqual(marker.classes());
    expect(reserve.findComponent({ name: "OIcon" }).props()).toMatchObject(
      marker.findComponent({ name: "OIcon" }).props(),
    );
    const words = marker
      .findAll('[aria-hidden="true"]')
      .map((w) => w.text())
      .filter(Boolean);
    expect(words).toEqual([reserve.text()]);
    expect(reserve.text()).toBe("Refresh failed");
  });

  it("is never seen, read or focused", () => {
    const reserve = mount(ODataAgeFailedReserve).get('[data-test="data-age-failed-reserve"]');
    expect(reserve.classes()).toContain("invisible");
    expect(reserve.attributes("aria-hidden")).toBe("true");
    expect(reserve.attributes("tabindex")).toBeUndefined();
    expect(reserve.find(".sr-only").exists()).toBe(false);
  });
});
