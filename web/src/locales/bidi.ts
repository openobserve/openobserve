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

// Bidi isolates keep neutral punctuation attached to its interpolated directional run.

/** LRI … PDI — a run that must read left-to-right (IDs, SQL, URLs, numbers). */
export const isolateLtr = (value: string | number): string => `⁦${value}⁩`;

/** FSI … PDI — a run whose direction follows its own first strong character. */
export const isolateAuto = (value: string | number): string => `⁨${value}⁩`;
