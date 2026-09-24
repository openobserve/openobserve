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

/** "ends in 1 h 30 min", "ends in under a minute", or "ended"; minutes round up. */
export function countdownText(remainingSecs: number, t: TranslateFn): I18nText {
  if (remainingSecs <= 0) return t("alerts.downtimes.banner.ended");
  if (remainingSecs < 60) return t("alerts.downtimes.banner.endsInUnderMinute");
  const minutes = Math.ceil(remainingSecs / 60);
  return t("alerts.downtimes.banner.endsIn", { duration: formatDuration(minutes * 60, t) });
}

const isModule = (m: string): m is TargetModule =>
  Object.prototype.hasOwnProperty.call(MODULE_SHORT_KEYS, m);

/** "Alerts 7" for a module the page knows, else the raw module name and its count. */
export function countChipLabel(c: BannerCount, t: TranslateFn): I18nText {
  const name = isModule(c.module) ? t(MODULE_SHORT_KEYS[c.module]) : raw(c.module);
  return t("alerts.downtimes.banner.count", { module: name, count: c.count });
}
