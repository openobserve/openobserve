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

import { describe, expect, it, vi } from "vitest";
import analytics from "@/services/product_analytics";
import { PARSE_FAILURE_EVENT, describeParseFailure, reportParseFailure } from "./timeInputFailure";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

describe("describeParseFailure [#39]", () => {
  it.each([
    [
      "banana",
      "unreadable",
      { length_bucket: "6-10", has_digits: false, has_month_word: false, matched_form: "words" },
    ],
    [
      "99:99",
      "unreadable",
      { length_bucket: "3-5", has_digits: true, has_month_word: false, matched_form: "clock" },
    ],
    [
      "17624376000",
      "unreadable",
      {
        length_bucket: "11-20",
        has_digits: true,
        has_month_word: false,
        matched_form: "epoch_like",
      },
    ],
    [
      "Nov 31",
      "unreadable",
      { length_bucket: "6-10", has_digits: true, has_month_word: true, matched_form: "date" },
    ],
    [
      "tomorrow",
      "future",
      { length_bucket: "6-10", has_digits: false, has_month_word: false, matched_form: "future" },
    ],
    [
      "Nov 6 - Nov 4",
      "reversed",
      { length_bucket: "11-20", has_digits: true, has_month_word: true, matched_form: "reversed" },
    ],
  ] as const)("describes %j", (text, reason, expected) => {
    expect(describeParseFailure(text, reason)).toEqual(expected);
  });

  it("never carries the text", () => {
    const event = describeParseFailure("secret-host-name 12:00", "unreadable");
    expect(JSON.stringify(event)).not.toContain("secret");
  });
});

describe("reportParseFailure", () => {
  it("tracks one event per failed Enter", () => {
    reportParseFailure("banana", "unreadable");
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith(PARSE_FAILURE_EVENT, {
      length_bucket: "6-10",
      has_digits: false,
      has_month_word: false,
      matched_form: "words",
    });
  });
});

describe("month words [#12]", () => {
  it.each(["decide", "market", "junk", "mayday"])("does not count %s", (text) => {
    expect(describeParseFailure(text, "unreadable").has_month_word).toBe(false);
  });

  it.each(["march 4", "Sept", "dec", "FY26"])("counts %s", (text) => {
    expect(describeParseFailure(text, "unreadable").has_month_word).toBe(true);
  });
});
