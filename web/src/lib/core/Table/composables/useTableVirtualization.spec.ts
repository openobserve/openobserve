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
});
