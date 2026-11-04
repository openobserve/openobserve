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
import ChartZoomControls from "@/components/traces/ChartZoomControls.vue";

const mountControls = () =>
  mount(ChartZoomControls, {
    props: { dataTestPrefix: "trace-graph" },
    global: { plugins: [i18n] },
  });

describe("ChartZoomControls", () => {
  it("prefixes every data-test with dataTestPrefix", () => {
    const wrapper = mountControls();
    for (const suffix of ["zoom-controls", "zoom-in", "zoom-out", "fit-screen"]) {
      expect(wrapper.find(`[data-test="trace-graph-${suffix}"]`).exists()).toBe(true);
    }
  });

  it.each([
    ["zoom-in", "zoom-in"],
    ["zoom-out", "zoom-out"],
    ["fit-screen", "fit"],
  ])("clicking %s emits %s", async (suffix, event) => {
    const wrapper = mountControls();
    await wrapper.find(`[data-test="trace-graph-${suffix}"]`).trigger("click");
    expect(wrapper.emitted(event)).toHaveLength(1);
  });
});
