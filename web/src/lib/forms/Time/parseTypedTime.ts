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

export interface TypedTime {
  h: number;
  min: number;
  s: number;
}

/** Reads `H:M`, `HH:MM` (seconds optional) or `HMM`/`HHMM`, as a 24-hour time field commits it; null otherwise. */
export function parseTypedTime(val: string): TypedTime | null {
  const colon = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(val);
  const m = colon ?? /^(\d{1,2})(\d{2})$/.exec(val);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(colon?.[3] ?? 0);
  return h > 23 || min > 59 || s > 59 ? null : { h, min, s };
}

/** `HH:MM:SS` for a typed time. */
export const formatTypedTime = ({ h, min, s }: TypedTime): string =>
  [h, min, s].map((n) => String(n).padStart(2, "0")).join(":");
