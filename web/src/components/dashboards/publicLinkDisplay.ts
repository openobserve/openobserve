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
import type { I18nText, TranslateFn } from "@/types/i18n";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import type { PublicLink } from "@/services/public_dashboards_admin";
import { formatExactDuration } from "@/utils/formatters";
import { todayIn } from "./PublicLinkForm.schema";

export interface ExpiryNote {
  text: I18nText;
  soon: boolean;
}

export function shortRange(secs: number): string {
  if (secs % 86400 === 0) return `${secs / 86400}d`;
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  return `${secs / 60}m`;
}

// 30 days is offered as "1 month", and reads the same wherever the interval is shown.
export function refreshLabel(secs: number, t: TranslateFn): I18nText {
  return secs === 2592000 ? t("dashboard.publicDashboard.refreshMonth") : formatExactDuration(secs);
}

export function publicLinkUrl(link: PublicLink): string {
  return `${window.location.origin}/web/public/dashboards/${link.slug}`;
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

export function defaultRange(link: PublicLink): number {
  return link.time_range.default_range_secs ?? link.time_range.allowed_presets_secs[0] ?? 0;
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
    col("ranges", t("dashboard.publicLinks.timeRanges"), 100),
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
