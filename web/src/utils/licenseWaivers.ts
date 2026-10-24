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

import type { TranslateFn, I18nText } from "@/types/i18n";

export interface LicenseWaiver {
  id: string;
  type: string;
  extra?: number;
  limit?: { typ: "Unlimited" | "PerDayCount"; value: number };
  starts_at: number;
  ends_at: number;
  installation_id?: string;
  note: string;
}

export type RevReason = "rev_rollback" | "rev_conflict" | "superseded";

export interface RevRefusal {
  code: 409;
  reason: RevReason;
  message: string;
  license_id: string;
  loaded_rev: number | null;
  pasted_rev: number;
}

export interface KeyCheckResult {
  dry_run: true;
  outcome: "accept" | RevReason | "env_key_conflict";
  message: string;
  license_id: string;
  same_license: boolean;
  loaded_rev: number | null;
  pasted_rev: number;
  waivers_added: LicenseWaiver[];
  waivers_removed: LicenseWaiver[];
}

export interface RevHwmWarning {
  source: "env" | "db";
  license_id: string;
  loaded_rev: number;
  hwm_rev: number;
}

export type LicenseBlock = "usage_over_limit" | "report_failure" | "lv_verdict" | "unknown";

export interface LicenseDecision {
  search_allowed: boolean;
  blocks: LicenseBlock[];
  exceeded_days: number;
  allowed_days: number;
  limit_today_gb: number | null;
  used_today_gb: number;
  waiver_ids_applied: string[];
}

export interface LicenseWaiverFields {
  rev_hwm_warning?: RevHwmWarning | null;
  waivers?: LicenseWaiver[];
  decision?: LicenseDecision;
  base?: LicenseDecision;
  /** 0 until the backend has evaluated the licence itself; its decision then holds only search state. */
  evaluated_at?: number;
  env_key_active?: boolean;
  env_key_in_use?: boolean;
  can_update_license?: boolean;
}

export type WaiverStatus = "scheduled" | "active" | "past" | "ended";

export type LicenseBannerState =
  { kind: "none" } | { kind: "paused" } | { kind: "restored"; untilUs: number; endsSoon: boolean };

export const DAY_US = 86_400_000_000;
export const LICENSE_REFRESH_SETTLE_MS = 15_000;
export const LICENSE_BANNER_POLL_MS = 300_000;
/** Longer delays overflow setTimeout and fire at once, so far boundaries are re-armed in steps. */
export const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const KNOWN_WAIVER_TYPES = ["search_unblock", "ingestion_limit", "breach_days", "report_grace"];

/** Drops kinds this release cannot render, so a newer server never breaks the list. */
export function knownWaivers(ws: LicenseWaiver[] | undefined): LicenseWaiver[] {
  return (ws ?? []).filter((w) => KNOWN_WAIVER_TYPES.includes(w.type));
}

export function waiverStatus(w: LicenseWaiver, nowUs: number): WaiverStatus {
  if (nowUs < w.starts_at) return "scheduled";
  if (w.type === "breach_days" && nowUs >= breachRetentionEndUs(w)) return "ended";
  if (nowUs >= w.ends_at) return isDayWaiver(w) ? "past" : "ended";
  return "active";
}

/** Lands 1 ms past `nextUs`, so a strict comparison at the boundary has already flipped. */
export function boundaryDelayMs(nextUs: number, nowUs: number): number {
  return Math.min(Math.ceil((nextUs - nowUs) / 1000) + 1, MAX_TIMEOUT_MS);
}

/** `ends_at` is exclusive, so the last day a day-kind waiver covers is the one before it. */
export function lastCoveredDayUs(w: LicenseWaiver): number {
  return w.ends_at - DAY_US;
}

export function formatUtc(us: number, locale: string, withTime: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : {}),
  }).format(new Date(us / 1000));
}

export function quotaPercent(d: LicenseDecision): number | null {
  if (d.limit_today_gb == null || d.limit_today_gb <= 0) return null;
  return Math.round((d.used_today_gb / d.limit_today_gb) * 100);
}

export function licenseExpiryState(
  zo: Record<string, unknown>,
  env: string | undefined,
  nowUs: number,
): { kind: "none" } | { kind: "expiring"; untilUs: number; online: boolean } {
  const untilUs = zo.license_expiry;
  if (
    typeof untilUs !== "number" ||
    !Number.isFinite(untilUs) ||
    untilUs <= nowUs ||
    untilUs - nowUs > 30 * DAY_US
  )
    return { kind: "none" };
  return { kind: "expiring", untilUs, online: env === "online" };
}

export function licenseBannerState(zo: Record<string, unknown>, nowUs: number): LicenseBannerState {
  if (zo.license_search_allowed === false) return { kind: "paused" };
  const until = zo.license_waiver_until;
  if (zo.license_search_allowed === true && typeof until === "number" && until > nowUs) {
    return { kind: "restored", untilUs: until, endsSoon: until - nowUs < DAY_US };
  }
  return { kind: "none" };
}

export function bannerSignature(s: LicenseBannerState): string {
  return s.kind === "restored" ? `restored:${s.untilUs}:${s.endsSoon}` : s.kind;
}

export function activeSearchUnblock(
  ws: LicenseWaiver[] | undefined,
  nowUs: number,
): LicenseWaiver | undefined {
  return knownWaivers(ws)
    .filter((w) => w.type === "search_unblock" && waiverStatus(w, nowUs) === "active")
    .sort((a, b) => b.ends_at - a.ends_at)[0];
}

export function issuedOn(rev: number, locale: string): string {
  if (!rev) return "";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(rev / 1000));
}

export function isRevRefusal(data: unknown): data is RevRefusal {
  if (!data || typeof data !== "object") return false;
  return (
    "code" in data &&
    data.code === 409 &&
    "reason" in data &&
    ["rev_rollback", "rev_conflict", "superseded"].includes(String(data.reason)) &&
    "message" in data &&
    typeof data.message === "string" &&
    "license_id" in data &&
    typeof data.license_id === "string" &&
    "loaded_rev" in data &&
    (data.loaded_rev === null || isRevision(data.loaded_rev)) &&
    "pasted_rev" in data &&
    isRevision(data.pasted_rev)
  );
}

export function isKeyCheckResult(data: unknown): data is KeyCheckResult {
  if (!data || typeof data !== "object") return false;
  return (
    "dry_run" in data &&
    data.dry_run === true &&
    "outcome" in data &&
    ["accept", "rev_rollback", "rev_conflict", "superseded", "env_key_conflict"].includes(
      String(data.outcome),
    ) &&
    "message" in data &&
    typeof data.message === "string" &&
    "license_id" in data &&
    typeof data.license_id === "string" &&
    "same_license" in data &&
    typeof data.same_license === "boolean" &&
    "loaded_rev" in data &&
    (data.loaded_rev === null || isRevision(data.loaded_rev)) &&
    "pasted_rev" in data &&
    isRevision(data.pasted_rev) &&
    "waivers_added" in data &&
    isWaiverList(data.waivers_added) &&
    "waivers_removed" in data &&
    isWaiverList(data.waivers_removed)
  );
}

export function isDayWaiver(w: LicenseWaiver): boolean {
  return w.type === "ingestion_limit" || w.type === "breach_days";
}

export function breachRetentionEndUs(w: LicenseWaiver): number {
  const last = new Date(lastCoveredDayUs(w) / 1000);
  return Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1) * 1000;
}

export function waiverKindLabel(w: LicenseWaiver, t: TranslateFn, locale = "en-US"): I18nText {
  if (w.type === "search_unblock") return t("about.waiver_kind_search_unblock");
  if (w.type === "report_grace")
    return t("about.waiver_kind_report_grace", { end: formatUtc(w.ends_at, locale, true) });
  if (w.type === "breach_days") {
    if (!hasValidBreachExtra(w)) return t("about.waiver_kind_breach_unknown");
    return t(
      "about.waiver_kind_breach_days",
      { count: w.extra, month: coveredMonths(w, locale, "short") },
      w.extra,
    );
  }
  if (w.limit?.typ === "Unlimited") return t("about.waiver_kind_ingestion_unlimited");
  return t("about.waiver_kind_ingestion_limit", { limit: w.limit?.value ?? 0 });
}

export function waiverWindowLabel(w: LicenseWaiver, locale: string, t: TranslateFn): I18nText {
  if (w.type === "search_unblock")
    return t("about.waiver_window_until", { end: formatUtc(w.ends_at, locale, true) });
  if (w.type === "report_grace")
    return t("about.waiver_window_time", {
      start: formatUtc(w.starts_at, locale, true),
      end: formatUtc(w.ends_at, locale, true),
    });
  return t(
    w.type === "breach_days" ? "about.waiver_window_covered_days" : "about.waiver_window_days",
    {
      start: formatUtc(w.starts_at, locale, false),
      end: formatUtc(lastCoveredDayUs(w), locale, false),
    },
  );
}

export function waiverSummary(
  w: LicenseWaiver,
  nowUs: number,
  locale: string,
  t: TranslateFn,
): I18nText | undefined {
  if (w.type === "report_grace") {
    if (nowUs < w.starts_at)
      return t("about.waiver_grace_scheduled", {
        start: formatUtc(w.starts_at, locale, false),
        time: formatUtcTime(w.starts_at, locale),
      });
    return t(nowUs < w.ends_at ? "about.waiver_grace_active" : "about.waiver_grace_ended", {
      end: formatUtc(w.ends_at, locale, false),
      time: formatUtcTime(w.ends_at, locale),
    });
  }
  if (w.type === "breach_days") return breachSummary(w, nowUs, locale, t);
  return undefined;
}

function formatUtcTime(us: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(us / 1000));
}

function hasValidBreachExtra(w: LicenseWaiver): w is LicenseWaiver & { extra: number } {
  return typeof w.extra === "number" && Number.isInteger(w.extra) && w.extra >= 1 && w.extra <= 5;
}

function coveredMonths(w: LicenseWaiver, locale: string, month: "short" | "long"): string {
  const first = new Date(w.starts_at / 1000);
  const last = new Date(lastCoveredDayUs(w) / 1000);
  const format = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    month,
    ...(first.getUTCFullYear() !== last.getUTCFullYear() ? { year: "numeric" as const } : {}),
  });
  const start = format.format(first);
  const end = format.format(last);
  return start === end ? start : format.formatRange(first, last);
}

function breachSummary(w: LicenseWaiver, nowUs: number, locale: string, t: TranslateFn): I18nText {
  if (!hasValidBreachExtra(w)) return t("about.waiver_details_unknown");
  const retainedUntil = breachRetentionEndUs(w);
  const month = coveredMonths(w, locale, "long");
  const end = formatUtc(retainedUntil - DAY_US, locale, false);
  if (nowUs >= retainedUntil)
    return t("about.waiver_breach_ended", { month, end: formatUtc(retainedUntil, locale, true) });
  if (nowUs >= w.ends_at)
    return t("about.waiver_breach_retained", { count: w.extra, end }, w.extra);
  if (nowUs < w.starts_at)
    return t(
      "about.waiver_breach_scheduled",
      { count: w.extra, month, start: formatUtc(w.starts_at, locale, false) },
      w.extra,
    );
  const first = new Date(w.starts_at / 1000);
  const last = new Date(lastCoveredDayUs(w) / 1000);
  const sameMonth =
    first.getUTCMonth() === last.getUTCMonth() && first.getUTCFullYear() === last.getUTCFullYear();
  return t(
    sameMonth ? "about.waiver_breach_active" : "about.waiver_breach_months",
    { count: w.extra, end },
    w.extra,
  );
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isWaiverList(value: unknown): value is LicenseWaiver[] {
  return (
    Array.isArray(value) &&
    value.every((w: unknown) => {
      if (!w || typeof w !== "object") return false;
      return (
        "id" in w &&
        typeof w.id === "string" &&
        "type" in w &&
        typeof w.type === "string" &&
        "note" in w &&
        typeof w.note === "string" &&
        "starts_at" in w &&
        isRevision(w.starts_at) &&
        "ends_at" in w &&
        isRevision(w.ends_at) &&
        (!("limit" in w) ||
          w.limit === undefined ||
          (w.limit !== null &&
            typeof w.limit === "object" &&
            "typ" in w.limit &&
            ["Unlimited", "PerDayCount"].includes(String(w.limit.typ)) &&
            "value" in w.limit &&
            typeof w.limit.value === "number"))
      );
    })
  );
}
