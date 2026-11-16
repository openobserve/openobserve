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

/** Joins names in the locale's list style, ending in "and N more" past `max`; a lone leftover is named, not counted. */
export function shortList(
  given: readonly string[],
  max: number,
  locale: string,
  more: (count: number) => string,
): string {
  const names = given.filter((name) => name.trim());
  const format = new Intl.ListFormat(locale, { type: "conjunction" });
  if (names.length <= max + 1) return format.format(names);
  return format.format([...names.slice(0, max), more(names.length - max)]);
}
