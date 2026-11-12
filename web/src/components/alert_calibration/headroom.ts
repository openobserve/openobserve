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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

/** The `headroom` a quiet skip stores in `skip_detail` (ENT finding.rs `Headroom`). */
export interface Headroom {
  value: number;
  threshold: number;
  operator: HeadroomOperator;
  level: HeadroomLevel;
  lower_bound: boolean;
  valued: number;
  /** Set only when the alert was edited inside the run's window. */
  last_edit_micros?: number;
}

export type HeadroomOperator = ">" | ">=" | "<" | "<=";
export type HeadroomLevel = "critical" | "warning";

export interface HeadroomSentenceOptions {
  form: "long" | "short";
  /** The run window in whole days; only the long form names it. */
  days?: number;
  /** The record's reason is `sentinel_by_design`, which the long form says in its own words. */
  sentinel?: boolean;
}

const OPERATORS: readonly string[] = [">", ">=", "<", "<="];
const LEVELS: readonly string[] = ["critical", "warning"];

const isOperator = (value: unknown): value is HeadroomOperator =>
  typeof value === "string" && OPERATORS.includes(value);
const isLevel = (value: unknown): value is HeadroomLevel =>
  typeof value === "string" && LEVELS.includes(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** The detail's `headroom`, or null for anything this build cannot read as one. */
export function parseHeadroom(detail: string | undefined | null): Headroom | null {
  if (!detail) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    return null;
  }
  const found =
    typeof parsed === "object" && parsed !== null && "headroom" in parsed ? parsed.headroom : null;
  if (typeof found !== "object" || found === null) return null;
  const h = found as Record<string, unknown>;
  if (!finite(h.value) || !finite(h.threshold) || !isOperator(h.operator) || !isLevel(h.level)) {
    return null;
  }
  return {
    value: h.value,
    threshold: h.threshold,
    operator: h.operator,
    level: h.level,
    lower_bound: h.lower_bound === true,
    valued: finite(h.valued) ? h.valued : 0,
    ...(finite(h.last_edit_micros) ? { last_edit_micros: h.last_edit_micros } : {}),
  };
}

const formatNumber = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** The value nearest the threshold that fires first, as one sentence; null for an unknown shape. */
export function headroomSentence(
  t: TranslateFn,
  headroom: Headroom,
  options: HeadroomSentenceOptions,
): I18nText | null {
  if (!isOperator(headroom.operator) || !isLevel(headroom.level)) return null;
  const lowest = headroom.operator === "<" || headroom.operator === "<=";
  const warning = headroom.level === "warning";
  const number = raw(formatNumber(headroom.value));
  const value = headroom.lower_bound
    ? t("alertCalibration.headroom.atLeast", { value: number })
    : number;
  const limit = raw(formatNumber(headroom.threshold));
  if (options.form === "short") {
    const threshold = warning
      ? t("alertCalibration.headroom.shortWarningThreshold", { value: limit })
      : t("alertCalibration.headroom.shortThreshold", { value: limit });
    return lowest
      ? t("alertCalibration.headroom.shortLowest", { value, threshold })
      : t("alertCalibration.headroom.short", { value, threshold });
  }
  const threshold = warning
    ? t("alertCalibration.headroom.warningThreshold", { value: limit })
    : t("alertCalibration.headroom.threshold", { value: limit });
  if (options.sentinel) return t("alertCalibration.headroom.sentinel", { threshold });
  const days = Math.max(1, Math.round(options.days ?? 1));
  const key = lowest ? "alertCalibration.headroom.lowest" : "alertCalibration.headroom.highest";
  return t(key, { days, value, threshold }, days);
}

/** Earlier values met an older threshold; null when no edit fell in the window. */
export const headroomEditedLine = (t: TranslateFn, headroom: Headroom): I18nText | null =>
  headroom.last_edit_micros === undefined ? null : t("alertCalibration.headroom.edited");
