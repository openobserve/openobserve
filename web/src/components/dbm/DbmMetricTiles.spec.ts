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

import { raw } from "@/types/i18n";

import DbmMetricTiles, { type DbmMetricTile } from "./DbmMetricTiles.vue";

const items: DbmMetricTile[] = [
  {
    id: "p95",
    label: raw("Slow calls"),
    sub: raw("p95"),
    value: raw("1.2 s"),
    detail: raw("2× more"),
    tone: "",
  },
  { id: "errors", label: raw("Failures"), value: raw("None"), detail: raw("exact"), tone: "" },
];

const mountTiles = (props: Record<string, unknown> = {}) =>
  mount(DbmMetricTiles, { props: { items, tileDataTest: "dbm-detail-stat", ...props } });

describe("DbmMetricTiles", () => {
  /**
   * One tile shell for both vantages. The client block and the database's own
   * counters have to be comparable at a glance — a reader who re-learns the
   * layout between them will read one for the other — so the tile's padding,
   * label weight and figure type are pinned, not left to each caller.
   */
  it("draws every item as a bordered tile", () => {
    const tiles = mountTiles({ withSubLabels: true }).findAll(
      '[data-test^="dbm-detail-stat-"]:not([data-test$="-sub"])',
    );

    expect(tiles).toHaveLength(2);
    expect(tiles[0].classes()).toEqual(
      expect.arrayContaining([
        "border-border-subtle",
        "border-r",
        "border-b",
        "px-3",
        "py-2",
        "last:border-r-0",
      ]),
    );
    expect(tiles[0].attributes("data-test")).toBe("dbm-detail-stat-p95");
    expect(tiles[1].attributes("data-test")).toBe("dbm-detail-stat-errors");
  });

  it("renders the label, the figure and the caption", () => {
    const tile = mountTiles({ withSubLabels: true }).get('[data-test="dbm-detail-stat-p95"]');

    expect(tile.text()).toContain("Slow calls");
    expect(tile.text()).toContain("1.2 s");
    expect(tile.text()).toContain("2× more");
    expect(tile.get(".font-mono").classes()).toEqual(
      expect.arrayContaining(["text-text-heading", "text-lg", "font-semibold", "tabular-nums"]),
    );
  });

  /**
   * The sub-label is the formal name the plain-English label stands for. It is
   * optional PER TILE — "Slow calls (p95)" earns one, "Failures" does not —
   * so a missing sub must not leave an empty span behind it.
   */
  it("shows a sub-label only where the figure has a formal name", () => {
    const wrapper = mountTiles({ withSubLabels: true });

    expect(wrapper.get('[data-test="dbm-detail-stat-p95"]').text()).toContain("p95");
    expect(
      wrapper.get('[data-test="dbm-detail-stat-errors"]').find(".text-text-muted").exists(),
    ).toBe(false);
  });

  /**
   * The server counters are exact and carry no caption, so the grid that shows
   * them pays for neither the sub-label row nor the caption line.
   */
  it("drops the sub-label row and the caption when the grid has neither", () => {
    const wrapper = mountTiles({ withSubLabels: false });
    const tile = wrapper.get('[data-test="dbm-detail-stat-p95"]');

    expect(tile.find(".flex.items-baseline").exists()).toBe(false);
    expect(tile.text()).not.toContain("p95");
    expect(tile.text()).not.toContain("2× more");
    expect(tile.get("div").classes()).toEqual(
      expect.arrayContaining(["text-text-label", "text-3xs", "font-semibold", "uppercase"]),
    );
  });

  /**
   * A tone is applied only where the page's own threshold fired — reddening on
   * any error at all would make one failure in a million read as loudly as an
   * outage, so the tile takes the class the caller resolved and adds none.
   */
  it("applies the tone the caller resolved", () => {
    const toned = mountTiles({
      items: [{ ...items[1], tone: "text-status-error-text" }],
      withSubLabels: true,
    });
    expect(toned.get(".font-mono").classes()).toContain("text-status-error-text");
  });

  /**
   * Two containers, one tile. `standalone` is a card in its own right;
   * `attached` sits under a section heading and carries only the rule dividing
   * it from that heading — a full border there would double the section's.
   */
  it("rounds and borders a standalone grid, and only rules an attached one", () => {
    expect(mountTiles({ variant: "standalone" }).classes()).toEqual(
      expect.arrayContaining(["rounded-surface", "border", "grid", "overflow-hidden"]),
    );

    const attached = mountTiles({ variant: "attached" });
    expect(attached.classes()).toContain("border-t");
    expect(attached.classes()).not.toContain("rounded-surface");
    expect(attached.classes()).not.toContain("border");
  });

  /** Six across on a wide screen, two on a phone — the same at both vantages. */
  it("keeps the same breakpoints for both grids", () => {
    for (const variant of ["standalone", "attached"] as const) {
      expect(mountTiles({ variant }).classes()).toEqual(
        expect.arrayContaining(["grid-cols-2", "md:grid-cols-3", "xl:grid-cols-6"]),
      );
    }
  });
});
