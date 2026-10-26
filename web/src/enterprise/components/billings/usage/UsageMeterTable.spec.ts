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
import store from "@/test/unit/helpers/store";
import { raw } from "@/types/i18n";
import UsageMeterTable from "./UsageMeterTable.vue";

describe("UsageMeterTable", () => {
  it("renders the totals row under the meters", () => {
    const row = {
      key: "ingestion",
      label: raw("Ingestion"),
      volume: raw("1 GB"),
      rate: raw("$0.50 / GB"),
      cost: 9,
      gross: 10,
      discount: 1,
      missing: false,
      discountPercent: 10,
      drillable: true,
      hasBreakdown: true,
    };
    const wrapper = mount(UsageMeterTable, {
      props: { rows: [row], total: 9, gross: 10, discount: 1 },
      global: { plugins: [i18n, store] },
    });

    // OTable drops a slot it no longer has without a sound, so check the row is really drawn.
    const totals = wrapper.find('[data-test="billings-usagemetertable-total"]');
    expect(totals.exists()).toBe(true);
    expect(totals.text()).toContain("$9.00");
    wrapper.unmount();
  });

  it("shows only each meter's volume for an org with no bill, with no totals across units", () => {
    const row = {
      key: "ingestion",
      label: raw("Ingestion"),
      volume: raw("2.00 GB"),
      rate: raw("$0.00 / GB"),
      cost: 0,
      gross: 0,
      discount: 0,
      missing: false,
      discountPercent: 0,
      drillable: true,
      hasBreakdown: true,
    };
    const wrapper = mount(UsageMeterTable, {
      props: { rows: [row], total: 0, gross: 0, discount: 0, volumeOnly: true },
      global: { plugins: [i18n, store] },
    });

    expect(wrapper.text()).toContain("2.00 GB");
    expect(wrapper.text()).not.toContain("$");
    expect(wrapper.find('[data-test="billings-usagemetertable-total"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
