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
  getReferencedVariableNames,
  processVariableContent,
  VARIABLE_FORMATS,
  type VariableFormat,
} from "@/utils/dashboard/variables/variablesUtils";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { TemplateSuggestion } from "@/lib/forms/TemplateInput/OTemplateInput.types";

export interface PanelTitleContext {
  tabId?: string;
  panelId?: string;
}

// Private-use code point: never typed in a title, so it can mark where an empty value went.
const EMPTY_MARK = "\uE000";
const SEPARATOR = String.raw`\s*[-–—|:·•/,]+\s*`;
const MAX_FILE_NAME_LENGTH = 100;
// eslint-disable-next-line no-control-regex -- control characters are invalid in file names
const UNSAFE_FILE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]+/g;

// Ad hoc filters hold filter objects, not a printable value.
const TITLE_VARIABLE_TYPES = ["query_values", "custom", "constant", "textbox"] as const;

const LIST_EXAMPLE = raw("a, b");

const FORMAT_EXAMPLES: Record<VariableFormat, I18nText> = {
  csv: raw("a,b"),
  pipe: raw("a|b"),
  doublequote: raw('"a","b"'),
  singlequote: raw("'a','b'"),
};

const markEmpty = (value: string) => (value === "" ? EMPTY_MARK : value);

const removeEmptyValues = (title: string): string => {
  if (!title.includes(EMPTY_MARK)) return title;
  return title
    .replace(new RegExp(`[(\\[{]\\s*${EMPTY_MARK}\\s*[)\\]}]`, "g"), EMPTY_MARK)
    .replace(new RegExp(`${SEPARATOR}${EMPTY_MARK}`, "g"), EMPTY_MARK)
    .replace(new RegExp(`^(\\s*${EMPTY_MARK})+${SEPARATOR}`), "")
    .replaceAll(EMPTY_MARK, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};

const isVisibleIn = (variable: any, context: PanelTitleContext): boolean => {
  if (variable?.scope === "tabs") return (variable.tabs ?? []).includes(context.tabId);
  if (variable?.scope === "panels") return (variable.panels ?? []).includes(context.panelId);
  return true;
};

/** Resolves variables in a panel title as plain text: "All" for select-all, empty values dropped with their separator, unknown names kept. */
export const resolvePanelTitle = (
  title: string | null | undefined,
  variablesData: any,
  context: PanelTitleContext | undefined,
  allLabel: string,
): string => {
  if (typeof title !== "string" || title === "") return title ?? "";
  if (!title.includes("$") && !title.includes("{{")) return title;
  return removeEmptyValues(
    processVariableContent(title, variablesData, context, {
      allLabel,
      escapeValue: markEmpty,
      listSeparator: ", ",
    }),
  );
};

/** True while a query variable the title references is still fetching its value. */
export const isPanelTitleLoading = (
  title: string | null | undefined,
  variablesData: any,
): boolean => {
  const values: any[] = Array.isArray(variablesData?.values) ? variablesData.values : [];
  if (typeof title !== "string" || !values.length) return false;
  const referenced = getReferencedVariableNames(
    [title],
    values.map((v) => v?.name),
  );
  return values.some(
    (v) =>
      referenced.has(v?.name) &&
      v.type === "query_values" &&
      (v.isLoading === true || v.isVariableLoadingPending === true),
  );
};

/** The title a viewer sees: the raw template while a referenced variable loads, the resolved text after. */
export const getPanelDisplayTitle = (
  title: string | null | undefined,
  variablesData: any,
  context: PanelTitleContext | undefined,
  allLabel: string,
): string =>
  isPanelTitleLoading(title, variablesData)
    ? (title ?? "")
    : resolvePanelTitle(title, variablesData, context, allLabel);

/** A download file name from a resolved title: filesystem-unsafe characters dropped, cut at a word boundary within 100 characters. */
export const toPanelFileName = (title: string | null | undefined): string | undefined => {
  const safe = (title ?? "").replace(UNSAFE_FILE_NAME_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!safe) return undefined;
  if (safe.length <= MAX_FILE_NAME_LENGTH) return safe;
  const cut = safe.slice(0, MAX_FILE_NAME_LENGTH + 1);
  const boundary = cut.lastIndexOf(" ");
  const head = boundary > MAX_FILE_NAME_LENGTH / 2 ? cut.slice(0, boundary) : cut.slice(0, -1);
  return head.replace(/[\s,;·•—–-]+$/, "");
};

/** Variables a panel title can reference, as `$` suggestions: every name, plus one per list format for multi-select variables. */
export const getPanelTitleSuggestions = (
  variables: any[] | null | undefined,
  context: PanelTitleContext,
  t: TranslateFn,
): TemplateSuggestion[] => {
  const typeLabels: Record<(typeof TITLE_VARIABLE_TYPES)[number], I18nText> = {
    query_values: t("panel.titleSuggestion.queryValues"),
    custom: t("panel.titleSuggestion.custom"),
    constant: t("panel.titleSuggestion.constant"),
    textbox: t("panel.titleSuggestion.textbox"),
  };
  const formatLabels: Record<VariableFormat, I18nText> = {
    csv: t("panel.titleSuggestion.csv", { example: FORMAT_EXAMPLES.csv }),
    pipe: t("panel.titleSuggestion.pipe", { example: FORMAT_EXAMPLES.pipe }),
    doublequote: t("panel.titleSuggestion.doublequote", { example: FORMAT_EXAMPLES.doublequote }),
    singlequote: t("panel.titleSuggestion.singlequote", { example: FORMAT_EXAMPLES.singlequote }),
  };
  const seen = new Set<string>();
  return (variables ?? []).flatMap((variable: any): TemplateSuggestion[] => {
    const name = variable?.name;
    const type = TITLE_VARIABLE_TYPES.find((it) => it === variable?.type);
    if (typeof name !== "string" || !name || !type || seen.has(name)) return [];
    if (!isVisibleIn(variable, context)) return [];
    seen.add(name);
    const typeLabel = typeLabels[type];
    const isList = variable.multiSelect === true && (type === "query_values" || type === "custom");
    if (!isList) return [{ name, description: typeLabel }];
    return [
      {
        name,
        description: t("panel.titleSuggestion.list", { type: typeLabel, example: LIST_EXAMPLE }),
      },
      ...VARIABLE_FORMATS.map((format) => ({
        name: `${name}:${format}`,
        description: formatLabels[format],
      })),
    ];
  });
};
