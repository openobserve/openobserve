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

import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import TimeRangeGuardStrip from "./TimeRangeGuardStrip.vue";
import type { TimeRangeGuard } from "@/composables/useTimeRangeHost";

vi.mock("vuex", () => ({ useStore: () => ({ state: { timezone: "UTC" } }) }));

const guard = (panels: number): TimeRangeGuard => ({
  from: { kind: "rolling", span: "7d" },
  to: { kind: "rolling", span: "90d" },
  days: 30,
  panels,
});

const mountStrip = (value: TimeRangeGuard | null) =>
  mount(TimeRangeGuardStrip, {
    props: { guard: value, dataTest: "guard" },
    global: { plugins: [i18n], stubs: { OShortcut: true } },
  });

describe("TimeRangeGuardStrip", () => {
  it("renders nothing while no range is held", () => {
    expect(mountStrip(null).find('[data-test="guard"]').exists()).toBe(false);
  });

  it("names the range on screen, the held one and the guard", () => {
    const text = mountStrip(guard(0)).get('[data-test="guard"]').text();
    expect(text).toContain("Showing Last 7 days. Last 90 days is over the 30-day guard.");
    expect(text).toContain("Back to Last 7 days");
  });

  it("runs the query on a page without panels and on N panels on a dashboard", () => {
    expect(mountStrip(guard(0)).get('[data-test="guard-run"]').text()).toBe("Run query");
    expect(mountStrip(guard(6)).get('[data-test="guard-run"]').text()).toBe("Run on 6 panels");
  });

  it("emits run and back", async () => {
    const wrapper = mountStrip(guard(0));
    await wrapper.get('[data-test="guard-run"]').trigger("click");
    await wrapper.get('[data-test="guard-back"]').trigger("click");
    expect(wrapper.emitted("run")).toHaveLength(1);
    expect(wrapper.emitted("back")).toHaveLength(1);
  });
});
