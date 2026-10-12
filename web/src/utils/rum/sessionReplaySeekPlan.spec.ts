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

import { describe, it, expect } from "vitest";
import {
  isBeforeRun,
  isCoveredBrowser,
  isCoveredMobile,
  type RunCoverage,
} from "./sessionReplaySeekPlan";

// A run anchored at segment 2 (session ms 10 000), appended through segment 5 of 9, player holding events up to 30 000.
const run: RunCoverage = {
  anchorIndex: 2,
  appendedThroughIndex: 5,
  lastIndex: 9,
  anchorStartMs: 10_000,
  playerEndMs: 30_000,
};

describe("isCoveredBrowser", () => {
  it("covers a target between the anchor and the player's last event", () => {
    expect(isCoveredBrowser(20_000, run)).toBe(true);
    expect(isCoveredBrowser(30_000, run)).toBe(true);
  });

  it("does not cover a target before the run's anchor segment", () => {
    expect(isCoveredBrowser(9_999, run)).toBe(false);
    expect(isBeforeRun(9_999, run)).toBe(true);
  });

  it("does not cover an idle gap after the last appended event while later segments are still to come", () => {
    expect(isCoveredBrowser(30_001, run)).toBe(false);
  });

  it("covers everything up to the session end once the last segment is appended", () => {
    expect(isCoveredBrowser(90_000, { ...run, appendedThroughIndex: 9 })).toBe(true);
  });

  it("covers nothing before the first append", () => {
    expect(isCoveredBrowser(10_000, { ...run, appendedThroughIndex: 1 })).toBe(false);
  });

  it("covers nothing for an empty manifest", () => {
    expect(isCoveredBrowser(0, { ...run, lastIndex: -1, anchorIndex: 0, anchorStartMs: 0 })).toBe(
      false,
    );
  });

  it("covers nothing until the player has reported what it holds", () => {
    expect(isCoveredBrowser(20_000, { ...run, playerEndMs: null })).toBe(false);
  });
});

describe("isCoveredMobile", () => {
  const records = [
    { type: 4, timestamp: 1000 },
    { type: 10, timestamp: 1000 },
    { type: 11, timestamp: 2000 },
    { type: 10, timestamp: 5000 },
    { type: 11, timestamp: 6000 },
  ];

  it("covers a target with a full screen at or before it and records past it", () => {
    expect(isCoveredMobile(1500, records)).toBe(true);
    expect(isCoveredMobile(6000, records)).toBe(true);
  });

  it("does not cover a target past the last loaded record", () => {
    expect(isCoveredMobile(6001, records)).toBe(false);
  });

  it("does not cover a target with no full screen before it", () => {
    expect(isCoveredMobile(900, records)).toBe(false);
    expect(
      isCoveredMobile(1500, [
        { type: 11, timestamp: 1000 },
        { type: 11, timestamp: 2000 },
      ]),
    ).toBe(false);
  });

  it("does not cover anything before a record has loaded", () => {
    expect(isCoveredMobile(0, [])).toBe(false);
  });
});
