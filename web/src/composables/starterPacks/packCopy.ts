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

import { raw, type I18nText, type useI18nTyped } from "@/types/i18n";

type Translate = ReturnType<typeof useI18nTyped>["t"];

/** The one alert scope line every pack surface shows (D16). */
export const packNote = (
  t: Translate,
  {
    licensed,
    alerts,
    views,
    title,
    native,
  }: { licensed: boolean; alerts: number; views: number; title: I18nText; native: boolean },
) => {
  const counts = {
    alerts: t("starterPacks.countAlerts", { count: alerts }, alerts),
    views: t("starterPacks.countViews", { count: views }, views),
  };
  // A pack with no built-in view has no plan variant, and no views clause when it ships none.
  if (!native && !views) return t("starterPacks.bannerNotePlain", { alerts: counts.alerts, title });
  return licensed && native
    ? t("starterPacks.bannerNote", counts)
    : t("starterPacks.bannerNoteUnlicensed", { ...counts, title });
};

export const packScopeValue = (t: Translate, clusters: string[]) =>
  clusters.length
    ? t("starterPacks.scopeSeen", { count: clusters.length, clusters: raw(clusters.join(", ")) })
    : t("starterPacks.scopeAll");

export const packScope = (t: Translate, clusters: string[]) =>
  t("starterPacks.scope", { value: packScopeValue(t, clusters) });
