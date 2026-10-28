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
import type {
  PublicLink,
  PublicLinkRange,
  PublicLinkRangeStatus,
  PublicLinkStatus,
  PublicLinkStatusReport,
} from "@/services/public_dashboards_admin";
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
/** A window in a printed dashboard's form, `2026/10/19 15:35 - 2026/10/19 15:37`; dates only when short. */
export function printedWindow(
  startMs: number,
  endMs: number,
  timezone: string,
  dateOnly = false,
): string {
  const pattern = dateOnly ? "yyyy/MM/dd" : "yyyy/MM/dd HH:mm";
  return `${formatInTimeZone(startMs, timezone, pattern)} - ${formatInTimeZone(endMs, timezone, pattern)}`;
}

/** `2w`, `3mo`, or `2026/09/01 - 2026/09/30` for the chips and list columns. */
export function shortRange(range: PublicLinkRange, timezone: string): string {
  if (range.type === "absolute") {
    return printedWindow(range.start / 1000, range.end / 1000, timezone, true);
  }
  const unit = relativeUnit(range.secs);
  return `${range.secs / unit.secs}${unit.short}`;
}

/** `Past 2 weeks`, or the full start and end with times. */
export function longRange(range: PublicLinkRange, t: TranslateFn, timezone: string): I18nText {
  if (range.type === "absolute") {
    return raw(printedWindow(range.start / 1000, range.end / 1000, timezone));
  }
  const unit = relativeUnit(range.secs);
  const n = range.secs / unit.secs;
  return t(unit.long, { n }, n);
}

// Under the router's base, so a server with ZO_BASE_URI (e.g. /o2/web/) gets a working link.
// Null when the server hid the slug because the caller can't read the link's dashboard.
export function publicLinkUrl(link: PublicLink): string | null {
  if (!link.slug) return null;
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

// Offered on every link with a dashboard; a paused or expired one gets the server's reason.
/**
 * The server hid the slug because the caller can't read the link's dashboard, so it
 * refuses every change to the link too (403). A deleted dashboard also hides its
 * slug, but revoking that orphan stays allowed, so it is not counted here.
 */
export function noDashboardAccess(link: PublicLink): boolean {
  return !link.slug && link.status !== "dashboard_deleted";
}

export function canRefresh(link: PublicLink): boolean {
  return link.status !== "dashboard_deleted";
}

/** The state the link row itself gives: a live link nobody has opened yet is "never viewed". */
export function lifecycleStatus(link: PublicLink): PublicLinkStatus {
  return link.status === "live" && !link.access_count ? "not_viewed" : link.status;
}

function attentionRanges(report: PublicLinkStatusReport | undefined): PublicLinkRangeStatus[] {
  return (report?.ranges ?? []).filter((r) => r.state === "needs_attention");
}

/** The lifecycle state, raised to "needs attention" when the owning querier reports a failed or withheld build. */
export function displayStatus(
  link: PublicLink,
  report: PublicLinkStatusReport | undefined,
): PublicLinkStatus {
  const status = lifecycleStatus(link);
  return status === "live" && attentionRanges(report).length ? "needs_attention" : status;
}

/** Panels a range can't show; the withheld list and the count can overlap, so the larger one counts. */
export function unavailablePanels(range: PublicLinkRangeStatus): number {
  return Math.max(range.unavailable_count ?? 0, range.withheld_panels?.length ?? 0);
}

/** Why one range needs attention: a failed build, else the panels it can't show. */
export function rangeAttentionReason(
  range: PublicLinkRangeStatus,
  t: TranslateFn,
): I18nText | null {
  if (range.state !== "needs_attention") return null;
  if (range.last_error) return t("dashboard.publicLinks.attentionBuildFailed");
  const count = unavailablePanels(range);
  return t("dashboard.publicLinks.attentionPanels", { count }, count);
}

/** Why a link needs attention, for the tooltip on its badge. */
export function attentionReason(
  report: PublicLinkStatusReport | undefined,
  t: TranslateFn,
): I18nText | null {
  const ranges = attentionRanges(report);
  if (!ranges.length) return null;
  const failed = ranges.find((r) => r.last_error);
  if (failed) return rangeAttentionReason(failed, t);
  return rangeAttentionReason(
    ranges.reduce((a, b) => (unavailablePanels(b) > unavailablePanels(a) ? b : a)),
    t,
  );
}

/** The tooltip on a link's status tag: the org-wide switch is off, else why it needs attention. */
export function statusReason(
  link: PublicLink,
  report: PublicLinkStatusReport | undefined,
  t: TranslateFn,
): I18nText | null {
  if (link.status === "disabled") return t("dashboard.publicLinks.orgDisabledHint");
  return attentionReason(report, t);
}

// Expired and orphaned links can't be resumed, so their pause toggle is disabled.
export function canPause(link: PublicLink): boolean {
  return link.status !== "expired" && link.status !== "dashboard_deleted";
}

/** Any member who isn't the publisher may take over a link that can still serve. */
export function canTakeOver(link: PublicLink, userId: string): boolean {
  // Basic-auth login keeps the email as typed, while published_by holds the stored one.
  return canPause(link) && link.published_by.toLowerCase() !== userId.toLowerCase();
}

// A departed publisher's paused link can't be resumed, so taking it over is the way back.
export function takeOverReplacesResume(link: PublicLink, userId: string): boolean {
  return canTakeOver(link, userId) && link.publisher_left && !link.enabled;
}

/** The message for a refused takeover; a 409 means someone else took the link over first. */
export function takeOverError(e: unknown, t: TranslateFn): I18nText {
  const refused = forbiddenMessage(e, t, t("dashboard.publicLinks.takeOverForbidden"));
  if (refused) return refused;
  const response = (e as { response?: { status?: number; data?: { message?: unknown } } } | null)
    ?.response;
  const message = response?.data?.message;
  if (typeof message === "string" && message) return raw(message);
  return response?.status === 409
    ? t("dashboard.publicLinks.takeOverConflict")
    : t("dashboard.publicLinks.actionFailed");
}

export function pauseBlockedReason(link: PublicLink, t: TranslateFn): I18nText {
  return link.status === "expired"
    ? t("dashboard.publicLinks.pauseExpired")
    : t("dashboard.publicLinks.dashboardDeletedAction");
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
    col("status", t("dashboard.publicLinks.status"), 120, "status"),
    col("ranges", t("dashboard.publicLinks.timeRanges"), 250),
    col("expires", t("dashboard.publicLinks.expires"), 115, "expires_at"),
    col(
      "last_viewed",
      t("dashboard.publicLinks.lastViewed"),
      opts.withDashboard ? 170 : 120,
      "last_accessed_at",
    ),
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
