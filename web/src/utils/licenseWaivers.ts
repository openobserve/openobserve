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

export interface LicenseWaiver {
  id: string;
  type: string;
  limit?: { typ: "Unlimited" | "PerDayCount"; value: number };
  starts_at: number;
  ends_at: number;
  installation_id?: string;
  note: string;
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
  waivers?: LicenseWaiver[];
  decision?: LicenseDecision;
  base?: LicenseDecision;
  /** 0 until the backend has evaluated the licence itself; its decision then holds only search state. */
  evaluated_at?: number;
  env_key_active?: boolean;
}

export type WaiverStatus = "scheduled" | "active" | "past" | "ended";

export type LicenseBannerState =
  { kind: "none" } | { kind: "paused" } | { kind: "restored"; untilUs: number; endsSoon: boolean };

export const DAY_US = 86_400_000_000;
export const LICENSE_REFRESH_SETTLE_MS = 15_000;
export const LICENSE_BANNER_POLL_MS = 300_000;

const KNOWN_WAIVER_TYPES = ["search_unblock", "ingestion_limit"];

/** Drops kinds this release cannot render, so a newer server never breaks the list. */
export function knownWaivers(ws: LicenseWaiver[] | undefined): LicenseWaiver[] {
  return (ws ?? []).filter((w) => KNOWN_WAIVER_TYPES.includes(w.type));
}

export function waiverStatus(w: LicenseWaiver, nowUs: number): WaiverStatus {
  if (nowUs < w.starts_at) return "scheduled";
  if (nowUs >= w.ends_at) return w.type === "search_unblock" ? "ended" : "past";
  return "active";
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
