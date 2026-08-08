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

/**
 * The one place that decides which announcement banners render, and in what
 * order.
 *
 * Shared by the live bar and by the settings preview so the two cannot drift:
 * a preview that ordered banners differently from the real thing is worse than
 * no preview, because it is confidently wrong.
 */

export type BannerVariantName = "info" | "warning" | "critical" | "promo";

/** The only field ordering depends on, so both the wire and draft shapes fit. */
export interface OrderableBanner {
  variant?: string | null;
}

/** Higher sorts first. Mirrors `BannerVariant::rank` on the server. */
export function bannerRank(variant?: string | null): number {
  switch (variant) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "promo":
      return 0;
    // Anything unrecognised is treated as the default variant rather than
    // dropped — a banner authored against a newer schema still gets seen.
    default:
      return 1;
  }
}

/**
 * Severity order, then the promo rule: a marketing banner is hidden while a
 * critical one is up, because a webinar ad beside an outage notice reads badly.
 *
 * The sort is stable, so banners of equal severity keep the order they arrived
 * in — which for the live bar is the server's `starts_at` tiebreak.
 */
export function orderBanners<T extends OrderableBanner>(banners: T[]): T[] {
  const hasCritical = banners.some((banner) => banner.variant === "critical");
  const visible = hasCritical ? banners.filter((banner) => banner.variant !== "promo") : banners;

  return [...visible].sort((a, b) => bannerRank(b.variant) - bannerRank(a.variant));
}
