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

// Not under `starter_pack.`, which the install records own.
export const DISMISSED_KEY = "starter_pack_find.dismissed";
export const DAILY_ON_KEY = "starter_pack_find.daily";
export const LAST_CHECK_KEY = "starter_pack_find.last";

export const LIBRARY_SOURCE_PREFIX = "library-";
export const NO_DISMISSALS: FindMoreDismissals = { sources: [], items: [] };

export interface FindMoreItem {
  kind: "dashboard" | "alert";
  id: string;
  name: string;
  /** Background queries a day once this alert is on. */
  queries: number;
}

/** One pack or Library group with matches nobody has added or dismissed. */
export interface FindMoreSource {
  id: string;
  /** Set for a starter pack; a Library group carries its name in `label`. */
  packId?: string;
  label: string;
  streams: string[];
  items: FindMoreItem[];
  queriesPerDay: number;
}

export interface FindMoreResult {
  /** Microseconds. */
  checkedAt: number;
  sources: FindMoreSource[];
  /** Matches left out because someone dismissed them. */
  dismissed: number;
}

export interface FindMoreDismissals {
  sources: string[];
  /** Keyed `sourceId/itemId`. */
  items: string[];
}

export interface FindMoreInputs {
  packs: Array<{ pack: StarterPack; match: PackMatch; records: PackInstallRecord[] }>;
  /** Every known Library entry, for titles and streams. */
  catalog: Map<string, AlertLibraryEntry>;
  /** Library alerts outside every pack, with their verdicts. */
  library: { entries: AlertLibraryEntry[]; verdicts: Map<string, boolean> };
  /** Library ids already on an alert in this org. */
  installedLibraryIds: Set<string>;
  dismissals: FindMoreDismissals;
  queriesOf: (entryId: string) => number;
  nowUs: number;
}

export const sumQueries = (items: FindMoreItem[]) =>
  items.reduce((sum, { queries }) => sum + (Number(queries) || 0), 0);

export const itemKey = (sourceId: string, itemId: string) => `${sourceId}/${itemId}`;

export const librarySourceId = (group: string) => `${LIBRARY_SOURCE_PREFIX}${group}`;

/** A Library group installs through the pack installer, so it needs a pack of its own. */
export const libraryPack = (group: string, entries: AlertLibraryEntry[]): StarterPack => ({
  id: librarySourceId(group),
  version: "1",
  titleKey: "starterPacks.findMore.title",
  descriptionKey: "starterPacks.findMore.title",
  folder: { name: group, description: group },
  dashboards: [],
  alerts: entries.map(({ id }) => id),
  savedViews: [],
});

// The KV store is shared and user-writable, so a stored value is not trusted.
export const parseDismissals = (value: string | null): FindMoreDismissals => {
  try {
    const parsed = JSON.parse(value ?? "null");
    const strings = (list: unknown) =>
      Array.isArray(list) ? list.filter((entry) => typeof entry === "string") : [];
    return { sources: strings(parsed?.sources), items: strings(parsed?.items) };
  } catch {
    return NO_DISMISSALS;
  }
};

export const parseResult = (value: string | null): FindMoreResult | null => {
  try {
    const parsed = JSON.parse(value ?? "null");
    if (typeof parsed?.checkedAt !== "number" || !Array.isArray(parsed?.sources)) return null;
    return {
      checkedAt: parsed.checkedAt,
      sources: parsed.sources,
      dismissed: parsed.dismissed ?? 0,
    };
  } catch {
    return null;
  }
};

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

const splitDismissed = (
  sourceId: string,
  items: FindMoreItem[],
  dismissals: FindMoreDismissals,
) => {
  if (dismissals.sources.includes(sourceId)) return { kept: [], dismissed: items.length };
  const kept = items.filter((item) => !dismissals.items.includes(itemKey(sourceId, item.id)));
  return { kept, dismissed: items.length - kept.length };
};

const packSource = (
  { pack, match, records }: FindMoreInputs["packs"][number],
  entries: Map<string, AlertLibraryEntry>,
  inputs: FindMoreInputs,
) => {
  const owned = installedIds(records);
  const fresh = (id: string, ready: boolean) =>
    ready && !owned.has(id) && !inputs.installedLibraryIds.has(id);
  const items: FindMoreItem[] = [
    ...pack.dashboards
      .filter(({ id }) => fresh(id, match.dashboards.get(id) ?? false))
      .map(({ id, title }) => ({ kind: "dashboard" as const, id, name: title, queries: 0 })),
    ...pack.alerts
      .filter((id) => fresh(id, match.alerts.get(id) ?? false))
      .map((id) => ({
        kind: "alert" as const,
        id,
        name: entries.get(id)?.title ?? id,
        queries: inputs.queriesOf(id),
      })),
  ];
  const { kept, dismissed } = splitDismissed(pack.id, items, inputs.dismissals);
  const streams = kept.flatMap((item) => entries.get(item.id)?.required_streams ?? []);
  const source: FindMoreSource = {
    id: pack.id,
    packId: pack.id,
    label: pack.id,
    streams: [...new Set(streams)],
    items: kept,
    queriesPerDay: sumQueries(kept),
  };
  return { source, dismissed };
};

const librarySources = (inputs: FindMoreInputs) => {
  const groups = new Map<string, AlertLibraryEntry[]>();
  for (const entry of inputs.library.entries) {
    if (!inputs.library.verdicts.get(entry.id) || inputs.installedLibraryIds.has(entry.id))
      continue;
    groups.set(entry.pack, [...(groups.get(entry.pack) ?? []), entry]);
  }
  return [...groups].map(([group, entries]) => {
    const id = librarySourceId(group);
    const items = entries.map(({ id: entryId, title }) => ({
      kind: "alert" as const,
      id: entryId,
      name: title,
      queries: inputs.queriesOf(entryId),
    }));
    const { kept, dismissed } = splitDismissed(id, items, inputs.dismissals);
    const streams = entries
      .filter((entry) => kept.some((item) => item.id === entry.id))
      .flatMap((entry) => entry.required_streams);
    const source: FindMoreSource = {
      id,
      label: group,
      streams: [...new Set(streams)],
      items: kept,
      queriesPerDay: sumQueries(kept),
    };
    return { source, dismissed };
  });
};

/** Groups new matches by source, leaving out what is installed or dismissed. */
export const groupFindMore = (inputs: FindMoreInputs): FindMoreResult => {
  const built = [
    ...inputs.packs.map((row) => packSource(row, inputs.catalog, inputs)),
    ...librarySources(inputs),
  ];
  return {
    checkedAt: inputs.nowUs,
    sources: built.map(({ source }) => source).filter(({ items }) => items.length > 0),
    dismissed: built.reduce((sum, { dismissed }) => sum + dismissed, 0),
  };
};
