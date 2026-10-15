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

// Same list as the alerts condition builder (utils/alerts/conditionsFormatter.ts).
const STRING_TYPES = ["String", "Utf8", "LargeUtf8", "Utf8View"];

// The (empty) series sums NULL and "" rows. Only a string column holds "", and
// '' against any other type fails the query, so a non-string field matches NULL
// only. An unknown type keeps the string form.
export const getEmptyBreakdownFilter = (
  field: string,
  action: "include" | "exclude",
  quote: (f: string) => string,
  fieldType?: string,
): string => {
  const quoted = quote(field);
  if (fieldType && !STRING_TYPES.includes(fieldType)) {
    return action === "include" ? `${quoted} is null` : `${quoted} is not null`;
  }
  return action === "include"
    ? `(${quoted} is null OR ${quoted} = '')`
    : `(${quoted} is not null AND ${quoted} != '')`;
};
