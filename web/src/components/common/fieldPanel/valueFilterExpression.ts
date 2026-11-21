// Copyright 2026 OpenObserve Inc.

import { raw, type I18nText } from "@/types/i18n";

/** Key of the row of missing values; it starts with NUL, which no stored text the values list keys can collide with. */
export const MISSING_VALUE_KEY = "\u0000null";

/** What a value row shows for its key: the missing value reads "null", any other key is its own text. */
export const valueKeyLabel = (key: string): I18nText | undefined =>
  key === MISSING_VALUE_KEY ? raw("null") : undefined;

/** One field's picked values as one condition: includes OR together, excludes AND onto them, wrapped so the page replaces it whole. */
export const joinValueConditions = (
  include: string[],
  exclude: string[],
  casing: "lower" | "upper" = "lower",
  nullCondition?: string,
): string => {
  const or = casing === "upper" ? " OR " : " or ";
  const and = casing === "upper" ? " AND " : " and ";
  const includePart = include.length > 1 ? `(${include.join(or)})` : (include[0] ?? "");
  // `f != 'c'` is unknown on a null row, so with null included each exclusion lets null through.
  const excludeParts =
    includePart && nullCondition
      ? exclude.map((condition) => `(${condition}${or}${nullCondition})`)
      : exclude;
  if (!excludeParts.length) return includePart;
  if (!includePart && excludeParts.length === 1) return excludeParts[0];
  return `(${[includePart, ...excludeParts].filter(Boolean).join(and)})`;
};

// Only the missing-value key is null; the text "null" is a value a row holds.
export const isNullValue = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value === MISSING_VALUE_KEY;
