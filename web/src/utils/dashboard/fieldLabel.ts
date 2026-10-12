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

export type AxisLabelMode = "auto" | "show" | "hide";

export const generateLabelFromName = (name: string) => {
  return name
    .replace(/[_\-\s.]/g, " ")
    .split(" ")
    .map((string) => string.charAt(0).toUpperCase() + string.slice(1))
    .filter((it) => it)
    .join(" ");
};

const fieldNameInArgs = (args: any[] | undefined): string => {
  for (const arg of args ?? []) {
    if (arg?.type === "field" && arg?.value?.field) return arg.value.field;
    if (arg?.type === "function") {
      const nested = fieldNameInArgs(arg?.value?.args);
      if (nested) return nested;
    }
  }
  return "";
};

// A panel saved before axis_label_mode existed must render its stored labels untouched.
const usesGeneratedLabels = (config: any): boolean => typeof config?.axis_label_mode === "string";

/** The name a field is shown under: its typed label, else one generated from the field. */
export const getFieldLabel = (field: any, config: any, customQuery = false): string => {
  if (!field || field.label || !usesGeneratedLabels(config)) return field?.label;
  if (customQuery) return field?.alias ?? "";
  // Switching a field to Raw clears its args, so its expression is the only name left.
  if (field.type === "raw" && field.rawQuery) return field.rawQuery;
  const name = fieldNameInArgs(field?.args) || field?.column;
  return name ? generateLabelFromName(name) : (field?.alias ?? "");
};

/** An axis only ever shows a label the user typed; hide drops even that. */
export const getAxisLabel = (field: any, config: any): string => {
  const mode: AxisLabelMode | undefined = config?.axis_label_mode;
  return mode === "hide" ? "" : field?.label;
};
