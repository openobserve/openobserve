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

import type { I18nText, TranslateFn } from "@/types/i18n";
import type { BannerDraft } from "./announcementDrafts";

const STAMP: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

/** A short local stamp; `withZone` names the zone once per summary so the times are unambiguous. */
const formatStamp = (value: string, withZone = false) =>
  new Date(value).toLocaleString(undefined, withZone ? { ...STAMP, timeZoneName: "short" } : STAMP);

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** How far off an instant is, e.g. "in 23 hr." — the largest unit that is at least two. */
export function relativeTo(value: string, now: number = Date.now()): string {
  const diff = new Date(value).getTime() - now;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= 2 * ms || unit === "minute")
      return format.format(Math.round(diff / ms), unit);
  }
  return "";
}

/** When a banner shows, in words. */
export function scheduleSummary(draft: BannerDraft, t: TranslateFn): I18nText {
  const { schedule, startsAt, endsAt, duration } = draft;

  if (schedule === "duration") return t("announcements.card.forDuration", { duration });
  if (schedule === "window") {
    if (startsAt && endsAt) {
      return t("announcements.card.between", {
        from: formatStamp(startsAt),
        to: formatStamp(endsAt, true),
      });
    }
    if (startsAt) return t("announcements.card.from", { from: formatStamp(startsAt, true) });
    if (endsAt) return t("announcements.card.until", { to: formatStamp(endsAt, true) });
  }
  return t("announcements.card.always");
}

/** Who sees a banner, in words. */
export function audienceSummary(draft: BannerDraft, t: TranslateFn): I18nText {
  return draft.orgs.length
    ? t("announcements.card.someOrgs", { count: draft.orgs.length }, draft.orgs.length)
    : t("announcements.card.allOrgs");
}
