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

/** What a region loads; one shared list so every surface names its work the same way. */
export type RegionNoun = "spans" | "traces" | "logs" | "charts";

/** Partitions a search has finished, out of all it will run. */
export interface Partitions {
  done: number;
  total: number;
}

/** The noun alone, e.g. "traces". */
export const nounText = (t: TranslateFn, noun: RegionNoun): I18nText =>
  t(`common.loadingNouns.${noun}`);

/** "Loading {noun}…" from the one shared key. */
export const loadingText = (t: TranslateFn, noun: RegionNoun): I18nText =>
  t("common.loadingNoun", { noun: nounText(t, noun) });

/** True when a search stopped before its last partition. */
export const isPartial = (partitions: Partitions | null | undefined): partitions is Partitions =>
  !!partitions && partitions.total > 0 && partitions.done < partitions.total;

/** The polite result line: "{count} {noun} found", with the partial part when the search stopped early. */
export const resultText = (
  t: TranslateFn,
  { count, noun, partitions }: { count: number; noun: RegionNoun; partitions?: Partitions | null },
): I18nText => {
  const named = { count: count.toLocaleString(), noun: nounText(t, noun) };
  return isPartial(partitions)
    ? t("regionStatus.foundPartial", { ...named, done: partitions.done, total: partitions.total })
    : t("regionStatus.found", named);
};
