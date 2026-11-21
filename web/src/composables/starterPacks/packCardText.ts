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

import type { I18nText, useI18nTyped } from "@/types/i18n";

type Translate = ReturnType<typeof useI18nTyped>["t"];
export type HasKey = (key: string, locale?: string) => boolean;

export type PackCardKind = "dashboards" | "alerts" | "savedViews";

/** What the browser already knows about a pack, read into its Home card summaries. */
export interface PackCardFacts {
  clusters: string[];
  /** The saved view's stream, only when the data has it. */
  stream?: string;
  alertNames: string[];
  title?: string;
  /** Dashboard panels that fit the data; absent until the preview loads. */
  panels?: number | null;
}

const BASE = "starterPacks.home.cards";
// Pack-specific copy is written in en-US only, so its presence is checked there.
const SOURCE_LOCALE = "en-us";
const STEPS = ["template", "fallback", "plain"] as const;
// A private-use character never occurs in a real name, so it marks a placeholder with no value.
export const MISSING = "\uE000";
const SHOWN_CLUSTERS = 1;
const SHOWN_ALERTS = 3;

const listOf = (t: Translate, names: string[], shown: number) =>
  names.length > shown
    ? t(`${BASE}.andMore`, {
        list: names.slice(0, shown).join(", "),
        count: names.length - shown,
      })
    : names.join(", ");

const valuesOf = (t: Translate, facts: PackCardFacts): Record<string, string> => {
  const clusters = facts.clusters.filter(Boolean);
  const alertNames = facts.alertNames.filter(Boolean);
  const panels = facts.panels ?? 0;
  const values: Record<string, string> = {
    clusters: clusters.length ? listOf(t, clusters, SHOWN_CLUSTERS) : "",
    alert_names: alertNames.length ? listOf(t, alertNames, SHOWN_ALERTS) : "",
    stream: facts.stream ?? "",
    title: facts.title ?? "",
    panels: panels > 0 ? t(`${BASE}.panels`, { count: panels }, panels) : "",
  };
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.trim() ? value : MISSING]),
  );
};

/** One resource card's summary: the first template whose every placeholder has a value. */
export const packCardText = (
  t: Translate,
  te: HasKey,
  packId: string,
  kind: PackCardKind,
  facts: PackCardFacts,
): I18nText | null => {
  const own = te(`${BASE}.${packId}.${kind}.template`, SOURCE_LOCALE);
  const prefix = `${BASE}.${own ? packId : "default"}.${kind}`;
  const values = valuesOf(t, facts);
  const clusterCount = facts.clusters.filter(Boolean).length;
  for (const step of STEPS) {
    const key = `${prefix}.${step}`;
    if (!te(key, SOURCE_LOCALE)) continue;
    const text = t(key, values, clusterCount);
    if (!text.includes(MISSING)) return text;
  }
  return null;
};
