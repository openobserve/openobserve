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

import { format } from "date-fns";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { Confidence, CoverageVerdict, Severity } from "./digests";
import type { EvidenceFormat } from "./rules";

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_YEAR = 365 * MINUTES_PER_DAY;

/** The largest whole unit, so a cadence reads "7 days" rather than "10080 minutes". */
export function formatMinutes(t: TranslateFn, minutes: number): I18nText {
  const count = (key: I18nKey, n: number) => t(key, { count: n }, n);
  if (minutes > 0 && minutes % MINUTES_PER_YEAR === 0) {
    return count("alertCalibration.duration.years", minutes / MINUTES_PER_YEAR);
  }
  if (minutes > 0 && minutes % MINUTES_PER_DAY === 0) {
    return count("alertCalibration.duration.days", minutes / MINUTES_PER_DAY);
  }
  if (minutes > 0 && minutes % 60 === 0)
    return count("alertCalibration.duration.hours", minutes / 60);
  return count("alertCalibration.duration.minutes", minutes);
}

/** A run as one line: its window, ending at the run's time, as "Sep 15 → Oct 15, 23:14". */
export const formatWindow = (startMicros: number, endMicros: number): I18nText =>
  raw(`${format(startMicros / 1000, "MMM d")} → ${format(endMicros / 1000, "MMM d, HH:mm")}`);

export function formatSeconds(t: TranslateFn, secs: number): I18nText {
  const rounded = Math.round(secs);
  if (rounded < 60) return t("alertCalibration.duration.seconds", { count: rounded }, rounded);
  return formatMinutes(t, Math.round(rounded / 60));
}

export function formatEvidence(t: TranslateFn, value: unknown, format: EvidenceFormat): I18nText {
  if (value === undefined || value === null || value === "") return raw("—");
  if (format === "ratio") return raw(`${(Number(value) * 100).toFixed(1)}%`);
  if (format === "seconds") return formatSeconds(t, Number(value));
  if (format === "count") return raw(Number(value).toLocaleString());
  if (format === "boolean") {
    return value === true || value === "true"
      ? t("alertCalibration.evidence.yes")
      : t("alertCalibration.evidence.no");
  }
  return raw(String(value));
}

export const SEVERITY_BADGE: Record<
  Severity,
  "error-soft" | "warning-soft" | "primary-soft" | "default-soft"
> = {
  High: "error-soft",
  Medium: "warning-soft",
  Low: "primary-soft",
  Info: "default-soft",
};

/** The rule icon's tile takes the severity badge's tone, so the two read as one signal. */
export const SEVERITY_TILE: Record<Severity, string> = {
  High: "bg-badge-error-soft-bg text-badge-error-soft-text",
  Medium: "bg-badge-warning-soft-bg text-badge-warning-soft-text",
  Low: "bg-badge-primary-soft-bg text-badge-primary-soft-text",
  Info: "bg-badge-default-soft-bg text-badge-default-soft-text",
};

export const SEVERITY_LABEL: Record<Severity, I18nKey> = {
  High: "alertCalibration.severity.high",
  Medium: "alertCalibration.severity.medium",
  Low: "alertCalibration.severity.low",
  Info: "alertCalibration.severity.info",
};

export const CONFIDENCE_LABEL: Record<Confidence, I18nKey> = {
  High: "alertCalibration.confidence.high",
  Medium: "alertCalibration.confidence.medium",
  Low: "alertCalibration.confidence.low",
};

export const COVERAGE_BADGE: Record<
  CoverageVerdict,
  {
    labelKey: I18nKey;
    /** The same verdict where a "Coverage" label already names it. */
    shortKey: I18nKey;
    variant: "success-soft" | "warning-soft" | "error-soft";
    tone: "success" | "warning" | "error";
  }
> = {
  full: {
    labelKey: "alertCalibration.coverage.full",
    shortKey: "alertCalibration.coverage.fullShort",
    variant: "success-soft",
    tone: "success",
  },
  gap: {
    labelKey: "alertCalibration.coverage.gap",
    shortKey: "alertCalibration.coverage.gapShort",
    variant: "warning-soft",
    tone: "warning",
  },
  none: {
    labelKey: "alertCalibration.coverage.none",
    shortKey: "alertCalibration.coverage.noneShort",
    variant: "error-soft",
    tone: "error",
  },
};
