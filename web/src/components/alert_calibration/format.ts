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

import { format as formatDate } from "date-fns";
import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import {
  arrayColumn,
  coverageVerdict,
  type Confidence,
  type CoverageVerdict,
  type DigestRecord,
  type RunRow,
  type Quality,
  type Severity,
  type Tier,
} from "./digests";
import { headroomSentence, parseHeadroom } from "./headroom";
import { ERROR_CLASS_LABEL, isErrorClass, type EvidenceField, type EvidenceFormat } from "./rules";

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

/** The number and its unit apart, for a tile whose value is the number alone. */
export function splitMinutes(t: TranslateFn, minutes: number): { count: number; unit: I18nText } {
  const unit = (key: I18nKey, n: number) => ({ count: n, unit: t(key, { count: n }, n) });
  if (minutes > 0 && minutes % MINUTES_PER_YEAR === 0) {
    return unit("alertCalibration.unit.years", minutes / MINUTES_PER_YEAR);
  }
  if (minutes > 0 && minutes % MINUTES_PER_DAY === 0) {
    return unit("alertCalibration.unit.days", minutes / MINUTES_PER_DAY);
  }
  if (minutes > 0 && minutes % 60 === 0) return unit("alertCalibration.unit.hours", minutes / 60);
  return unit("alertCalibration.unit.minutes", minutes);
}

export function formatSeconds(t: TranslateFn, secs: number): I18nText {
  const rounded = Math.round(secs);
  if (rounded < 60) return t("alertCalibration.duration.seconds", { count: rounded }, rounded);
  return formatMinutes(t, Math.round(rounded / 60));
}

/** Under a minute keeps one decimal, so 29.6 s is not rounded up to the 30 s limit it missed. */
export function formatMillis(t: TranslateFn, ms: number): I18nText {
  if (ms < 1000) {
    const rounded = Math.round(ms);
    return t(
      "alertCalibration.duration.milliseconds",
      { count: rounded.toLocaleString() },
      rounded,
    );
  }
  if (ms < 60_000) {
    const secs = Math.round(ms / 100) / 10;
    const shown = secs.toLocaleString(undefined, { maximumFractionDigits: 1 });
    return t("alertCalibration.duration.seconds", { count: shown }, secs);
  }
  return formatSeconds(t, ms / 1000);
}

/** Microseconds, in the card's existing hour format. */
const formatTime = (micros: number) => formatDate(micros / 1000, "MMM d, HH:mm");

export function formatEvidence(t: TranslateFn, value: unknown, format: EvidenceFormat): I18nText {
  if (value === undefined || value === null || value === "") return raw("—");
  if (format === "ratio") return raw(`${(Number(value) * 100).toFixed(1)}%`);
  if (format === "seconds") return formatSeconds(t, Number(value));
  if (format === "count") return raw(Number(value).toLocaleString());
  if (format === "time") return raw(formatTime(Number(value)));
  if (format === "durationMs") return formatMillis(t, Number(value));
  if (format === "errorClass") return isErrorClass(value) ? t(ERROR_CLASS_LABEL[value]) : raw("—");
  if (format === "boolean") {
    return value === true || value === "true"
      ? t("alertCalibration.evidence.yes")
      : t("alertCalibration.evidence.no");
  }
  return raw(String(value));
}

const NOT_WORKING = "evidence_notworking_";
/** ENT context.rs `NEAR_LIMIT_SHARE`: a success within 20 % of the limit is near it (P7b-D2). */
const NEAR_LIMIT_SHARE = 0.8;

/** One evidence row's value; the time rows read their sibling columns from the same record. */
export function formatEvidenceField(
  t: TranslateFn,
  record: DigestRecord,
  field: EvidenceField,
): I18nText {
  const column = (name: string) => record[`${NOT_WORKING}${name}`];
  const millis = (name: string) => formatEvidence(t, column(name), "durationMs");
  if (field.format === "evaluationTimes") {
    return t("alertCalibration.evidence.successTimesValue", {
      p50: millis("ok_p50_ms"),
      p90: millis("ok_p90_ms"),
      max: millis("ok_max_ms"),
    });
  }
  if (field.format === "nearLimit") {
    const total = Number(column("ok_evaluations_timed"));
    const limitSecs = Number(column("query_limit_secs"));
    return t(
      "alertCalibration.evidence.nearLimitValue",
      {
        count: Number(record[field.column]).toLocaleString(),
        total: total.toLocaleString(),
        near: formatMillis(t, limitSecs * NEAR_LIMIT_SHARE * 1000),
      },
      total,
    );
  }
  return formatEvidence(t, record[field.column], field.format);
}

export interface ResourceOption {
  key: "window" | "filter" | "frequency";
  label: I18nText;
  cost: I18nText;
}

const positiveSecs = (value: unknown): number | null => {
  const secs = Number(value);
  return value != null && value !== "" && Number.isFinite(secs) && secs > 0 ? secs : null;
};

/** A resource card's three ways to make the query cheaper, each with what it costs in coverage. */
export function resourceOptions(t: TranslateFn, record: DigestRecord): ResourceOption[] {
  if (record.pattern !== "resource_timeout" && record.pattern !== "resource_memory") return [];
  const period = positiveSecs(record[`${NOT_WORKING}period_secs`]);
  const frequency = positiveSecs(record[`${NOT_WORKING}frequency_secs`]);
  // An unread schedule also writes neither column, which is unknown, not real-time (P7c-FU1).
  const unknownSchedule = (arrayColumn(record.quality_reasons) ?? []).includes(
    "schedule_unreadable",
  );
  const span = (secs: number) => formatSeconds(t, secs);
  let windowCost: I18nText;
  if (unknownSchedule) {
    windowCost = t("alertCalibration.resourceCost.windowCron");
  } else if (period === null) {
    windowCost = t("alertCalibration.resourceCost.windowRealTime");
  } else if (frequency === null) {
    windowCost = t("alertCalibration.resourceCost.windowCron");
  } else if (period > frequency) {
    windowCost = t("alertCalibration.resourceCost.windowOverlap", {
      period: span(period),
      overlap: span(period - frequency),
      frequency: span(frequency),
    });
  } else {
    windowCost = t("alertCalibration.resourceCost.windowGap", {
      period: span(period),
      frequency: span(frequency),
    });
  }
  const options: ResourceOption[] = [
    { key: "window", label: t("alertCalibration.resourceOption.window"), cost: windowCost },
    {
      key: "filter",
      label: t("alertCalibration.resourceOption.filter"),
      cost: t("alertCalibration.resourceCost.filter"),
    },
  ];
  // A real-time alert has no schedule, so running it less often is not an option.
  if (period !== null || unknownSchedule) {
    options.push({
      key: "frequency",
      label: t("alertCalibration.resourceOption.frequency"),
      cost:
        frequency === null
          ? t("alertCalibration.resourceCost.frequencyCron")
          : t("alertCalibration.resourceCost.frequency", { frequency: span(frequency) }),
    });
  }
  return options;
}

/** High is orange, as Incidents shows a High priority; red stays for failures and denials. */
export const SEVERITY_BADGE: Record<
  Severity,
  "orange-soft" | "warning-soft" | "primary-soft" | "default-soft"
> = {
  High: "orange-soft",
  Medium: "warning-soft",
  Low: "primary-soft",
  Info: "default-soft",
};

/** The rule icon's tile takes the severity badge's tone, so the two read as one signal. */
export const SEVERITY_TILE: Record<Severity, string> = {
  High: "bg-badge-orange-soft-bg text-badge-orange-soft-text",
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

export const TIER_LABEL: Record<Tier, I18nKey> = {
  A: "alertCalibration.tier.a",
  B: "alertCalibration.tier.b",
  C: "alertCalibration.tier.c",
};

export const TIER_HINT: Record<Tier, I18nKey> = {
  A: "alertCalibration.tierHint.a",
  B: "alertCalibration.tierHint.b",
  C: "alertCalibration.tierHint.c",
};

/** Usable evidence needs no badge; the other two say the card is weaker than it looks. */
export const QUALITY_LABEL: Record<Exclude<Quality, "usable">, I18nKey> = {
  partial: "alertCalibration.quality.partial",
  unavailable: "alertCalibration.quality.unavailable",
};

export const isDegradedQuality = (value: string | undefined): value is keyof typeof QUALITY_LABEL =>
  value !== undefined && value in QUALITY_LABEL;

const SKIP_REASON_LABEL: Record<string, I18nKey> = {
  insufficient_history: "alertCalibration.skipReason.insufficientHistory",
  insufficient_samples: "alertCalibration.skipReason.insufficientSamples",
  unmeasurable_signal: "alertCalibration.skipReason.unmeasurableSignal",
  alert_disabled: "alertCalibration.skipReason.alertDisabled",
  window_too_short: "alertCalibration.skipReason.windowTooShort",
  unsupported_mode: "alertCalibration.skipReason.unsupportedMode",
  incomplete_or_silence_censored_history:
    "alertCalibration.skipReason.incompleteOrSilenceCensoredHistory",
  no_incident_signal: "alertCalibration.skipReason.noIncidentSignal",
  sentinel_by_design: "alertCalibration.skipReason.sentinelByDesign",
  enrichment_timeout: "alertCalibration.skipReason.enrichmentTimeout",
  healthy_silence: "alertCalibration.skipReason.healthySilence",
  definition_not_checked: "alertCalibration.skipReason.definitionNotChecked",
};

/** A reason from a newer writer is named generically, never by its stored name. */
export const skipReasonLabel = (t: TranslateFn, reason: string): I18nText =>
  t(SKIP_REASON_LABEL[reason] ?? "alertCalibration.skipReason.other");

/** The signals the rules name in an `unmeasurable_signal` skip (ENT alert_calibration_rules `unmeasurable`). */
const SKIP_SIGNAL_LABEL: Record<string, I18nKey> = {
  firings: "alertCalibration.evidence.firings",
  evaluation_errors: "alertCalibration.evidence.errors",
  delay_in_secs: "alertCalibration.evidence.evaluationDelay",
  incident_linkage: "alertCalibration.evidence.incidentLinkage",
  mean_time_to_normal_secs: "alertCalibration.evidence.meanTimeToNormal",
  incident_linked_firings: "alertCalibration.evidence.incidentLinkedFirings",
  delivery_attempts: "alertCalibration.evidence.attemptedDeliveries",
  delivery_attempted: "alertCalibration.evidence.deliveryAttemptRecords",
};

/** A detail this build cannot name points to Logs, never to its stored JSON; null when there is none. */
export function skipDetailLabel(t: TranslateFn, detail: string | undefined): I18nText | null {
  if (!detail) return null;
  const headroom = parseHeadroom(detail);
  const near = headroom && headroomSentence(t, headroom, { form: "short" });
  if (near) return near;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(detail);
  } catch {
    parsed = null;
  }
  const signal =
    typeof parsed === "object" && parsed !== null && "signal" in parsed ? parsed.signal : null;
  if (typeof signal === "string" && Object.hasOwn(SKIP_SIGNAL_LABEL, signal)) {
    return t("alertCalibration.detail.declinedSignal", { signal: t(SKIP_SIGNAL_LABEL[signal]) });
  }
  return t("alertCalibration.detail.declinedDetailOther");
}

export const NOT_CHECKED_CAUSES = [
  "budget_exhausted",
  "probe_timeout",
  "probe_error",
  "probe_rejected",
  "unsupported_query",
  "other",
] as const;
export type NotCheckedCause = (typeof NOT_CHECKED_CAUSES)[number];

const NOT_CHECKED_COPY: Record<NotCheckedCause, { cause: I18nKey; next: I18nKey }> = {
  budget_exhausted: {
    cause: "alertCalibration.notChecked.cause.budgetExhausted",
    next: "alertCalibration.notChecked.next.retry",
  },
  probe_timeout: {
    cause: "alertCalibration.notChecked.cause.probeTimeout",
    next: "alertCalibration.notChecked.next.retry",
  },
  probe_error: {
    cause: "alertCalibration.notChecked.cause.probeError",
    next: "alertCalibration.notChecked.next.retry",
  },
  probe_rejected: {
    cause: "alertCalibration.notChecked.cause.probeRejected",
    next: "alertCalibration.notChecked.next.query",
  },
  unsupported_query: {
    cause: "alertCalibration.notChecked.cause.unsupportedQuery",
    next: "alertCalibration.notChecked.next.query",
  },
  other: {
    cause: "alertCalibration.notChecked.cause.other",
    next: "alertCalibration.notChecked.next.retry",
  },
};

/** The cause in a `definition_not_checked` skip's detail; one this build cannot name is `other`. */
export function notCheckedCause(detail: string | undefined): NotCheckedCause {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(detail ?? "");
  } catch {
    parsed = null;
  }
  const cause =
    typeof parsed === "object" && parsed !== null && "cause" in parsed ? parsed.cause : null;
  return typeof cause === "string" && cause !== "other" && Object.hasOwn(NOT_CHECKED_COPY, cause)
    ? (cause as NotCheckedCause)
    : "other";
}

export const notCheckedCopy = (t: TranslateFn, cause: NotCheckedCause) => ({
  cause: t(NOT_CHECKED_COPY[cause].cause),
  next: t(NOT_CHECKED_COPY[cause].next),
});

type CoverageVariant = "success-soft" | "warning-soft" | "error-soft" | "default-soft";
type CoverageTone = "success" | "warning" | "error" | "neutral";

export const COVERAGE_BADGE: Record<
  CoverageVerdict,
  {
    labelKey: I18nKey;
    /** The same verdict where a "Coverage" label already names it. */
    shortKey: I18nKey;
    variant: CoverageVariant;
    tone: CoverageTone;
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

/** A run's coverage badge; full coverage of no alert at all is not a healthy state, so it is neutral. */
export const coverageBadge = (
  run: Pick<RunRow, "coverage_gap" | "coverage_stream_substrate_empty" | "alerts_in_scope">,
) => {
  const verdict = coverageVerdict(run as RunRow);
  const badge = COVERAGE_BADGE[verdict];
  return verdict === "full" && run.alerts_in_scope === 0
    ? { ...badge, variant: "default-soft" as const, tone: "neutral" as const }
    : badge;
};
