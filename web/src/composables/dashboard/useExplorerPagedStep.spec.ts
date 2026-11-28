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
import { ref } from "vue";
import { useExplorerPagedStep } from "./useExplorerPagedStep";

// Pages of two items each; `pages` lists what each page holds.
const setup = (pages: string[][], nextPageExists: () => boolean) => {
  const page = ref(0);
  const items = ref<string[]>(pages[0]);
  const open = ref<string | null>(null);
  const loads: number[] = [];
  const stepper = useExplorerPagedStep({
    items: () => items.value,
    index: () => (open.value ? items.value.indexOf(open.value) : -1),
    page: () => page.value,
    nextPageExists,
    loadPage: async (p) => {
      loads.push(p);
      page.value = p;
      items.value = pages[p] ?? [];
    },
    open: (item) => (open.value = item),
  });
  return { page, items, open, loads, ...stepper };
};

describe("useExplorerPagedStep", () => {
  it("steps within a page, then across its edges both ways", async () => {
    const s = setup(
      [
        ["a", "b"],
        ["c", "d"],
      ],
      () => true,
    );
    s.open.value = "a";
    await s.step(1);
    expect(s.open.value).toBe("b");
    await s.step(1);
    expect([s.page.value, s.open.value]).toEqual([1, "c"]);
    await s.step(-1);
    expect([s.page.value, s.open.value]).toEqual([0, "b"]);
  });

  it("is disabled only at the true first and last item", () => {
    const s = setup([["a", "b"]], () => false);
    s.open.value = "a";
    expect([s.hasPrev.value, s.hasNext.value]).toEqual([false, true]);
    s.open.value = "b";
    expect(s.hasNext.value).toBe(false);
  });

  it("an empty next page (no known total) comes back to the last item", async () => {
    const s = setup([["a", "b"], []], () => true);
    s.open.value = "b";
    await s.step(1);
    expect(s.loads).toEqual([1, 0]);
    expect([s.page.value, s.open.value]).toEqual([0, "b"]);
  });
});
