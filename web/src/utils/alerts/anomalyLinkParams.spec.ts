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
  copyAnomalyLinkParams,
  parseAnomalyLink,
  withoutAnomalyLinkParams,
} from "@/utils/alerts/anomalyLinkParams";

const LINK = {
  stream: "k8s_logs",
  type: "search_scheduler",
  from_anomaly: "a1",
  anomaly_filter_applied: "1",
  anomaly_start: "1700000000000000",
  anomaly_end: "1700003600000000",
  anomaly_kind: "value",
  anomaly_measure: "count(*) per 15 min",
  anomaly_actual: "208",
  anomaly_lower: "120.4",
  anomaly_upper: "157.2",
};

describe("copyAnomalyLinkParams", () => {
  it("copies from_anomaly and every anomaly_ parameter into a rebuilt query", () => {
    const out = copyAnomalyLinkParams(LINK, { stream: "k8s_logs", query: "abc" });
    expect(out).toEqual({
      stream: "k8s_logs",
      query: "abc",
      from_anomaly: "a1",
      anomaly_filter_applied: "1",
      anomaly_start: "1700000000000000",
      anomaly_end: "1700003600000000",
      anomaly_kind: "value",
      anomaly_measure: "count(*) per 15 min",
      anomaly_actual: "208",
      anomaly_lower: "120.4",
      anomaly_upper: "157.2",
    });
  });

  it("leaves the query alone when the page was not opened from an anomaly", () => {
    expect(copyAnomalyLinkParams({ stream: "x" }, { stream: "y" })).toEqual({ stream: "y" });
    expect(copyAnomalyLinkParams(undefined, { stream: "y" })).toEqual({ stream: "y" });
  });
});

describe("withoutAnomalyLinkParams", () => {
  it("drops only the banner parameters", () => {
    expect(withoutAnomalyLinkParams(LINK)).toEqual({
      stream: "k8s_logs",
      type: "search_scheduler",
    });
  });
});

describe("parseAnomalyLink", () => {
  it("reads the snapshot of the link", () => {
    expect(parseAnomalyLink(LINK)).toEqual({
      anomalyId: "a1",
      filterApplied: true,
      startUs: 1700000000000000,
      endUs: 1700003600000000,
      kind: "value",
      measure: "count(*) per 15 min",
      actual: 208,
      lower: 120.4,
      upper: 157.2,
      expected: null,
    });
  });

  it("is null without from_anomaly", () => {
    expect(parseAnomalyLink({ stream: "x" })).toBeNull();
    expect(parseAnomalyLink({ from_anomaly: "" })).toBeNull();
  });

  it("reads anomaly_filter_applied=0 as not applied, and an absent value as applied", () => {
    const off = parseAnomalyLink({ from_anomaly: "a", anomaly_filter_applied: "0" });
    expect(off?.filterApplied).toBe(false);
    expect(parseAnomalyLink({ from_anomaly: "a" })?.filterApplied).toBe(true);
  });

  it("keeps a link with no values as values-free, and ignores an unknown kind", () => {
    const link = parseAnomalyLink({
      from_anomaly: "a",
      anomaly_kind: "other",
      anomaly_actual: "x",
    });
    expect(link?.kind).toBeNull();
    expect(link?.actual).toBeNull();
    expect(link?.lower).toBeNull();
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseAnomalyLink({ from_anomaly: ["a", "b"] })?.anomalyId).toBe("a");
  });
});
