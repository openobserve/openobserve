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

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import FleetFlowLegend from "./FleetFlowLegend.vue";

describe("FleetFlowLegend", () => {
  it("labels the info severity as outdated, since v1 has no release rings", () => {
    const w = mount(FleetFlowLegend, {
      props: { counts: { info: 2 }, modelValue: [] },
      global: { plugins: [i18n] },
    });
    const info = w.find('[data-test="fleet-flow-legend-info"]').text();
    expect(info).toContain("Outdated");
    expect(info).not.toContain("ring");
  });

  it("shows the pipeline count per level, zero for a missing one, restricted only when present", () => {
    const w = mount(FleetFlowLegend, {
      props: { counts: { error: 1, healthy: 3 }, modelValue: [] },
      global: { plugins: [i18n] },
    });
    expect(w.find('[data-test="fleet-flow-legend-error"]').text()).toContain("1");
    expect(w.find('[data-test="fleet-flow-legend-healthy"]').text()).toContain("3");
    expect(w.find('[data-test="fleet-flow-legend-warning"]').text()).toContain("0");
    expect(w.find('[data-test="fleet-flow-legend-restricted"]').exists()).toBe(false);
  });

  it("leads with Healthy in green, then Rolling out in blue", () => {
    const w = mount(FleetFlowLegend, {
      props: { counts: { healthy: 1, progress: 1 }, modelValue: [] },
      global: { plugins: [i18n] },
    });
    const keys = w
      .findAll('[data-test^="fleet-flow-legend-"]')
      .map((el) => el.attributes("data-test")?.replace("fleet-flow-legend-", ""));
    expect(keys).toEqual(["healthy", "progress", "error", "warning", "info"]);
    expect(w.find('[data-test="fleet-flow-legend-healthy"] .bg-status-success-text').exists()).toBe(
      true,
    );
    expect(w.find('[data-test="fleet-flow-legend-progress"] .bg-status-info-text').exists()).toBe(
      true,
    );
  });

  it("hides and shows levels one by one; a hidden or empty level reads muted", async () => {
    const w = mount(FleetFlowLegend, {
      props: { counts: { error: 1, healthy: 2 }, modelValue: [] },
      global: { plugins: [i18n] },
    });
    expect(w.find('[data-test="fleet-flow-legend-warning"]').classes()).toContain(
      "text-text-muted",
    );
    expect(w.find('[data-test="fleet-flow-legend-error"]').classes()).not.toContain(
      "text-text-muted",
    );
    await w.find('[data-test="fleet-flow-legend-error"]').trigger("click");
    expect(w.emitted("update:modelValue")?.[0]).toEqual([["error"]]);
    await w.setProps({ modelValue: ["error"] });
    expect(w.find('[data-test="fleet-flow-legend-error"]').classes()).toContain("text-text-muted");
    await w.find('[data-test="fleet-flow-legend-healthy"]').trigger("click");
    expect(w.emitted("update:modelValue")?.[1]).toEqual([["error", "healthy"]]);
    await w.setProps({ modelValue: ["error", "healthy"] });
    await w.find('[data-test="fleet-flow-legend-error"]').trigger("click");
    expect(w.emitted("update:modelValue")?.[2]).toEqual([["healthy"]]);
  });
});
