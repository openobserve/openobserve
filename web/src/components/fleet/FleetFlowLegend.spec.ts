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
      props: { counts: { info: 2 }, modelValue: null },
      global: { plugins: [i18n] },
    });
    const info = w.find('[data-test="fleet-flow-legend-info"]').text();
    expect(info).toContain("Outdated");
    expect(info).not.toContain("ring");
  });
});
