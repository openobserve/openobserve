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

/**
 * W10's table health columns, rendered through a REAL OTable.
 *
 * Why this spec mounts, when its eight siblings in this directory deliberately
 * do not. Those read the page source because they assert a DECISION the page
 * makes — a default sort, an empty-state branch — and the source is where a
 * decision is legible. This one asserts that the page uses OTable's API
 * CORRECTLY, and a claim about how another component interprets your input
 * cannot be checked by reading your own input. Only the component can answer.
 *
 * It shipped wrong for exactly that reason. `OTableColumnDef.cell` is typed
 * `string | Component` and `useTableCore` wraps it as `() => col.cell`, so a
 * TanStack-style `({ row }) => string` was never invoked — it was returned to
 * FlexRender, which stringified the arrow function into every data cell of
 * every row. Sixteen source-reading assertions and a green formatter suite all
 * held while the page rendered `(( row )) => tableSize…` eight rows deep.
 *
 * The mount is cheap: OTable needs only i18n (its own spec does the same), and
 * this file runs in tens of milliseconds. That was measured before choosing
 * this layer over a source-read.
 *
 * WHAT THIS CATCHES: any column whose value does not reach the DOM as text —
 * a renderer passed under a key OTable ignores, a formatter wired to the wrong
 * field, an accessor naming a key the row does not have.
 *
 * WHAT IT DOES NOT CATCH: a renderer that is invoked and returns the wrong
 * string. `tableSizeLabel` and `formatCount` are pinned by their own unit
 * suites; this file asserts they are REACHED, using values distinctive enough
 * (13.0 MB, 137,268) that a swapped formatter would show up here too.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { config, mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

import i18n from "@/locales";

// OTable's sub-components call `useI18n()`; its own spec installs the same
// minimal instance. Registered globally so every mount in this file gets it.
const testI18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: { noData: "No data available" },
      common: { loading: "Loading..." },
    },
  },
});

beforeAll(() => {
  config.global.plugins.unshift([testI18n as any]);
});

import OTable from "@/lib/core/Table/OTable.vue";
import { tableHealthColumns, tableHealthRows, type TableHealthRow } from "@/utils/dbm/tableHealth";

const t = ((key: string) => i18n.global.t(key)) as any;

/**
 * One relation, with every field populated and each value distinct, so a cell
 * reading the wrong field renders a visibly wrong number rather than a
 * coincidentally right one.
 */
const hit: TableHealthRow = {
  relation: "order_lines",
  schema: "public",
  instance: "pg-primary",
  engine: "postgresql",
  total_bytes: 13_639_680, // 13.0 MB
  heap_bytes: 10_510_336, // 10.0 MB
  live_tuples: 137_268,
  dead_tuples: 4_211,
  dead_tup_pct: 2.98,
  mod_since_analyze: 812,
  seq_scan_count: 91,
  seq_tup_read: 12_480_113,
  idx_scan_count: 604_912,
  autovacuum_count: 37,
  frozen_xid_age: 4_120_998,
  last_vacuum: "2026-08-09 03:11:02",
  last_autovacuum: "2026-08-10 01:44:19",
  last_analyze: "2026-08-10 01:44:20",
  last_seen: 1_754_800_000_000_000,
};

const mountTable = (hits: TableHealthRow[]) =>
  mount(OTable, {
    props: {
      data: tableHealthRows(hits),
      columns: tableHealthColumns(t),
      rowKey: "rowKey",
      pagination: "none",
      sorting: "client",
      showGlobalFilter: false,
      // Every column, including the four the page hides by default — a
      // renderer broken behind a hidden column is still broken.
      columnVisibility: {},
    },
  });

const cellText = (wrapper: ReturnType<typeof mountTable>, columnId: string) =>
  wrapper.find(`[data-test="o2-table-cell-${columnId}"]`).text();

describe("every table-health cell renders its value, not its renderer", () => {
  /**
   * The defect class, stated directly. `Function.prototype.toString` is what
   * put the arrow source on screen, and its two unmistakable fingerprints are
   * `=>` and the parameter list — neither of which any real cell value here
   * contains. Asserted across ALL columns at once so a future column added
   * with the same mistake fails without anyone remembering to extend this
   * file.
   */
  it("never stringifies a renderer into a cell", () => {
    const wrapper = mountTable([hit]);

    for (const column of tableHealthColumns(t)) {
      const text = cellText(wrapper, column.id);
      expect(
        text,
        `column "${column.id}" rendered its cell renderer's source text instead of the value — ` +
          `OTable ignores keys it does not read and FlexRender stringifies whatever it gets back`,
      ).not.toMatch(/=>/);
      expect(text, `column "${column.id}" leaked a function into the DOM`).not.toMatch(
        /\bfunction\b|row\.original/,
      );
    }
  });

  /**
   * Not stringifying a function is necessary but not sufficient: a cell wired
   * to nothing at all renders empty and passes the check above. These pin the
   * three formatters the page depends on actually reaching the DOM, at the
   * exact values the fixture above supplies.
   */
  it("renders byte sizes through the size formatter", () => {
    const wrapper = mountTable([hit]);

    expect(cellText(wrapper, "total_bytes")).toBe("13.0 MB");
    expect(cellText(wrapper, "heap_bytes")).toBe("10.0 MB");
    // total - heap, computed in `tableHealthRows`, not in the template.
    expect(cellText(wrapper, "overheadBytes")).toBe("3.0 MB");
  });

  it("renders counts through the count formatter", () => {
    const wrapper = mountTable([hit]);

    expect(cellText(wrapper, "live_tuples")).toBe("137,268");
    expect(cellText(wrapper, "dead_tuples")).toBe("4,211");
    expect(cellText(wrapper, "seq_scan_count")).toBe("91");
    expect(cellText(wrapper, "seq_tup_read")).toBe("12,480,113");
    expect(cellText(wrapper, "idx_scan_count")).toBe("604,912");
    expect(cellText(wrapper, "autovacuum_count")).toBe("37");
    expect(cellText(wrapper, "mod_since_analyze")).toBe("812");
    expect(cellText(wrapper, "frozen_xid_age")).toBe("4,120,998");
  });

  it("renders the bloat estimate as a percentage", () => {
    const wrapper = mountTable([hit]);

    expect(cellText(wrapper, "dead_tup_pct")).toBe("2.98%");
  });

  it("renders vacuum timestamps, and NEVER for a table nobody has vacuumed", () => {
    const wrapper = mountTable([hit]);

    expect(cellText(wrapper, "last_vacuum")).toBe("2026-08-09 03:11:02");
    expect(cellText(wrapper, "last_autovacuum")).toBe("2026-08-10 01:44:19");
    expect(cellText(wrapper, "last_analyze")).toBe("2026-08-10 01:44:20");

    // `null` here is a measured fact — a table nobody has ever vacuumed — and
    // has to read as "Never" rather than as a blank "we do not know".
    const neverWrapper = mountTable([{ ...hit, last_vacuum: null, last_autovacuum: null }]);
    expect(cellText(neverWrapper, "last_vacuum")).toBe("Never");
    expect(cellText(neverWrapper, "last_autovacuum")).toBe("Never");
  });

  /**
   * The identity columns carry no formatter and so were the one part of the
   * page that rendered correctly while everything else showed source text.
   * Pinned here so a fix that routes every column through a formatter cannot
   * quietly break the two that never needed one.
   */
  it("renders the qualified relation name and instance plainly", () => {
    const wrapper = mountTable([hit]);

    expect(cellText(wrapper, "qualifiedName")).toBe("public.order_lines");
    expect(cellText(wrapper, "instance")).toBe("pg-primary");
  });

  /**
   * A missing measurement is not a zero. The em-dash is the app-wide "we did
   * not measure this", and a formatter that is reached but hands back the raw
   * `null` would render an empty cell that reads as a blank rather than as an
   * absence.
   */
  it("renders an em-dash where the snapshot measured nothing", () => {
    const wrapper = mountTable([
      { ...hit, total_bytes: null, heap_bytes: null, live_tuples: null, dead_tup_pct: null },
    ]);

    expect(cellText(wrapper, "total_bytes")).toBe("—");
    expect(cellText(wrapper, "heap_bytes")).toBe("—");
    // Either input missing means the subtraction was never valid.
    expect(cellText(wrapper, "overheadBytes")).toBe("—");
    expect(cellText(wrapper, "live_tuples")).toBe("—");
    expect(cellText(wrapper, "dead_tup_pct")).toBe("—");
  });
});
