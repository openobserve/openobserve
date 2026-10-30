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

import { ALL_CONDITION_OPERATOR_VALUES } from "@/components/alerts/conditionOperators";
import { HEX_RE } from "@/utils/chartTheme";
import type { I18nText, TranslateFn } from "@/types/i18n";

// Kept out of annotationSources.ts: that file's sqlIdentifiers.ts import reaches the live store at load time, which panelValidation.ts (via useDashboardPanel.ts, a near-universal import) must not carry just to run this pure structural check.

/** Caps the total defined annotation sources (enabled or not), bounding fan-out if all were enabled. */
export const MAX_ANNOTATION_SOURCES = 10;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBlank = (value: unknown) => typeof value !== "string" || value.trim() === "";

// eslint-disable-next-line no-control-regex -- intentional: mirrors the backend's control-character ban.
const INVALID_ANNOTATION_COLUMN_CHARS_RE = /["\u0000-\u001F\u007F-\u009F]/;

/** Mirrors the backend's `is_valid_annotation_column`: strips a `$` prefix, then bans empty, `"`, `;`, `--`, and control characters. */
export const isValidAnnotationColumn = (column: string): boolean => {
  const name = column.startsWith("$") ? column.slice(1) : column;
  return (
    name !== "" &&
    !INVALID_ANNOTATION_COLUMN_CHARS_RE.test(name) &&
    !name.includes(";") &&
    !name.includes("--")
  );
};

/** Structural errors in a filter tree node: must be a known `filterType`, with a supported leaf operator and column. */
const annotationConditionTreeProblems = (t: TranslateFn, node: unknown): I18nText[] => {
  if (!isRecord(node)) return [t("dashboard.annotationSources.invalidFilters")];
  if (node.filterType === "condition") {
    const operator = node.operator;
    if (typeof operator !== "string" || !ALL_CONDITION_OPERATOR_VALUES.includes(operator)) {
      return [t("dashboard.annotationSources.unknownOperator", { operator: String(operator) })];
    }
    const column = node.column;
    if (typeof column !== "string" || !isValidAnnotationColumn(column)) {
      return [t("dashboard.annotationSources.invalidFilterColumn", { column: String(column) })];
    }
    return [];
  }
  if (node.filterType === "group") {
    const conditions = Array.isArray(node.conditions) ? node.conditions : [];
    return conditions.flatMap((child) => annotationConditionTreeProblems(t, child));
  }
  return [t("dashboard.annotationSources.invalidFilters")];
};

const annotationSourceProblems = (
  t: TranslateFn,
  source: Record<string, unknown>,
  seenIds: Set<string>,
  seenNames: Set<string>,
): I18nText[] => {
  const problems: I18nText[] = [];
  const id = source.id;
  if (isBlank(id)) problems.push(t("dashboard.annotationSources.idRequired"));
  else if (seenIds.has(id as string)) {
    problems.push(t("dashboard.annotationSources.duplicateId", { id }));
  } else seenIds.add(id as string);
  if (isBlank(source.name)) {
    problems.push(t("dashboard.annotationSources.nameRequired"));
  } else {
    const normalizedName = String(source.name).trim().toLowerCase();
    if (seenNames.has(normalizedName)) {
      problems.push(t("dashboard.annotationSources.duplicateName"));
    } else seenNames.add(normalizedName);
  }
  if (isBlank(source.title)) problems.push(t("dashboard.annotationSources.titleRequired"));
  if (source.color !== undefined && !HEX_RE.test(String(source.color))) {
    problems.push(t("dashboard.annotationSources.invalidColor"));
  }
  if (source.mode !== "builder" && source.mode !== "sql") {
    problems.push(t("dashboard.annotationSources.invalidMode"));
  } else if (source.mode === "sql" && isBlank(source.query)) {
    problems.push(t("dashboard.annotationSources.queryRequired"));
  } else if (source.mode === "builder" && isBlank(source.stream)) {
    problems.push(t("dashboard.annotationSources.streamRequired"));
  }
  if (source.filters !== undefined) {
    problems.push(...annotationConditionTreeProblems(t, source.filters));
  }
  return problems;
};

/** Structural errors in a dashboard's `annotationSources`, for the import and JSON-editor checks. */
export const validateAnnotationSources = (t: TranslateFn, sources: unknown): I18nText[] => {
  if (sources === undefined || sources === null) return [];
  if (!Array.isArray(sources)) return [t("dashboard.annotationSources.mustBeArray")];
  if (sources.length > MAX_ANNOTATION_SOURCES) {
    return [t("dashboard.annotationSources.tooMany", { max: MAX_ANNOTATION_SOURCES })];
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  return sources.flatMap((source, index) => {
    const problems = isRecord(source)
      ? annotationSourceProblems(t, source, seenIds, seenNames)
      : [t("dashboard.annotationSources.mustBeObject")];
    return problems.map((error) =>
      t("dashboard.annotationSources.errorPrefix", { index: index + 1, error }),
    );
  });
};
