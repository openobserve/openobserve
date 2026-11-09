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

import HomeStateMark from "./HomeStateMark.vue";

describe("HomeStateMark", () => {
  it.each([
    ["critical", "bg-service-health-critical"],
    ["degraded", "bg-service-health-warning"],
    ["anomaly", "bg-status-info-text"],
    ["recovered", "border-text-secondary"],
  ] as const)("draws a round %s dot", (bucket, tone) => {
    const wrapper = mount(HomeStateMark, { props: { bucket } });
    const dot = wrapper.get('[aria-hidden="true"]');
    expect(dot.classes()).toEqual(expect.arrayContaining(["rounded-full", "size-2", tone]));
    expect(wrapper.attributes("data-bucket")).toBe(bucket);
  });

  it("draws a recovered row as a neutral ring, never healthy green (B-shell2-3)", () => {
    const dot = mount(HomeStateMark, { props: { bucket: "recovered" } }).get(
      '[aria-hidden="true"]',
    );
    expect(dot.classes()).toEqual(expect.arrayContaining(["border", "bg-transparent"]));
    expect(dot.html()).not.toMatch(/healthy/);
  });

  it("draws a flapping row amber whatever its bucket says", () => {
    const wrapper = mount(HomeStateMark, { props: { bucket: "recovered", flapping: true } });
    expect(wrapper.get('[aria-hidden="true"]').classes()).toContain("bg-service-health-warning");
    expect(wrapper.attributes("data-flapping")).toBe("true");
  });
});
