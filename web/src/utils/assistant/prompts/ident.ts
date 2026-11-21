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

/** The only free value a prompt sentence may hold: a short identifier; anything else goes to a chip. */
export const IDENT = /^[\w.:/-]{1,80}$/;

/** The value when it is a plain identifier, else `null`: the caller then names "the attached … block". */
export function ident(value: unknown): string | null {
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  return IDENT.test(text) ? text : null;
}
