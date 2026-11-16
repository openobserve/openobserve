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

export interface AoSparkPoint {
  t: number;
  v: number | null;
}

export interface AoSparkBand {
  t: number;
  lower: number;
  upper: number;
}

export interface AoSparkMarker {
  t: number;
  kind: string;
  label: string;
}

export type AoSparkTone = "danger" | "warning" | "success" | "neutral";

/** A stretch of time to shade behind the line, such as buckets judged outside their usual range. */
export interface AoSparkSpan {
  from: number;
  to: number;
}
