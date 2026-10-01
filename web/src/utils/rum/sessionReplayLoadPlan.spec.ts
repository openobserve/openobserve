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
import { nextBatches } from "./sessionReplayLoadPlan";
import {
  createLoaderState,
  extendLoaderState,
  markInFlight,
  markSkipped,
  markStored,
} from "./sessionReplayLoader";
import type { ManifestEntry } from "./sessionReplayManifest";

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

// One row a second, so no two rows tie on start unless a test makes them.
function manifestOf(n: number): ManifestEntry[] {
  return Array.from({ length: n }, (_, i) => ({ start: i * 1000, end: i * 1000 + 999 }));
}

describe("nextBatches", () => {
  it("cuts contiguous missing segments into batches of at most 25", () => {
    const manifest = manifestOf(60);
    const state = createLoaderState(60);

    expect(nextBatches(manifest, state, { appendedThroughIndex: -1 })).toEqual([
      range(0, 24),
      range(25, 49),
      range(50, 59),
    ]);
  });

  it("honours a custom batch size", () => {
    const manifest = manifestOf(7);
    const state = createLoaderState(7);

    expect(nextBatches(manifest, state, { appendedThroughIndex: -1 }, { batch: 3 })).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6],
    ]);
  });

  it("returns no more batches than the free in-flight slots", () => {
    const manifest = manifestOf(200);
    const state = createLoaderState(200);
    const run = { appendedThroughIndex: -1 };

    expect(nextBatches(manifest, state, run)).toHaveLength(3);
    expect(nextBatches(manifest, state, run, { inFlight: 1 })).toEqual([
      range(0, 24),
      range(25, 49),
    ]);
    expect(nextBatches(manifest, state, run, { inFlight: 3 })).toEqual([]);
    expect(nextBatches(manifest, state, run, { maxInFlight: 1 })).toEqual([range(0, 24)]);
  });

  it("starts after the run's appended edge", () => {
    const manifest = manifestOf(40);
    const state = createLoaderState(40);

    expect(nextBatches(manifest, state, { appendedThroughIndex: 9 })[0]).toEqual(range(10, 34));
  });

  it("skips stored, in-flight and skipped segments and never spans them", () => {
    const manifest = manifestOf(12);
    const state = createLoaderState(12);
    markStored(state, 2);
    markInFlight(state, [5, 6]);
    markSkipped(state, 9, "network");

    expect(nextBatches(manifest, state, { appendedThroughIndex: -1 })).toEqual([
      [0, 1],
      [3, 4],
      [7, 8],
    ]);
    expect(nextBatches(manifest, state, { appendedThroughIndex: -1 }, { maxInFlight: 4 })).toEqual([
      [0, 1],
      [3, 4],
      [7, 8],
      [10, 11],
    ]);
  });

  it("re-requests a fetchedMissing segment but not a skipped one", () => {
    const manifest = manifestOf(3);
    const state = createLoaderState(3);
    state.status[0] = "fetchedMissing";
    markSkipped(state, 1, "missing");
    markStored(state, 2);

    expect(nextBatches(manifest, state, { appendedThroughIndex: -1 })).toEqual([[0]]);
  });

  it("fills holes before the edge only after the tail, and never joins the two", () => {
    const manifest = manifestOf(10);
    const state = createLoaderState(10);
    markStored(state, 6);

    expect(nextBatches(manifest, state, { appendedThroughIndex: 5 })).toEqual([
      [7, 8, 9],
      [0, 1, 2, 3, 4, 5],
    ]);
  });

  it("ends a full batch before rows tied on start, so one query never repeats another", () => {
    const manifest = manifestOf(30);
    manifest[25] = { start: manifest[24].start, end: manifest[24].start + 500 };
    const state = createLoaderState(30);

    const batches = nextBatches(manifest, state, { appendedThroughIndex: -1 });
    expect(batches[0]).toEqual(range(0, 23));
    expect(batches[1]).toEqual(range(24, 29));
  });

  it("covers segments a live poll appended", () => {
    const manifest = manifestOf(4);
    const state = createLoaderState(2);
    markStored(state, 0);
    markStored(state, 1);
    extendLoaderState(state, 2);

    expect(nextBatches(manifest, state, { appendedThroughIndex: 1 })).toEqual([[2, 3]]);
  });

  it("returns nothing when every segment is settled", () => {
    const manifest = manifestOf(2);
    const state = createLoaderState(2);
    markStored(state, 0);
    markSkipped(state, 1, "parse");

    expect(nextBatches(manifest, state, { appendedThroughIndex: 1 })).toEqual([]);
  });
});
