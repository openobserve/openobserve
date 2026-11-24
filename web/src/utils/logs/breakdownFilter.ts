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

// Only a string column holds "", and '' against another type fails the query,
// so a non-string field checks NULL alone; an unknown type keeps both checks.
export const emptyValueConditions = (
  field: string,
  action: "include" | "exclude",
  quote: (f: string) => string,
  fieldType?: string,
): string[] => {
  const quoted = quote(field);
  const isNull = action === "include" ? `${quoted} is null` : `${quoted} is not null`;
  if (fieldType && !STRING_TYPES.includes(fieldType)) return [isNull];
  return [isNull, action === "include" ? `${quoted} = ''` : `${quoted} != ''`];
};

/** With several streams selected, a field any of them types as a non-string checks NULL alone. */
export const emptyValueFieldType = (
  field: string,
  listedType: string | undefined,
  streams: { name: string; schema?: { name: string; type: string }[] }[],
  selected: string[],
): string | undefined =>
  streams
    .filter((stream) => selected.includes(stream.name))
    .flatMap((stream) => (stream.schema ?? []).filter((f) => f.name === field).map((f) => f.type))
    .find((type) => !STRING_TYPES.includes(type)) ?? listedType;

// The (empty) series counts NULL and "" rows together, so its filter matches both.
export const getEmptyBreakdownFilter = (
  field: string,
  action: "include" | "exclude",
  quote: (f: string) => string,
  fieldType?: string,
): string => {
  const conditions = emptyValueConditions(field, action, quote, fieldType);
  const joined = conditions.join(action === "include" ? " OR " : " AND ");
  return conditions.length > 1 ? `(${joined})` : joined;
};
