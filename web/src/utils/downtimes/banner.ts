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
import { raw } from "@/types/i18n";
import type { TargetModule } from "@/services/downtimes";
import { formatDuration } from "./schedule";
import { MODULE_SHORT_KEYS } from "./targetSummary";

export interface BannerCount {
  module: string;
  count: number;
}

const MINUTE_SECS = 60;
const HOUR_SECS = 3600;

const DOWNTIME_BANNER_PREFIX = "downtime:";

/** "ends in 2 h 15 min", "ends in 5 minutes", "ends in less than a minute", or "ended"; minutes round down. */
export function countdownText(remainingSecs: number, t: TranslateFn, first = false): I18nText {
  if (remainingSecs <= 0) return t("alerts.downtimes.banner.ended");
  if (remainingSecs < MINUTE_SECS) {
    return first
      ? t("alerts.downtimes.banner.firstEndsInUnderMinute")
      : t("alerts.downtimes.banner.endsInUnderMinute");
  }
  const minutes = Math.floor(remainingSecs / MINUTE_SECS);
  if (remainingSecs < HOUR_SECS) {
    return first
      ? t("alerts.downtimes.banner.firstEndsInMinutes", { count: minutes }, minutes)
      : t("alerts.downtimes.banner.endsInMinutes", { count: minutes }, minutes);
  }
  const duration = formatDuration(minutes * MINUTE_SECS, t);
  return first
    ? t("alerts.downtimes.banner.firstEndsIn", { duration })
    : t("alerts.downtimes.banner.endsIn", { duration });
}

/** How many downtime rows a generated banner covers; its id lists one `<row>:<start>` per row. */
export function bannerRowCount(bannerId: string): number {
  if (!bannerId.startsWith(DOWNTIME_BANNER_PREFIX)) return 0;
  return bannerId.slice(DOWNTIME_BANNER_PREFIX.length).split(",").filter(Boolean).length;
}

/** Milliseconds until `countdownText` reads differently, or `null` once it reads "ended". */
export function msUntilCountdownChanges(remainingMs: number): number | null {
  if (remainingMs <= 0) return null;
  return remainingMs % (MINUTE_SECS * 1000) || MINUTE_SECS * 1000;
}

const isModule = (m: string): m is TargetModule =>
  Object.prototype.hasOwnProperty.call(MODULE_SHORT_KEYS, m);

/** "Alerts 7" for a module the page knows, else the raw module name and its count. */
export function countChipLabel(c: BannerCount, t: TranslateFn): I18nText {
  const name = isModule(c.module) ? t(MODULE_SHORT_KEYS[c.module]) : raw(c.module);
  return t("alerts.downtimes.banner.count", { module: name, count: c.count });
}
