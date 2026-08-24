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
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { I18nKey } from "@/types/i18n";
import type { StatusPageHealth, StatusPageVisibility } from "@/services/status_pages";

// Same health vocabulary as the rest of the app: green = operational,
// red = outage, amber = degraded, blue = maintenance, neutral = unknown.
export function healthBadge(health: StatusPageHealth): {
  variant: BadgeVariant;
  labelKey: I18nKey;
} {
  switch (health) {
    case "operational":
      return { variant: "success-soft", labelKey: "statusPages.health.operational" };
    case "degraded":
      return { variant: "warning-soft", labelKey: "statusPages.health.degraded" };
    case "partial_outage":
      return { variant: "error-soft", labelKey: "statusPages.health.partialOutage" };
    case "major_outage":
      return { variant: "error-soft", labelKey: "statusPages.health.majorOutage" };
    case "maintenance":
      return { variant: "blue-soft", labelKey: "statusPages.health.maintenance" };
    default:
      return { variant: "default-soft", labelKey: "statusPages.health.noData" };
  }
}

export function visibilityBadge(visibility: StatusPageVisibility): {
  variant: BadgeVariant;
  labelKey: I18nKey;
} {
  switch (visibility) {
    case 1:
      return { variant: "success-outline", labelKey: "statusPages.visibility.public" };
    case 2:
      return { variant: "warning-outline", labelKey: "statusPages.visibility.password" };
    default:
      return { variant: "default-outline", labelKey: "statusPages.visibility.draft" };
  }
}

// The public page is served at /status/{slug} from basic_routes() — at the app
// origin root, NOT under the /web/ SPA (which would 404 in the Vue router).
export function publicStatusPageUrl(slug: string): string {
  return `${window.location.origin}/status/${slug}`;
}

// impact: 0 none, 1 degraded, 2 partial_outage, 3 major_outage.
export function impactBadge(impact: number): {
  variant: BadgeVariant;
  labelKey: I18nKey;
} {
  switch (impact) {
    case 1:
      return { variant: "warning-soft", labelKey: "statusPages.postUpdate.impactDegraded" };
    case 2:
      return { variant: "error-soft", labelKey: "statusPages.postUpdate.impactPartial" };
    case 3:
      return { variant: "error-soft", labelKey: "statusPages.postUpdate.impactMajor" };
    default:
      return { variant: "default-soft", labelKey: "statusPages.health.operational" };
  }
}

// state: 0 scheduled, 1 active, 2 resolved.
export function noticeStateBadge(state: number): {
  variant: BadgeVariant;
  labelKey: I18nKey;
} {
  switch (state) {
    case 0:
      return { variant: "default-outline", labelKey: "statusPages.notices.state.scheduled" };
    case 1:
      return { variant: "error-outline", labelKey: "statusPages.notices.state.active" };
    default:
      return { variant: "success-outline", labelKey: "statusPages.notices.state.resolved" };
  }
}
