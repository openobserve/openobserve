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

import type { Draft } from "../../types";

/** `15h`, vi `2 giờ` and nl `2 uur` are both a clock and a duration, so they ask. */
export function orClock(first: Draft[], other: () => Draft[]): Draft[] {
  const more = first.length > 0 ? other() : [];
  if (more.length === 0) return first;
  return [...first, ...more].map((d) => ({ ...d, why: "bare-duration" }));
}
