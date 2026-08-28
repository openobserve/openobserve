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

// Unicode bidi isolates (UAX #9). Interpolating a value into translated prose
// splices two directional runs together, and the NEUTRAL characters between
// them — spaces, parentheses, colons, trailing periods — take the direction of
// whichever run wins, not the one they belong to. On an RTL page that moves a
// closing bracket or a trailing period to the far side of the line.
//
// An isolate says "resolve this run on its own, then place it as a single unit",
// which is what every interpolated value wants and what no plain string gets.

/** LRI … PDI — a run that must read left-to-right (IDs, SQL, URLs, numbers). */
export const isolateLtr = (value: string | number): string => `⁦${value}⁩`;

/** FSI … PDI — a run whose direction follows its own first strong character. */
export const isolateAuto = (value: string | number): string => `⁨${value}⁩`;
