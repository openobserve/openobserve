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
import { gt, raw, type TranslateFn } from "@/types/i18n";
import type { CoverageRow } from "../aoTypes";
import { coverageStateSentence, coverageVerdict } from "./LiveCoverageSentence";

const totals = (fullyWatched: number, partial: number, gaps: number, learning = 0) => ({
  total: fullyWatched + partial + gaps + learning,
  learning,
  fullyWatched,
  partial,
  gaps,
});
const say = (t: ReturnType<typeof totals>) => String(coverageStateSentence(gt, "en-US", t));

describe("coverageStateSentence", () => {
  it("keeps today's sentence when no service is partly watched", () => {
    expect(say(totals(3, 0, 1))).not.toContain("partly");
    expect(say(totals(3, 0, 1))).toContain("3 of your 4 services");
  });

  it("counts every listed service, as the header does, and names learning ones apart", () => {
    expect(say(totals(2, 20, 2, 6))).toBe(
      "I'm fully watching 2 of your 30 services. 20 are partly watched: some of their checks have no alert. 2 have a coverage gap. 6 are still learning.",
    );
    expect(say(totals(3, 0, 0, 1))).toBe(
      "I'm fully watching 3 of your 4 services. 1 is still learning.",
    );
  });

  it("drops the gap part at zero and reads one service in the singular", () => {
    expect(say(totals(0, 1, 0))).toBe(
      "I'm fully watching 0 of your 1 service. 1 is partly watched: some of its checks have no alert.",
    );
  });

  it("formats large counts for the locale", () => {
    expect(say(totals(1200, 3400, 0))).toContain("1,200 of your 4,600 services");
  });
});

const svc = (service: string, state: string, traffic: number | null, where = "—") =>
  ({ service, traffic, where, status: { state } }) as unknown as CoverageRow;
const gaps = (traffic: (number | null)[]) => traffic.map((v, i) => svc(`s${i}`, "gap", v));
// Keys and values, not English: the wording may change, what the verdict states may not.
const keyT = ((key: string, params: Record<string, unknown> = {}) => {
  const values = Object.values(params);
  return raw(`${key.split(".").pop()}${values.length ? `(${values.join("; ")})` : ""}`);
}) as unknown as TranslateFn;
const verdict = (rows: CoverageRow[]) => {
  const v = coverageVerdict(keyT, "en-US", rows);
  return v && [String(v.text), String(v.sub), v.gaps.map((r) => r.service).join(",")];
};

describe("coverageVerdict (0, 1, a few, many)", () => {
  it.each([
    ["no services yet: no verdict", [], null],
    ["every service watched", [svc("a", "watched", 9)], ["allWatched(1)", "allWatchedSub", ""]],
    ["no gap but some partly watched: the state sentence stays", [svc("a", "partial", 9)], null],
    [
      "one gap, named with its place, the rest watched",
      [svc("shipping", "gap", 5, "prod · default"), svc("b", "watched", 9)],
      ["oneWhere(shipping; prod · default)", "others(1)", "shipping"],
    ],
    [
      "one gap beside a learning service: learning is not watched",
      [svc("shipping", "gap", 5), svc("b", "learning", 9)],
      ["one(shipping)", "learning(1)", "shipping"],
    ],
    [
      "a few, busiest first, named",
      [...gaps([1, 3, null, 2]), svc("p", "partial", 1)],
      ["named(4; s1, s3, s0, and moreNames(1))", "partly(1) unknown(1)", "s1,s3,s0,s2"],
    ],
    [
      "many, the busiest ten and their share of the gaps' traffic, not of watched services'",
      [...gaps([...Array(10).fill(3), ...Array(20).fill(1)]), svc("w", "watched", 10_000)],
      [
        "share(30; 10; 60%)",
        "",
        gaps(Array(30).fill(0))
          .map((r) => r.service)
          .join(","),
      ],
    ],
  ])("%s", (_case, rows, expected) => {
    expect(verdict(rows as CoverageRow[])).toEqual(expected);
  });

  it("never says a gap service has no alert: one may exist and miss every check", () => {
    for (const rows of [gaps([1]), gaps([1, 2]), gaps(Array(30).fill(1))])
      expect(String(coverageVerdict(gt, "en-US", rows)?.text)).not.toMatch(/no alert/);
  });
});
