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

import type { AlertLibraryEntry } from "@/types/alertLibrary";

import type { PackMatch } from "./packMatchData";
import type { PackInstallRecord, StarterPack } from "./types";

export interface FindMoreItem {
  kind: "dashboard" | "alert" | "savedView";
  id: string;
  name: string;
}

/** One pack with matches nobody has added. */
export interface FindMoreSource {
  id: string;
  /** Missing on Library groups that copies saved by older checks may still hold. */
  packId?: string;
  label: string;
  streams: string[];
  items: FindMoreItem[];
}

export interface FindMoreResult {
  /** Microseconds. */
  checkedAt: number;
  sources: FindMoreSource[];
}

interface FindMoreInputs {
  /** `fits` names the pack's detection streams, the same ones Home's offer names. */
  packs: Array<{
    pack: StarterPack;
    match: PackMatch;
    fits: string[];
    records: PackInstallRecord[];
  }>;
  /** Every known Library entry, for alert titles. */
  catalog: Map<string, AlertLibraryEntry>;
  nowUs: number;
}

const installedIds = (records: PackInstallRecord[]) =>
  new Set(
    records
      .filter(({ status }) => status !== "removed")
      .flatMap(({ items }) =>
        items
          .filter(({ status }) => status === "created" || status === "existing")
          .map((item) => item.copyOf ?? item.itemId),
      ),
  );

const packSource = (
  { pack, match, fits, records }: FindMoreInputs["packs"][number],
  entries: Map<string, AlertLibraryEntry>,
) => {
  const owned = installedIds(records);
  // Home's matcher offers a pack only on this rule, so the header never lists one Home does not.
  const offered = match.ready && (pack.detector === "kubernetes" || fits.length > 0);
  const fresh = (id: string, ready: boolean) => offered && ready && !owned.has(id);
  const items: FindMoreItem[] = [
    ...pack.dashboards
      .filter(({ id }) => fresh(id, match.dashboards.get(id) ?? false))
      .map(({ id, title }) => ({ kind: "dashboard" as const, id, name: title })),
    ...pack.alerts
      .filter((id) => fresh(id, match.alerts.get(id) ?? false))
      .map((id) => ({ kind: "alert" as const, id, name: entries.get(id)?.title ?? id })),
    ...pack.savedViews
      .filter(({ id }) => fresh(id, match.views.get(id) ?? false))
      .map(({ id, name }) => ({ kind: "savedView" as const, id, name })),
  ];
  const source: FindMoreSource = {
    id: pack.id,
    packId: pack.id,
    label: pack.id,
    streams: fits,
    items,
  };
  return source;
};

/** Groups new matches by source, leaving out what is installed. */
export const groupFindMore = (inputs: FindMoreInputs): FindMoreResult => ({
  checkedAt: inputs.nowUs,
  sources: inputs.packs
    .map((row) => packSource(row, inputs.catalog))
    .filter(({ items }) => items.length > 0),
});
