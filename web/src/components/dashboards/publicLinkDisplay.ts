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

import { formatInTimeZone } from "date-fns-tz";
import { raw, type I18nText, type TranslateFn } from "@/types/i18n";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { PublicLink, PublicLinkRange } from "@/services/public_dashboards_admin";
import { formatExactDuration } from "@/utils/formatters";
import { getPath } from "@/utils/zincutils";
import { rangeKey, todayIn } from "./PublicLinkForm.schema";

export interface ExpiryNote {
  text: I18nText;
  soon: boolean;
}

// A month is 30 days, as in the dashboard time picker.
const RELATIVE_UNITS = [
  { secs: 2_592_000, short: "mo", long: "dashboard.publicDashboard.pastMonths" },
  { secs: 604_800, short: "w", long: "dashboard.publicDashboard.pastWeeks" },
  { secs: 86_400, short: "d", long: "dashboard.publicDashboard.pastDays" },
  { secs: 3_600, short: "h", long: "dashboard.publicDashboard.pastHours" },
  { secs: 60, short: "m", long: "dashboard.publicDashboard.pastMinutes" },
] as const;

function relativeUnit(secs: number) {
  return RELATIVE_UNITS.find((u) => secs % u.secs === 0) ?? RELATIVE_UNITS[4];
}

// The year shows only when it isn't the current one, so recent windows stay short.
function shortDate(micros: number, timezone: string): string {
  const ms = micros / 1000;
  const sameYear =
    formatInTimeZone(ms, timezone, "yyyy") === formatInTimeZone(Date.now(), timezone, "yyyy");
  return formatInTimeZone(ms, timezone, sameYear ? "d MMM" : "d MMM yyyy");
}

/** `2w`, `3mo`, or `1 Sept → 30 Sept` for the chips and list columns. */
export function shortRange(range: PublicLinkRange, timezone: string): string {
  if (range.type === "absolute") {
    return `${shortDate(range.start, timezone)} → ${shortDate(range.end, timezone)}`;
  }
  const unit = relativeUnit(range.secs);
  return `${range.secs / unit.secs}${unit.short}`;
}

/** `Past 2 weeks`, or the full start and end with times. */
export function longRange(range: PublicLinkRange, t: TranslateFn, timezone: string): I18nText {
  if (range.type === "absolute") {
    const fmt = (micros: number) => formatInTimeZone(micros / 1000, timezone, "d MMM yyyy, HH:mm");
    return raw(`${fmt(range.start)} → ${fmt(range.end)}`);
  }
  const unit = relativeUnit(range.secs);
  const n = range.secs / unit.secs;
  return t(unit.long, { n }, n);
}

// 30 days is offered as "1 month", and reads the same wherever the interval is shown.
export function refreshLabel(secs: number, t: TranslateFn): I18nText {
  return secs === 2592000 ? t("dashboard.publicDashboard.refreshMonth") : formatExactDuration(secs);
}

// Under the router's base, so a server with ZO_BASE_URI (e.g. /o2/web/) gets a working link.
export function publicLinkUrl(link: PublicLink): string {
  return new URL(`public/dashboards/${link.slug}`, window.location.origin + (getPath() || "/"))
    .href;
}

// Whole calendar days in the viewer's timezone, so "today" flips at their midnight.
export function publicLinkExpiry(
  link: PublicLink,
  timezone: string,
  t: TranslateFn,
): ExpiryNote | null {
  if (!link.expires_at || link.status === "expired") return null;
  const end = formatInTimeZone(link.expires_at / 1000, timezone, "yyyy-MM-dd");
  const days = Math.round((Date.parse(end) - Date.parse(todayIn(timezone))) / 86_400_000);
  if (days <= 0) return { text: t("dashboard.publicLinks.expiresToday"), soon: true };
  return { text: t("dashboard.publicLinks.expiresInDays", { n: days }, days), soon: false };
}

// A pasted public URL is matched by its slug, the only part of it that identifies the link.
/** The plain message for a refused public-link write, or null when the error isn't a 403. */
export function forbiddenMessage(
  e: unknown,
  t: TranslateFn,
  missingPermission: I18nText,
): I18nText | null {
  const response = (e as { response?: { status?: number; data?: { message?: unknown } } } | null)
    ?.response;
  if (response?.status !== 403) return null;
  // The dashboard edit-access check answers with a JSON message; a missing role permission doesn't.
  const message = response.data?.message;
  return typeof message === "string" && message.includes("edit access")
    ? t("dashboard.publicLinks.editAccessRequired")
    : missingPermission;
}

export function publicLinkSearchTerm(input: string): string {
  const q = input.trim();
  return (q.match(/\/public\/dashboards\/([^/?#\s]+)/)?.[1] ?? q).toLowerCase();
}

export function hasRelativeRange(link: PublicLink): boolean {
  return link.time_range.ranges.some((r) => r.type === "relative");
}

/** Only absolute ranges wait for a rebuild; a paused link builds nothing. */
export function canRebuild(link: PublicLink): boolean {
  return link.enabled && link.time_range.ranges.some((r) => r.type === "absolute");
}

export function isDefaultRange(link: PublicLink, range: PublicLinkRange): boolean {
  return rangeKey(range) === rangeKey(link.time_range.default);
}

/** The columns every public link table shows; the org-wide list adds the link's folder and dashboard. */
export function publicLinkColumns(
  t: TranslateFn,
  opts: { withDashboard?: boolean } = {},
): OTableColumnDef[] {
  const col = (id: string, header: I18nText, size: number, accessorKey?: string) => ({
    id,
    header,
    accessorKey,
    sortable: accessorKey !== undefined,
    resizable: true,
    hideable: true,
    size,
    meta: { align: "left" as const },
  });
  return [
    {
      id: "name",
      header: t("dashboard.publicLinks.name"),
      accessorKey: "name",
      sortable: true,
      resizable: true,
      size: 200,
      minSize: 100,
      meta: { align: "left", flex: true },
    },
    ...(opts.withDashboard
      ? [
          {
            id: "dashboard",
            header: t("dashboard.publicLinks.folderDashboard"),
            accessorFn: (link: PublicLink) =>
              `${link.folder_name ?? ""} / ${link.dashboard_title ?? ""}`.toLowerCase(),
            sortable: true,
            resizable: true,
            hideable: true,
            size: 150,
            meta: { align: "left" as const },
          },
        ]
      : []),
    col("status", t("dashboard.publicLinks.status"), 110, "status"),
    col("ranges", t("dashboard.publicLinks.timeRanges"), 190),
    col("refresh", t("dashboard.publicLinks.refresh"), 90, "rebuild_secs"),
    col("expires", t("dashboard.publicLinks.expires"), 115, "expires_at"),
    col("updated", t("dashboard.publicLinks.updated"), 120, "last_rebuilt_at"),
    col("published_by", t("dashboard.publicLinks.publishedBy"), 150, "published_by"),
    {
      id: "actions",
      header: t("dashboard.actions"),
      isAction: true,
      sortable: false,
      size: 150,
      meta: { align: "center", actionCount: 5 },
    },
  ];
}
