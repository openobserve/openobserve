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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

// `alert_transitions_retention_days` from `/config`; 0 or less means the reaper is off and nothing is dropped.
export const levelChangesEmptyText = (t: TranslateFn, locale: string, days: unknown): I18nText => {
  const base = t("alerts.groups.noHistoryDescription");
  if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) return base;
  const count = raw(new Intl.NumberFormat(locale).format(days));
  return raw(`${base} ${t("alerts.groups.noHistoryRetention", { count }, days)}`);
};
