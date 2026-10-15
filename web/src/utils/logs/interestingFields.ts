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

// A VRL field exists only on the result hits, so quick mode selecting it fails the search (o2-enterprise#2859).

type StreamField = { name: string; isSchemaField?: boolean };

// `!== false`, not `=== true`: a raw stream schema's entries carry no such property.
export const isSchemaBackedField = (field: StreamField | undefined): boolean =>
  field?.isSchemaField !== false;

export const schemaBackedFieldNames = (streamFields: StreamField[] | undefined): string[] =>
  (streamFields ?? []).filter(isSchemaBackedField).map((field) => field.name);

export const selectableInterestingFields = (
  interestingFields: string[] | undefined,
  streamFields: StreamField[] | undefined,
): string[] => {
  const selectable = new Set(schemaBackedFieldNames(streamFields));
  return (interestingFields ?? []).filter((name) => selectable.has(name));
};

// Mutates in place and returns the same array: callers and Vue hold it by reference.
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
