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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import OStatCard from "./OStatCard.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { raw } from "@/types/i18n";

let wrapper: VueWrapper<any> | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe("fixed-width digits", () => {
  it("sets a stat card value in tabular figures", () => {
    wrapper = mount(OStatCard, { props: { label: raw("Errors"), value: 1204 } });
    const value = wrapper.findAll("span").find((span) => span.text() === "1204");
    expect(value?.classes()).toContain("tabular-nums");
  });

  it("sets end-aligned table cells in tabular figures and leaves the others proportional", () => {
    interface Row {
      name: string;
      count: number;
    }
    const columns: OTableColumnDef<Row>[] = [
      { id: "name", header: "Name", accessorKey: "name" },
      { id: "count", header: "Count", accessorKey: "count", meta: { align: "right" } },
    ];
    wrapper = mount(OTable as any, {
      props: { data: [{ name: "api", count: 1111 }], columns },
    });
    expect(wrapper.find('[data-test="o2-table-cell-count"]').classes()).toContain("tabular-nums");
    expect(wrapper.find('[data-test="o2-table-cell-name"]').classes()).not.toContain(
      "tabular-nums",
    );
  });
});
