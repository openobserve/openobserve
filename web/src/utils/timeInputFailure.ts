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

import analytics from "@/services/product_analytics";
import type { ParseFailureReason } from "@/utils/dateTimeRangeParse";

export const PARSE_FAILURE_EVENT = "time_range_parse_failed";

const LENGTH_BUCKETS: readonly [number, ParseFailureEvent["length_bucket"]][] = [
  [2, "1-2"],
  [5, "3-5"],
  [10, "6-10"],
  [20, "11-20"],
  [40, "21-40"],
];
const MONTH_WORD_RE =
  /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b|\b(?:q[1-4]|h[12]|fy\d{2,4})\b/i;

/** What a failed Enter looked like, so the grammar can learn; it never carries the text. */
export interface ParseFailureEvent {
  length_bucket: "1-2" | "3-5" | "6-10" | "11-20" | "21-40" | "41+";
  has_digits: boolean;
  has_month_word: boolean;
  matched_form:
    "none" | "future" | "reversed" | "number" | "clock" | "date" | "epoch_like" | "words";
}

/** The analytics payload for a failed Enter. */
export const describeParseFailure = (
  text: string,
  reason: ParseFailureReason,
): ParseFailureEvent => {
  const trimmed = text.trim();
  const length = [...trimmed].length;
  return {
    length_bucket: LENGTH_BUCKETS.find(([max]) => length <= max)?.[1] ?? "41+",
    has_digits: /\p{Nd}/u.test(trimmed),
    has_month_word: MONTH_WORD_RE.test(trimmed),
    matched_form: reason === "unreadable" ? shapeOf(trimmed) : reason,
  };
};

/** Records one failed Enter in product analytics. */
export const reportParseFailure = (text: string, reason: ParseFailureReason): void => {
  analytics.track(PARSE_FAILURE_EVENT, describeParseFailure(text, reason));
};

const shapeOf = (text: string): ParseFailureEvent["matched_form"] => {
  if (/^\d{7,}$/.test(text)) return "epoch_like";
  if (/^\d+$/.test(text)) return "number";
  if (/\d{1,2}:\d{2}/.test(text)) return "clock";
  if (/\d{1,4}[-/.]\d{1,2}/.test(text) || MONTH_WORD_RE.test(text)) return "date";
  return /\p{L}/u.test(text) ? "words" : "none";
};
