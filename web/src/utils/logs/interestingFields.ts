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

// Quick mode turns the interesting fields into the query's SELECT list, so only a
// schema-backed field can be one. extractFields() also puts the fields it finds on
// the result hits — a VRL function's output — into selectedStreamFields, marked
// isSchemaField: false. Those do not exist when the SQL runs (the backend applies
// the VRL afterwards), so selecting one fails the whole search with
// "Search field not found: <field>" (o2-enterprise#2859).

type StreamField = { name: string; isSchemaField?: boolean };

/**
 * Whether `field` can appear in a SELECT list. The test is `!== false`, not
 * `=== true`: several paths assign a raw stream schema whose entries carry no
 * isSchemaField property at all, and those are schema fields.
 */
export const isSchemaBackedField = (field: StreamField | undefined): boolean =>
  field?.isSchemaField !== false;

/** The selectable field names in a selectedStreamFields list. */
export const schemaBackedFieldNames = (streamFields: StreamField[] | undefined): string[] =>
  (streamFields ?? []).filter(isSchemaBackedField).map((field) => field.name);

/** `interestingFields` minus everything that is not a selectable field of the stream. */
export const selectableInterestingFields = (
  interestingFields: string[] | undefined,
  streamFields: StreamField[] | undefined,
): string[] => {
  const selectable = new Set(schemaBackedFieldNames(streamFields));
  return (interestingFields ?? []).filter((name) => selectable.has(name));
};

/**
 * Drop the non-selectable entries from `interestingFields` in place — callers hold
 * the array by reference (and Vue tracks it), so it must not be replaced.
 * Returns the same array.
 */
export const pruneInterestingFields = (
  interestingFields: string[],
  streamFields: StreamField[] | undefined,
): string[] => {
  const kept = selectableInterestingFields(interestingFields, streamFields);
  if (kept.length !== interestingFields.length) {
    interestingFields.splice(0, interestingFields.length, ...kept);
  }
  return interestingFields;
};
