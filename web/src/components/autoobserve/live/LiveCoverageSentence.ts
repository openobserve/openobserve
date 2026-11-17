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
import type { CoverageTotals } from "./liveAdapter";
import { coverageSentence } from "./liveCopy";

const count = (locale: string, n: number): I18nText => raw(new Intl.NumberFormat(locale).format(n));

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
      { watched: count(locale, totals.fullyWatched), total: count(locale, total) },
      total,
    ),
  ];
  const add = (key: "partly" | "gaps" | "learning", n: number) => {
    if (n > 0)
      parts.push(t(`autoobserve.coverageLive.sentence.${key}`, { count: count(locale, n) }, n));
  };
  add("partly", partial);
  add("gaps", gaps);
  add("learning", learning);
  return raw(parts.join(" "));
};
