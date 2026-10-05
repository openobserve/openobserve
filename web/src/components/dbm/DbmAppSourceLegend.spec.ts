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
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import DbmAppSourceLegend from "./DbmAppSourceLegend.vue";

const mountLegend = (props: Record<string, unknown> = {}) =>
  mount(DbmAppSourceLegend, { props, global: { plugins: [i18n] } });

describe("DbmAppSourceLegend", () => {
  it("names the marker beside its icon", () => {
    expect(mountLegend().find('[data-test="dbm-app-source-legend-text"]').exists()).toBe(true);
  });

  it("keeps only the icon when compact, with the explanation still in the tooltip", () => {
    const wrapper = mountLegend({ compact: true });
    expect(wrapper.find('[data-test="dbm-app-source-legend-text"]').exists()).toBe(false);
    expect(wrapper.findComponent(OTooltip).props("content")).toBeTruthy();
  });
});
