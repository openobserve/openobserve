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

// Corpus v2 train split (628 rows, hold-out seed 20261119), copied from corpus/corpus.train.json.
import { afterAll, describe, expect, it } from "vitest";

import corpus from "../__fixtures__/corpus.json";
import { DEVIATIONS } from "../__fixtures__/deviations";
import { parseTimeRangeInput } from "../index";
import type { TimeRangeParseResult, TimeRangeReading } from "../types";
import { corpusContext, inputOf, matches, packFor, type CorpusRow, type Span } from "./helpers";

type Verdict = "pass" | "fail" | "wrong";

interface Graded {
  row: CorpusRow;
  verdict: Verdict;
  got: TimeRangeParseResult;
}

const rows = corpus as CorpusRow[];
const deviations = new Map(DEVIATIONS.map((d) => [d.id, d]));

function selectable(result: TimeRangeParseResult): TimeRangeReading[] {
  if (result.state === "valid") return [result.reading];
  if (result.state === "ambiguous") return result.readings.filter((r) => !r.blocked);
  if (result.state === "incomplete") return result.completions;
  if (result.state === "blocked") return [...(result.fix ? [result.fix] : [])];
  return [];
}

function gradeSpans(got: TimeRangeParseResult, spans: Span[], exact: () => boolean): Verdict {
  if (exact()) return "pass";
  const offered =
    got.state === "incomplete"
      ? []
      : selectable(got).filter((r) => r !== (got.state === "blocked" ? got.fix : undefined));
  return offered.some((r) => !spans.some((s) => matches(r, s))) ? "wrong" : "fail";
}

/** pass, fail, or confident wrong (§11.1): a selectable reading that is not an expected one. */
export function grade(row: CorpusRow, got: TimeRangeParseResult): Verdict {
  const deviation = deviations.get(row.id);
  if (deviation) {
    if (got.state === "invalid" && got.reason === deviation.design.reason) return "pass";
    return got.state === "valid" || got.state === "ambiguous" ? "wrong" : "fail";
  }
  const exp = row.expected;
  if (!("state" in exp)) {
    return gradeSpans(got, [exp], () => got.state === "valid" && matches(got.reading, exp));
  }
  if (exp.state === "ambiguous") {
    const ok = () =>
      got.state === "ambiguous" &&
      got.readings.length === exp.readings.length &&
      got.readings.every((r, i) => matches(r, exp.readings[i]));
    if (got.state === "valid") return "wrong";
    return gradeSpans(got, exp.readings, ok);
  }
  if (exp.state === "invalid") {
    if (got.state === "invalid") return "pass";
    return got.state === "valid" || (got.state === "ambiguous" && selectable(got).length > 0)
      ? "wrong"
      : "fail";
  }
  if (exp.state === "incomplete") {
    if (got.state === "incomplete" || (got.state === "empty" && inputOf(row).trim() === ""))
      return "pass";
    return got.state === "valid" || got.state === "ambiguous" ? "wrong" : "fail";
  }
  if (got.state === "valid" || got.state === "ambiguous") return "wrong";
  if (got.state !== "blocked") return "fail";
  if (exp.fix === null ? got.fix !== undefined : !got.fix || !matches(got.fix, exp.fix))
    return "wrong";
  return got.reason === exp.reason && matches(got.reading, exp.reading) ? "pass" : "fail";
}

function groupOf(row: CorpusRow): string {
  if (row.id.startsWith("und-")) return "und";
  if (row.id.startsWith("reg-")) return "reg";
  return row.locale;
}

const graded: Graded[] = [];

describe("time range corpus (train split)", () => {
  for (const row of rows) {
    it(`${row.id} ${JSON.stringify(inputOf(row)).slice(0, 60)}`, async () => {
      const pack = await packFor(row.locale);
      const nav = row.browser_locale ?? row.locale;
      Object.defineProperty(globalThis.navigator, "language", { value: nav, configurable: true });
      const got = parseTimeRangeInput(corpusContext(row, pack));
      const verdict = grade(row, got);
      graded.push({ row, verdict, got });
      if (!row.uncertain) expect(verdict, JSON.stringify(got).slice(0, 600)).not.toBe("wrong");
    });
  }

  afterAll(() => {
    const groups = new Map<string, Graded[]>();
    for (const g of graded) groups.set(groupOf(g.row), [...(groups.get(groupOf(g.row)) ?? []), g]);
    const lines = ["group     rows  pass  fail  wrong  uncertain  rate"];
    for (const [group, list] of [...groups.entries()].sort()) {
      const certain = list.filter((g) => !g.row.uncertain);
      const pass = certain.filter((g) => g.verdict === "pass").length;
      const fail = certain.filter((g) => g.verdict === "fail").length;
      const wrong = certain.filter((g) => g.verdict === "wrong").length;
      const rate = certain.length ? pass / certain.length : 1;
      lines.push(
        `${group.padEnd(9)} ${String(list.length).padStart(4)} ${String(pass).padStart(5)} ${String(fail).padStart(5)} ${String(wrong).padStart(6)} ${String(list.length - certain.length).padStart(10)}  ${(rate * 100).toFixed(1)}%`,
      );
    }
    const misses = graded.filter((g) => g.verdict !== "pass");
    for (const g of misses) {
      lines.push(
        `${g.verdict.padEnd(5)} ${g.row.uncertain ? "(unc) " : ""}${g.row.id} ${JSON.stringify(inputOf(g.row)).slice(0, 50)} -> ${JSON.stringify(g.got).slice(0, 160)}`,
      );
    }
    process.stdout.write(`${lines.join("\n")}\n`);
  });

  it("has no failing certain row in any group", () => {
    expect(graded.length).toBe(rows.length);
    const groups = new Map<string, Graded[]>();
    for (const g of graded) groups.set(groupOf(g.row), [...(groups.get(groupOf(g.row)) ?? []), g]);
    for (const [group, list] of groups) {
      const failed = list
        .filter((g) => !g.row.uncertain && g.verdict !== "pass")
        .map((g) => g.row.id);
      expect(failed, `${group}: certain rows that fail`).toEqual([]);
    }
  });
});
