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
 * The SUMMARY TILE STRIP and the D6 rule it was the last surface to learn.
 *
 * The defect, confirmed live and user-visible: on org `dbm_notraces` — a
 * server-vantage-only fleet — at the UI's default 1h window, where the trace
 * vantage measured NOTHING, the strip printed `0us client-observed` for
 * Database time, `0` for Kinds of query, and `0 client-observed` for Calls.
 * A QUALIFIED zero asserts "your instrumented callers observed zero database
 * time", which is an all-clear over a vantage that took no measurement — and
 * it sat inches from a server section reporting real traffic.
 *
 * This is the same defect removed twice before: from QueryDetail's headline
 * tiles (the `?? 0` fabrication) and from the tab badges (`overlapClaim`
 * withholding a zero rather than qualifying it). Each render site had
 * re-implemented the absent-vs-zero decision, so the decision now lives in
 * ONE place — `overlapTile` in utils/dbm/format.ts — and this file pins what
 * the strip does with it.
 *
 * Rendered through the REAL OStatStrip/OStatCard, not asserted on the
 * `StatItem[]`: "absent renders as an em dash" is a claim about the DOM the
 * reader sees, and OStatCard is where `null` becomes `—`. The page-wiring half
 * (that each page passes the right population signal) is pinned by source-read
 * in dbmListOverlapVantage.spec.ts, for the reason that file gives.
 *
 * Fixtures are LIVE payload shapes, captured from the running backend:
 *   • `dbm_notraces` @ 1h  — /queries `{"hits":[],"other":[],"total":0}`,
 *     /server_queries `{"hits":[],"total":0}`, /activity `by_state: []`,
 *     `by_wait_event: []`, `not_collecting: false`. Everything ABSENT.
 *   • `dbm_notraces` @ 2d  — /server_queries 50 rows, `truncated: true`,
 *     top row `calls: 1117188`. /activity `by_state` 6 buckets.
 *   • `default` @ 2d       — /queries 53 trace rows, first `calls: 167430`,
 *     `total_time_ns: 28119997249111`.
 */

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import i18n from "@/locales";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import { formatCount, formatNs, overlapTile } from "@/utils/dbm/format";
import { raw } from "@/types/i18n";

const strip = (items: StatItem[]) =>
  mount(OStatStrip, { props: { items }, global: { plugins: [i18n] } });

/** The value text of one tile, as rendered. */
const valueOf = (items: StatItem[], dataTest: string): string => {
  const card = strip(items).get(`[data-test="${dataTest}"]`);
  return card.get("span").text().trim();
};

/** Whether a tile rendered a qualifier (`sub`) beside its value. */
const hasQualifier = (items: StatItem[], dataTest: string): boolean => {
  const card = strip(items).get(`[data-test="${dataTest}"]`);
  // The qualifier is the last of the label-row spans; its absence is the
  // absence of any span carrying the vantage words.
  return /client-observed|wait time|execution time|reported by/i.test(card.text());
};

/**
 * Exactly the tile QueriesPage builds for an overlap measure, so the spec
 * exercises the page's own composition rather than a paraphrase of it.
 */
const overlapStat = (
  key: string,
  total: number | null,
  measured: boolean,
  format: (value: number) => string,
  qualifier: string,
): StatItem => {
  const tile = overlapTile(total, measured, format);
  return {
    key,
    label: raw(key),
    value: tile.value ?? raw("—"),
    ...(tile.qualified ? { sub: raw(qualifier) } : {}),
    dataTest: `dbm-queries-summary-${key}`,
  };
};

describe("the summary tile strip — absent is withheld, measured zero still prints", () => {
  describe("org dbm_notraces @ 1h — the trace vantage measured nothing", () => {
    /**
     * THE reported defect. `[].reduce((a, r) => a + r.total_time_ns, 0)` is 0,
     * and the strip formatted that 0 through `formatNs` into `0us` and stamped
     * a vantage on it.
     */
    it("withholds Database time instead of printing `0us client-observed`", () => {
      const items = [overlapStat("time", 0, false, formatNs, "client-observed")];
      expect(valueOf(items, "dbm-queries-summary-time")).toBe("—");
      expect(valueOf(items, "dbm-queries-summary-time")).not.toContain("0us");
    });

    it("withholds Calls instead of printing `0 client-observed`", () => {
      const items = [overlapStat("calls", 0, false, formatCount, "client-observed")];
      expect(valueOf(items, "dbm-queries-summary-calls")).toBe("—");
    });

    /**
     * D2 is not satisfied by dropping the number and keeping the word. A bare
     * "client-observed" under an empty tile still asserts a vantage spoke.
     */
    it("drops the vantage qualifier along with the withheld value", () => {
      const items = [
        overlapStat("time", 0, false, formatNs, "client-observed"),
        overlapStat("calls", 0, false, formatCount, "client-observed"),
      ];
      expect(hasQualifier(items, "dbm-queries-summary-time")).toBe(false);
      expect(hasQualifier(items, "dbm-queries-summary-calls")).toBe(false);
    });
  });

  describe("a GENUINE measured zero — the inverse defect", () => {
    /**
     * The crux. A real 0 IS the population, and hiding it would be its own
     * lie: deadlocks that genuinely had none in the window must read `0`, not
     * `—`, or the page stops distinguishing "none happened" from "nobody
     * looked".
     */
    it("prints a measured zero, with its qualifier intact", () => {
      const items = [overlapStat("calls", 0, true, formatCount, "client-observed")];
      expect(valueOf(items, "dbm-queries-summary-calls")).toBe("0");
      expect(hasQualifier(items, "dbm-queries-summary-calls")).toBe(true);
    });

    it("prints a measured zero duration as 0us rather than a dash", () => {
      const items = [overlapStat("time", 0, true, formatNs, "client-observed")];
      expect(valueOf(items, "dbm-queries-summary-time")).toBe("0us");
    });

    /** A single-vantage count (deadlocks) is never an overlap measure. */
    it("keeps a plain measured zero on a non-overlap tile", () => {
      const items: StatItem[] = [
        { key: "deadlocks", label: raw("Deadlocks"), value: 0, dataTest: "dbm-deadlocks-summary" },
      ];
      expect(valueOf(items, "dbm-deadlocks-summary")).toBe("0");
    });
  });

  describe("org dbm_notraces @ 2d — server data present", () => {
    /**
     * Never hide a real count. A prior fix nearly suppressed exactly this
     * figure — the genuine server count behind the fallback list.
     */
    it("renders the server call count and qualifies it as the engine's own", () => {
      const items = [overlapStat("calls", 1_117_188, true, formatCount, "reported by postgresql")];
      expect(valueOf(items, "dbm-queries-summary-calls")).toBe("1,117,188");
      expect(hasQualifier(items, "dbm-queries-summary-calls")).toBe(true);
    });

    it("renders the fallback list's row count", () => {
      const items: StatItem[] = [
        {
          key: "queries",
          label: raw("Queries"),
          value: 50,
          dataTest: "dbm-queries-summary-queries",
        },
      ];
      expect(valueOf(items, "dbm-queries-summary-queries")).toBe("50");
    });
  });

  describe("org default @ 2d — trace values present, D2 qualifiers intact", () => {
    it("renders the traced total time under its client-observed qualifier", () => {
      const items = [
        overlapStat("time", 28_119_997_249_111, true, formatNs, "client-observed"),
        overlapStat("calls", 167_430, true, formatCount, "client-observed"),
      ];
      expect(valueOf(items, "dbm-queries-summary-time")).toBe("7.81h");
      expect(valueOf(items, "dbm-queries-summary-calls")).toBe("167,430");
      expect(hasQualifier(items, "dbm-queries-summary-time")).toBe(true);
      expect(hasQualifier(items, "dbm-queries-summary-calls")).toBe(true);
    });
  });
});
