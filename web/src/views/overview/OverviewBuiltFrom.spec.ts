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

import i18n from "@/locales";

import OverviewBuiltFrom from "./OverviewBuiltFrom.vue";

describe("OverviewBuiltFrom", () => {
  it("keeps every View all with its old name and adds +N more degraded", async () => {
    const wrapper = mount(OverviewBuiltFrom, {
      props: { sources: ["incidents", "services", "anomalies", "events"], moreDegraded: 4 },
      global: { plugins: [i18n] },
    });
    const names = wrapper
      .findAll('[data-test^="overview-now-view-all-"]')
      .map((b) => b.attributes("aria-label"));
    expect(names).toEqual([
      "View all incidents",
      "View all services",
      "View all anomalies",
      "View all events",
    ]);
    await wrapper.get('[data-test="overview-now-more-degraded"]').trigger("click");
    await wrapper.get('[data-test="overview-now-view-all-events"]').trigger("click");
    expect(wrapper.get('[data-test="overview-now-more-degraded"]').text()).toBe(
      "+4 more degraded services",
    );
    expect(wrapper.emitted("open")).toEqual([["services"], ["events"]]);
  });

  it("hides +N when nothing more is degraded, and itself with no sources", () => {
    const none = mount(OverviewBuiltFrom, {
      props: { sources: [], moreDegraded: 0 },
      global: { plugins: [i18n] },
    });
    expect(none.find('[data-test="overview-now-built-from"]').exists()).toBe(false);
  });
});
