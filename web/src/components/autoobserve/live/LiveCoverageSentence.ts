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
import type { CoverageRow } from "../aoTypes";
import type { CoverageTotals } from "./liveAdapter";
import { countText, coverageSentence, percentText } from "./liveCopy";

// The verdict names the busiest gaps in batches this size, each one review list.
export const GAP_BATCH = 10;
const NAMED_GAPS = 3;

/** Busiest first; a service whose traffic is unknown sorts after every measured one. */
export const byTraffic = (a: CoverageRow, b: CoverageRow): number =>
  (b.traffic ?? -1) - (a.traffic ?? -1);

/** The header sentence counts every service the table lists, naming partly watched and learning ones apart. */
export const coverageStateSentence = (
  t: TranslateFn,
  locale: string,
  totals: Pick<CoverageTotals, "total" | "learning" | "fullyWatched" | "partial" | "gaps">,
): I18nText | null => {
  const { total, partial, gaps, learning } = totals;
  if (!partial && !learning) return coverageSentence(t, locale, { total, gaps });
  const parts = [
    t(
      "autoobserve.coverageLive.sentence.fully",
      { watched: countText(locale, totals.fullyWatched), total: countText(locale, total) },
      total,
    ),
  ];
  const add = (key: "partly" | "gaps" | "learning", n: number) => {
    if (n > 0)
      parts.push(t(`autoobserve.coverageLive.sentence.${key}`, { count: countText(locale, n) }, n));
  };
  add("partly", partial);
  add("gaps", gaps);
  add("learning", learning);
  return raw(parts.join(" "));
};

const listOf = (locale: string, parts: string[]): I18nText =>
  raw(new Intl.ListFormat(locale, { type: "conjunction" }).format(parts));

/** The coverage page's verdict and the line under it; `gaps` are the services with no covered check, busiest first. */
export const coverageVerdict = (
  t: TranslateFn,
  locale: string,
  rows: CoverageRow[],
): { text: I18nText; sub: I18nText; gaps: CoverageRow[] } | null => {
  if (!rows.length) return null;
  const gaps = rows.filter((r) => r.status?.state === "gap").sort(byTraffic);
  const n = gaps.length;
  const stateCount = (state: string) => rows.filter((r) => r.status?.state === state).length;
  const partial = stateCount("partial");
  const learning = stateCount("learning");
  const watched = stateCount("watched");
  const unknown = gaps.filter((r) => r.traffic == null).length;
  if (!n) {
    if (partial || learning) return null;
    return {
      text: t(
        "autoobserve.coverageLive.verdict.allWatched",
        { count: countText(locale, rows.length) },
        rows.length,
      ),
      sub: t("autoobserve.coverageLive.verdict.allWatchedSub", {}, rows.length),
      gaps,
    };
  }
  const subParts = [
    partial
      ? t("autoobserve.coverageLive.verdict.partly", { count: countText(locale, partial) }, partial)
      : "",
    learning
      ? t(
          "autoobserve.coverageLive.sentence.learning",
          { count: countText(locale, learning) },
          learning,
        )
      : "",
    n === 1 && watched && watched === rows.length - 1
      ? t("autoobserve.coverageLive.verdict.others", { count: countText(locale, watched) }, watched)
      : "",
    unknown && n > 1
      ? t(
          "autoobserve.coverageLive.verdict.unknown",
          { count: countText(locale, unknown) },
          unknown,
        )
      : "",
  ];
  const sub = raw(subParts.filter(Boolean).join(" "));
  if (n === 1) {
    const [gap] = gaps;
    const name = raw(gap.identity?.serviceName ?? gap.service);
    const where = String(gap.where ?? "—");
    return {
      text:
        where === "—"
          ? t("autoobserve.coverageLive.verdict.one", { name })
          : t("autoobserve.coverageLive.verdict.oneWhere", { name, where: raw(where) }),
      sub,
      gaps,
    };
  }
  const total = gaps.reduce((sum, r) => sum + (r.traffic ?? 0), 0);
  if (n <= GAP_BATCH || total <= 0) {
    const shown = gaps.slice(0, NAMED_GAPS).map((r) => r.service);
    const rest = n - shown.length;
    const more = rest
      ? [String(t("autoobserveLive.suggestions.moreNames", { count: rest }, rest))]
      : [];
    return {
      text: t("autoobserve.coverageLive.verdict.named", {
        count: countText(locale, n),
        names: listOf(locale, [...shown, ...more]),
      }),
      sub,
      gaps,
    };
  }
  const carried = gaps.slice(0, GAP_BATCH).reduce((sum, r) => sum + (r.traffic ?? 0), 0);
  const share = percentText(locale, carried, total);
  return {
    text: t("autoobserve.coverageLive.verdict.share", {
      count: countText(locale, n),
      top: countText(locale, GAP_BATCH),
      share,
    }),
    sub,
    gaps,
  };
};
