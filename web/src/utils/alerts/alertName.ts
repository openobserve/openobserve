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

// The server's name rule (RE_OFGA_UNSUPPORTED_NAME), as AddAlert.schema mirrors it.
const UNSUPPORTED_RUNS = /[:#?\s'"%&/]+/g;

/** The name an alert saves under: each run of characters the server refuses becomes one `_`. */
export const savedAlertName = (typed: string): string =>
  typed.trim().replace(UNSUPPORTED_RUNS, "_").replace(/_{2,}/g, "_").replace(/_+$/g, "");

/** `name`, or `name_2`, `name_3`… so a suggestion never repeats an alert the user already has. */
export const unusedAlertName = (name: string, taken: ReadonlySet<string>): string => {
  if (!name || !taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}_${n}`)) n++;
  return `${name}_${n}`;
};
