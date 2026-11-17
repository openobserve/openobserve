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
import { gt } from "@/types/i18n";
import { headroomEditedLine, headroomSentence, parseHeadroom, type Headroom } from "./headroom";

const BASE = {
  value: 42,
  threshold: 100,
  operator: ">=",
  level: "critical",
  lower_bound: false,
  valued: 720,
};
const read = (overrides: Record<string, unknown> = {}): Headroom => {
  const parsed = parseHeadroom(JSON.stringify({ headroom: { ...BASE, ...overrides } }));
  if (!parsed) throw new Error("the fixture must parse");
  return parsed;
};
const long = (headroom: Headroom, sentinel = false) =>
  headroomSentence(gt, headroom, { form: "long", days: 30, sentinel });
const short = (headroom: Headroom) => headroomSentence(gt, headroom, { form: "short" });

describe("headroom_sentence_covers_each_shape_once", () => {
  it("says each shape of the card in one sentence, and the edit on its own line", () => {
    expect(long(read())).toBe(
      "Hasn't fired in the last 30 days. Its highest value was 42, against a threshold of 100.",
    );
    expect(long(read({ operator: "<", value: 12, threshold: 5 }))).toBe(
      "Hasn't fired in the last 30 days. Its lowest value was 12, against a threshold of 5.",
    );
    expect(long(read({ value: 1000, lower_bound: true }))).toBe(
      "Hasn't fired in the last 30 days. Its highest value was at least 1,000, against a threshold of 100.",
    );
    expect(long(read({ level: "warning", threshold: 80 }))).toBe(
      "Hasn't fired in the last 30 days. Its highest value was 42, against its warning threshold of 80.",
    );
    expect(long(read({ value: 0, threshold: 1 }), true)).toBe(
      "Quiet by design: its value stayed at 0, against a threshold of 1.",
    );
    expect(headroomSentence(gt, read(), { form: "long", days: 1 })).toBe(
      "Hasn't fired in the last day. Its highest value was 42, against a threshold of 100.",
    );
    expect(headroomEditedLine(gt, read({ last_edit_micros: 1_762_000_000_000_000 }))).toBe(
      "It was edited in this period, so earlier values are compared with the current threshold.",
    );
    expect(headroomEditedLine(gt, read())).toBeNull();
  });

  it("gives the skip list a short line naming the threshold that fires first", () => {
    expect(short(read())).toBe("Highest value 42 of threshold 100");
    expect(short(read({ operator: "<=", value: 12, threshold: 5 }))).toBe(
      "Lowest value 12, threshold 5",
    );
    expect(short(read({ level: "warning", threshold: 80 }))).toBe(
      "Highest value 42 of warning threshold 80",
    );
    expect(short(read({ value: 1000, lower_bound: true }))).toBe(
      "Highest value at least 1,000 of threshold 100",
    );
  });

  it("reads nothing it cannot name, so no stored text reaches the screen", () => {
    for (const detail of [
      JSON.stringify({ headroom: { ...BASE, operator: "=" } }),
      JSON.stringify({ headroom: { ...BASE, level: "info" } }),
      JSON.stringify({ headroom: { ...BASE, value: "42" } }),
      JSON.stringify({ headroom: { ...BASE, threshold: null } }),
      JSON.stringify({ headroom: null }),
      JSON.stringify({ signal: "firings" }),
      "{not json",
      "",
      undefined,
    ]) {
      expect(parseHeadroom(detail)).toBeNull();
    }
    const unknown = { ...read(), operator: "!=" } as unknown as Headroom;
    expect(headroomSentence(gt, unknown, { form: "long", days: 30 })).toBeNull();
    expect(headroomSentence(gt, unknown, { form: "short" })).toBeNull();
  });
});
