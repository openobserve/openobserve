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
import ProfileMetricList from "./ProfileMetricList.vue";

describe("ProfileMetricList", () => {
  it("shows a ratio above its total as a percentage without a bar", () => {
    const metrics = [{ name: "avg_fanout", kind: "ratio", value: 50, total: 14 }];
    const w = mount(ProfileMetricList, { props: { metrics, bar: "fraction" } });
    expect(w.text()).toContain("357.14%");
    expect(w.text()).not.toContain("/ 14");
    expect(w.findComponent({ name: "OProgressBar" }).exists()).toBe(false);
  });
});
