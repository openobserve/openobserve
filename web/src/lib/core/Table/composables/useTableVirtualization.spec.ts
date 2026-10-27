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
import { effectScope, ref } from "vue";
import type { Row } from "@tanstack/vue-table";
import { useTableVirtualization } from "./useTableVirtualization";

describe("useTableVirtualization", () => {
  // An empty window makes OTableBody render every row, then swap them for the window.
  it("gives a window of rows before the scroll element is measured", () => {
    const rows = ref(
      Array.from({ length: 500 }, (_, index) => ({ index, original: {} }) as Row<any>),
    );
    const scope = effectScope();
    const virtualization = scope.run(() =>
      useTableVirtualization({ rows, parentRef: ref(null), rowHeight: 28, overscan: 5 }),
    )!;

    const count = virtualization.virtualRows.value.length;
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(Math.ceil(window.innerHeight / 28) + 10);
    scope.stop();
  });

  describe("measuring a row with its expanded detail", () => {
    const rowWithDetail = () => {
      const body = document.createElement("tbody");
      const row = document.createElement("tr");
      row.setAttribute("data-index", "0");
      row.getBoundingClientRect = () => ({ height: 22 }) as DOMRect;
      const detail = document.createElement("tr");
      detail.setAttribute("data-row-expansion", "");
      detail.getBoundingClientRect = () => ({ height: 140 }) as DOMRect;
      body.append(row, detail);
      return row;
    };
    const measureWith = (includeExpansionRow: boolean) => {
      const rows = ref([{ index: 0, original: {} }] as Row<any>[]);
      const scope = effectScope();
      const virtualization = scope.run(() =>
        useTableVirtualization({
          rows,
          parentRef: ref(null),
          rowHeight: 22,
          dynamicRowHeight: true,
          includeExpansionRow,
        }),
      )!;
      const size = virtualization.rowVirtualizer.value.options.measureElement!(
        rowWithDetail(),
        undefined,
        virtualization.rowVirtualizer.value,
      );
      scope.stop();
      return size;
    };

    it("adds the detail row's height when asked", () => {
      expect(measureWith(true)).toBe(162);
    });

    it("measures the data row alone otherwise", () => {
      expect(measureWith(false)).toBe(22);
    });
  });
});
