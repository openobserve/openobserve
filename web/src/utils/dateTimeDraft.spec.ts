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
import {
  draftFromRange,
  edgeInstant,
  emptyFieldStatus,
  endInstantUs,
  sameDraft,
  validateDraft,
  type DraftFieldStatus,
  type RangeDraft,
} from "./dateTimeDraft";

const IST = "Asia/Calcutta";
const NY = "America/New_York";
const us = (iso: string) => Date.parse(iso) * 1000;
const VALID: DraftFieldStatus = {
  startDate: "valid",
  startTime: "valid",
  endDate: "valid",
  endTime: "valid",
};
const draft = (start: [string, string], end: [string, string]): RangeDraft => ({
  start: { date: start[0], time: start[1], offset: "" },
  end: { date: end[0], time: end[1], offset: "" },
});

describe("dateTimeDraft", () => {
  it("sends an End of 23:59:59 as the next midnight in the picker zone", () => {
    expect(endInstantUs({ date: "2026-11-05", time: "23:59:59", offset: "" }, IST)).toBe(
      1793903400000000,
    );
    expect(endInstantUs({ date: "2026-11-05", time: "14:02:03", offset: "" }, IST)).toBe(
      us("2026-11-05T14:02:03+05:30"),
    );
  });

  it("seeds an exclusive midnight end as the previous day's 23:59:59", () => {
    expect(draftFromRange(us("2026-11-05T00:00:00+05:30"), 1793903400000000, IST)).toEqual(
      draft(["2026-11-05", "00:00:00"], ["2026-11-05", "23:59:59"]),
    );
  });

  it("seeds a repeated hour with the offset its instant had", () => {
    const seeded = draftFromRange(
      us("2026-11-01T01:30:00-05:00"),
      us("2026-11-01T03:00:00-05:00"),
      NY,
    );
    expect(seeded.start.offset).toBe("UTC-05:00");
    expect(edgeInstant(seeded.start, NY)).toMatchObject({
      us: us("2026-11-01T01:30:00-05:00"),
      offsets: ["UTC-04:00", "UTC-05:00"],
    });
  });

  it("reads a repeated wall time as its first occurrence until an offset is chosen", () => {
    expect(edgeInstant({ date: "2026-11-01", time: "01:30:00", offset: "" }, NY).us).toBe(
      us("2026-11-01T01:30:00-04:00"),
    );
  });

  it("accepts a whole draft and returns the instants it sends", () => {
    const result = validateDraft(
      draft(["2026-11-04", "13:47:03"], ["2026-11-06", "23:59:59"]),
      VALID,
      IST,
    );
    expect(result).toEqual({
      valid: true,
      start: null,
      end: null,
      startUs: us("2026-11-04T13:47:03+05:30"),
      endUs: us("2026-11-07T00:00:00+05:30"),
    });
  });

  it("flags an end before its start on End", () => {
    const result = validateDraft(
      draft(["2026-11-04", "13:47:03"], ["2026-11-04", "13:00:00"]),
      VALID,
      IST,
    );
    expect(result).toMatchObject({ valid: false, start: null, end: "end-before-start" });
  });

  it("flags a half-typed part and a day that does not exist", () => {
    const status = { ...VALID, startTime: "incomplete" as const, endDate: "invalid" as const };
    const result = validateDraft(draft(["2026-11-04", ""], ["", "13:00:00"]), status, IST);
    expect(result).toMatchObject({ valid: false, start: "incomplete-time", end: "invalid-date" });
  });

  it("does not call an empty form an error, but does not apply it", () => {
    const result = validateDraft(draft(["", ""], ["", ""]), emptyFieldStatus(), IST);
    expect(result).toMatchObject({ valid: false, start: null, end: null });
  });

  it("flags a time that a DST change skips", () => {
    const result = validateDraft(
      draft(["2026-03-08", "02:30:00"], ["2026-03-08", "05:00:00"]),
      VALID,
      NY,
    );
    expect(result.start).toBe("skipped");
  });

  it("checks date-only drafts as whole days", () => {
    const result = validateDraft(
      draft(["2026-11-04", "13:00:00"], ["2026-11-04", "09:00:00"]),
      VALID,
      IST,
      true,
    );
    expect(result).toMatchObject({ valid: true, endUs: us("2026-11-05T00:00:00+05:30") });
  });

  it("compares drafts by wall times and offsets", () => {
    const a = draft(["2026-11-04", "13:47:03"], ["2026-11-06", "14:02:03"]);
    expect(sameDraft(a, draft(["2026-11-04", "13:47:03"], ["2026-11-06", "14:02:03"]))).toBe(true);
    expect(sameDraft(a, draft(["2026-11-04", "13:47:04"], ["2026-11-06", "14:02:03"]))).toBe(false);
  });
});
