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

/** What the live browser player holds, all times in session ms. */
export interface RunCoverage {
  anchorIndex: number;
  appendedThroughIndex: number;
  lastIndex: number;
  anchorStartMs: number;
  playerEndMs: number | null;
}

export interface CoverageRecord {
  type: number;
  timestamp: number;
}

// The mobile SDKs mark a full screen with record type 10.
const MOBILE_FULL_SNAPSHOT = 10;

/** True when a target sits before the run's anchor, which the forward-only loader never reaches. */
export function isBeforeRun(target: number, run: RunCoverage): boolean {
  return target < run.anchorStartMs;
}

// rrweb cannot sit past its last event, so until the run reaches the last segment an idle gap after the edge is not covered.
export function isCoveredBrowser(target: number, run: RunCoverage): boolean {
  if (run.lastIndex < 0 || run.appendedThroughIndex < run.anchorIndex) return false;
  if (run.playerEndMs === null || isBeforeRun(target, run)) return false;
  if (run.appendedThroughIndex >= run.lastIndex) return true;
  return target <= run.playerEndMs;
}

// The wireframe player redraws from the latest full screen, so the target needs one at or before it.
export function isCoveredMobile(targetAbs: number, records: CoverageRecord[]): boolean {
  if (!records.length || records[records.length - 1].timestamp < targetAbs) return false;
  return records.some((r) => r.type === MOBILE_FULL_SNAPSHOT && r.timestamp <= targetAbs);
}
