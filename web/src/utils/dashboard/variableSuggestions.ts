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

import {
  DATE_VARIABLE_FORMATS,
  LIST_VARIABLE_FORMATS,
  formatDateVariableValue,
  type DateVariableFormat,
} from "@/utils/dashboard/variables/variablesUtils";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { TemplateSuggestion } from "@/lib/forms/TemplateInput/OTemplateInput.types";

export interface VariableSuggestionContext {
  tabId?: string;
  panelId?: string;
}

// Ad hoc filters hold filter objects, not a printable value.
const TEXT_VARIABLE_TYPES = ["query_values", "custom", "constant", "textbox", "date"] as const;

const LIST_EXAMPLE = raw("a, b");

type ListVariableFormat = (typeof LIST_VARIABLE_FORMATS)[number];

// Fixed day, so every example reads the same whatever the date variable holds.
const DATE_EXAMPLE = "2026-03-08";

const FORMAT_EXAMPLES: Record<ListVariableFormat, I18nText> = {
  csv: raw("a,b"),
  pipe: raw("a|b"),
  doublequote: raw('"a","b"'),
  singlequote: raw("'a','b'"),
};

const dateExample = (format: DateVariableFormat): I18nText =>
  raw(formatDateVariableValue(DATE_EXAMPLE, format) ?? DATE_EXAMPLE);

const isVisibleIn = (variable: any, context?: VariableSuggestionContext): boolean => {
  if (!context) return true;
  if (variable?.scope === "tabs") return (variable.tabs ?? []).includes(context.tabId);
  if (variable?.scope === "panels") return (variable.panels ?? []).includes(context.panelId);
  return true;
};

/** Variables a text field can reference, as `$` suggestions: every name, plus one per list format for multi-select variables and one per date format for date variables. */
export const getVariableSuggestions = (
  variables: any[] | null | undefined,
  t: TranslateFn,
  context?: VariableSuggestionContext,
): TemplateSuggestion[] => {
  const typeLabels: Record<(typeof TEXT_VARIABLE_TYPES)[number], I18nText> = {
    query_values: t("panel.variableSuggestion.queryValues"),
    custom: t("panel.variableSuggestion.custom"),
    constant: t("panel.variableSuggestion.constant"),
    textbox: t("panel.variableSuggestion.textbox"),
    date: t("panel.variableSuggestion.date"),
  };
  const formatLabels: Record<ListVariableFormat, I18nText> = {
    csv: t("panel.variableSuggestion.csv", { example: FORMAT_EXAMPLES.csv }),
    pipe: t("panel.variableSuggestion.pipe", { example: FORMAT_EXAMPLES.pipe }),
    doublequote: t("panel.variableSuggestion.doublequote", {
      example: FORMAT_EXAMPLES.doublequote,
    }),
    singlequote: t("panel.variableSuggestion.singlequote", {
      example: FORMAT_EXAMPLES.singlequote,
    }),
  };
  const dateFormatLabels: Record<DateVariableFormat, I18nText> = {
    iso: t("panel.variableSuggestion.dateIso", { example: dateExample("iso") }),
    dmy: t("panel.variableSuggestion.dateDmy", { example: dateExample("dmy") }),
    mdy: t("panel.variableSuggestion.dateMdy", { example: dateExample("mdy") }),
    epoch: t("panel.variableSuggestion.dateEpoch", { example: dateExample("epoch") }),
    epochms: t("panel.variableSuggestion.dateEpochms", { example: dateExample("epochms") }),
    epochus: t("panel.variableSuggestion.dateEpochus", { example: dateExample("epochus") }),
  };
  const seen = new Set<string>();
  return (variables ?? []).flatMap((variable: any): TemplateSuggestion[] => {
    const name = variable?.name;
    const type = TEXT_VARIABLE_TYPES.find((it) => it === variable?.type);
    if (typeof name !== "string" || !name || !type || seen.has(name)) return [];
    if (!isVisibleIn(variable, context)) return [];
    seen.add(name);
    const typeLabel = typeLabels[type];
    if (type === "date") {
      return [
        { name, description: typeLabel },
        ...DATE_VARIABLE_FORMATS.map((format) => ({
          name: `${name}:${format}`,
          description: dateFormatLabels[format],
        })),
      ];
    }
    const isList = variable.multiSelect === true && (type === "query_values" || type === "custom");
    if (!isList) return [{ name, description: typeLabel }];
    return [
      {
        name,
        description: t("panel.variableSuggestion.list", { type: typeLabel, example: LIST_EXAMPLE }),
      },
      ...LIST_VARIABLE_FORMATS.map((format) => ({
        name: `${name}:${format}`,
        description: formatLabels[format],
      })),
    ];
  });
};
