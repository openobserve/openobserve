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

// Trace ingestion puts these back as columns after packing (restore_derived_fields, restore_canonical_agent_fields).
const RESTORED_PREFIXES = ["infer_", "o2_db_"];
const RESTORED_FIELDS = new Set([
  "gen_ai_agent_name",
  "gen_ai_agent_id",
  "gen_ai_agent_env",
  "gen_ai_agent_version",
]);

/** Schema fields ingestion packs into the _all column, by name with their type; empty without a user-defined schema. */
export function fieldsStoredInAll(
  schema: { name: string; type?: string }[],
  definedFields: string[],
): Map<string, string> {
  const inAll = new Map<string, string>();
  if (definedFields.length === 0) return inAll;
  const defined = new Set(definedFields);
  for (const field of schema) {
    const name = field.name;
    if (name.startsWith("_") || defined.has(name) || RESTORED_FIELDS.has(name)) continue;
    if (RESTORED_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    inAll.set(name, field.type ?? "");
  }
  return inAll;
}

/** Reads a field out of the _all column with the json_get function that matches its type. */
export function allFieldRef(name: string, dataType: string | undefined, allColumn: string): string {
  const type = (dataType ?? "").toLowerCase();
  const fn = /^u?int/.test(type)
    ? "json_get_int"
    : /^float|^double|^decimal/.test(type)
      ? "json_get_float"
      : type === "boolean"
        ? "json_get_bool"
        : "json_get_str";
  return `${fn}(${allColumn}, '${name.replaceAll("'", "''")}')`;
}

/** Autocomplete fields with each _all field marked and inserting its json_get expression. */
export function withAllFieldInserts<T extends { name: string; dataType?: string; type?: string }>(
  fields: T[],
  inAll: Record<string, string>,
  allColumn: string,
  mark: string,
): (T & { insertText?: string })[] {
  return fields.map((field) => {
    if (!Object.prototype.hasOwnProperty.call(inAll, field.name)) return field;
    const detail = [field.type ?? field.dataType, mark].filter(Boolean).join(" · ");
    return {
      ...field,
      type: detail,
      insertText: allFieldRef(field.name, inAll[field.name], allColumn),
    };
  });
}
