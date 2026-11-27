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

type FieldRow = { name: string; label?: boolean; isInterestingField?: boolean };

/** The interesting subset of a grouped field list: a header stays only while a field under it is interesting. */
export const interestingRowsOf = <T extends FieldRow>(rows: T[]): T[] => {
  const result: T[] = [];
  let header: T | null = null;
  for (const row of rows) {
    if (row.label) {
      header = row;
      continue;
    }
    if (!row.isInterestingField) continue;
    if (header) {
      result.push(header);
      header = null;
    }
    result.push(row);
  }
  return result;
};

/** A stream's interesting fields as logs keeps them: the stored picks plus the defaults the user has not dropped. */
export const storedInterestingFields = (
  store: Record<string, string[] | undefined> | null | undefined,
  org: string,
  stream: string,
  defaults: Iterable<string>,
): string[] => {
  const deselected = new Set(store?.[`deselect_${org}_${stream}`] ?? []);
  return [
    ...(store?.[`${org}_${stream}`] ?? []),
    ...[...defaults].filter((field) => !deselected.has(field)),
  ];
};
