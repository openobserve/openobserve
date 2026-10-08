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

import { SEGMENT_BATCH, isFetchable, type LoaderState } from "@/utils/rum/sessionReplayLoader";
import type { ManifestEntry } from "@/utils/rum/sessionReplayManifest";

export interface LoadPlanRun {
  appendedThroughIndex: number;
}

export interface LoadPlanOptions {
  batch?: number;
  maxInFlight?: number;
  inFlight?: number;
}

export const MAX_IN_FLIGHT = 3;

// Tail after the run edge first, then holes before it; a batch never spans a segment that is stored, in flight or skipped.
export function nextBatches(
  manifest: ManifestEntry[],
  state: LoaderState,
  run: LoadPlanRun,
  opts: LoadPlanOptions = {},
): number[][] {
  const size = opts.batch ?? SEGMENT_BATCH;
  const slots = (opts.maxInFlight ?? MAX_IN_FLIGHT) - (opts.inFlight ?? 0);
  const count = Math.min(manifest.length, state.status.length);
  const out: number[][] = [];
  if (slots <= 0 || size <= 0) return out;
  const from = Math.min(Math.max(0, run.appendedThroughIndex + 1), count);
  let current: number[] = [];
  const close = () => {
    if (current.length) out.push(current);
    current = [];
  };
  // Body queries select by start, so a full batch ends before rows tied with the next one and they travel together.
  const visit = (i: number) => {
    if (!isFetchable(state, i)) return close();
    if (current.length >= size) {
      let keep = current.length;
      while (keep > 0 && manifest[current[keep - 1]].start === manifest[i].start) keep--;
      if (keep === 0) keep = current.length;
      out.push(current.slice(0, keep));
      current = current.slice(keep);
    }
    current.push(i);
  };
  for (let i = from; i < count && out.length < slots; i++) visit(i);
  close();
  for (let i = 0; i < from && out.length < slots; i++) visit(i);
  close();
  return out.slice(0, slots);
}
