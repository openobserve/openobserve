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
import type { PublicLink } from "@/services/public_dashboards_admin";
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
