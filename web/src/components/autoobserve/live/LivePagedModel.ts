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

import { raw, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";
import type { AutoObserveIncidentItem } from "@/services/autoobserve";
import type { Incident } from "@/services/incidents";
import type { ProblemOutcome } from "../v2/outcome";

export type HomeRange = "24h" | "7d" | "30d";
export type HomePriority = "all" | "p1" | "p2" | "p3" | "p4";

export const HOME_RANGES: HomeRange[] = ["24h", "7d", "30d"];
export const HOME_PRIORITIES: HomePriority[] = ["all", "p1", "p2", "p3", "p4"];

/** The home reads this many newest incidents, so a 30-day range has rows to filter. */
export const HOME_FETCH = 50;
/** Rows shown before Show more; a grouped month shows a few more so each week has a row. */
export const HOME_BASE = 4;
export const HOME_BASE_GROUPED = 6;
export const HOME_STEP = 10;
/** Services named in the can't-see line before it says "and N more". */
export const CANT_SEE_NAMES = 3;

export const RANGE_LABEL: Record<HomeRange, I18nKey> = {
  "24h": "autoobserve2.recent.ranges.day",
  "7d": "autoobserve2.recent.ranges.week",
  "30d": "autoobserve2.recent.ranges.month",
};

export const RANGE_WITHIN: Record<HomeRange, I18nKey> = {
  "24h": "autoobserve2.recent.within.day",
  "7d": "autoobserve2.recent.within.week",
  "30d": "autoobserve2.recent.within.month",
};

const RANGE_MS: Record<HomeRange, number> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

const WEEK_MS = 7 * 86_400_000;

const SEVERITY_RANK: Record<Incident["severity"], number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

// Open is happening now and acknowledged is in hand; neither is fixed, so only resolved turns green.
const STATUS_OUTCOME: Record<Incident["status"], ProblemOutcome> = {
  open: "active",
  acknowledged: "contained",
  resolved: "resolved",
};

export const outcomeOf = (status: Incident["status"]): ProblemOutcome => STATUS_OUTCOME[status];

export const isHomeRange = (value: unknown): value is HomeRange =>
  HOME_RANGES.includes(value as HomeRange);

export const isHomePriority = (value: unknown): value is HomePriority =>
  HOME_PRIORITIES.includes(value as HomePriority);

export const inHomeRange = (item: AutoObserveIncidentItem, range: HomeRange, nowMs: number) =>
  item.finding.first_seen_at / 1000 >= nowMs - RANGE_MS[range];

export const priorityOf = (item: AutoObserveIncidentItem): HomePriority =>
  item.incident.severity.toLowerCase() as HomePriority;

// Whatever is still happening leads, then by priority, then newest, so an active P1 is always first.
export const homeOrder = (a: AutoObserveIncidentItem, b: AutoObserveIncidentItem): number => {
  const active = (i: AutoObserveIncidentItem) => (i.incident.status === "resolved" ? 1 : 0);
  return (
    active(a) - active(b) ||
    SEVERITY_RANK[a.incident.severity] - SEVERITY_RANK[b.incident.severity] ||
    b.finding.first_seen_at - a.finding.first_seen_at
  );
};

export const priorityCounts = (
  items: readonly AutoObserveIncidentItem[],
): Record<HomePriority, number> => {
  const counts = { all: items.length, p1: 0, p2: 0, p3: 0, p4: 0 };
  for (const item of items) counts[priorityOf(item)] += 1;
  return counts;
};

export const weeksAgo = (item: AutoObserveIncidentItem, nowMs: number): number =>
  Math.max(0, Math.floor((nowMs - item.finding.first_seen_at / 1000) / WEEK_MS));

export const weekLabel = (t: TranslateFn, week: number): I18nText =>
  week === 0
    ? t("autoobserve2.recent.groups.thisWeek")
    : week === 1
      ? t("autoobserve2.recent.groups.lastWeek")
      : t("autoobserve2.recent.groups.weeksAgo", { count: week });

export interface HomeView {
  ranged: AutoObserveIncidentItem[];
  filtered: AutoObserveIncidentItem[];
  visible: { item: AutoObserveIncidentItem; group?: number }[];
  counts: Record<HomePriority, number>;
  base: number;
  remaining: number;
}

/** The rows a range, a priority and a Show more count leave on the card. */
export const homeView = (
  items: readonly AutoObserveIncidentItem[],
  range: HomeRange,
  priority: HomePriority,
  shown: number,
  nowMs: number,
): HomeView => {
  const ranged = items.filter((i) => inHomeRange(i, range, nowMs)).sort(homeOrder);
  const grouped = range === "30d";
  const base = grouped ? HOME_BASE_GROUPED : HOME_BASE;
  const picked = priority === "all" ? ranged : ranged.filter((i) => priorityOf(i) === priority);
  // A stable sort by week keeps the priority order inside each week.
  const filtered = grouped
    ? [...picked].sort((a, b) => weeksAgo(a, nowMs) - weeksAgo(b, nowMs))
    : picked;
  const visible = filtered.slice(0, Math.max(shown, base)).map((item, i, rows) => {
    const week = weeksAgo(item, nowMs);
    const first = grouped && (i === 0 || weeksAgo(rows[i - 1], nowMs) !== week);
    return first ? { item, group: week } : { item };
  });
  return {
    ranged,
    filtered,
    visible,
    counts: priorityCounts(ranged),
    base,
    remaining: filtered.length - visible.length,
  };
};

/** "a, b, c and 4 more" in the reader's locale. */
export const namesWithMore = (
  t: TranslateFn,
  locale: string,
  names: readonly string[],
  cap = CANT_SEE_NAMES,
): I18nText => {
  const head: string[] = names.slice(0, cap);
  const rest = names.length - head.length;
  if (rest > 0)
    head.push(String(t("autoobserve.homeLive.andMore", { count: raw(fmt(locale, rest)) }, rest)));
  return raw(new Intl.ListFormat(locale, { type: "conjunction" }).format(head));
};

export const fmt = (locale: string, n: number): string => new Intl.NumberFormat(locale).format(n);

/** What the home says it cannot watch; null while nothing is a gap. */
export const cantSeeText = (
  t: TranslateFn,
  locale: string,
  gaps: readonly string[],
): I18nText | null =>
  gaps.length
    ? t(
        "autoobserve.homeLive.cantSee",
        { count: raw(fmt(locale, gaps.length)), names: namesWithMore(t, locale, gaps) },
        gaps.length,
      )
    : null;

export const allClearText = (
  t: TranslateFn,
  locale: string,
  range: HomeRange,
  watched: number,
): { title: I18nText; desc: I18nText } => ({
  title: t("autoobserve.homeLive.allClearTitle", { within: t(RANGE_WITHIN[range]) }),
  desc: watched
    ? t("autoobserve.homeLive.allClearDesc", { count: raw(fmt(locale, watched)) }, watched)
    : t("autoobserve.homeLive.allClearNone"),
});
