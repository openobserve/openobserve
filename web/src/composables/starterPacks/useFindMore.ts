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

import { ref } from "vue";
import { useMutation } from "@tanstack/vue-query";

import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";
import { readQuery } from "@/composables/query/readQuery";
import { alertDetailQuery, alertsByTagsQuery } from "@/services/alerts.queries";
import { kvValueQuery, setKvMutation } from "@/services/kv.queries";
import type { AlertLibraryEntry } from "@/types/alertLibrary";

import {
  DISMISSED_KEY,
  LAST_CHECK_KEY,
  groupFindMore,
  itemKey,
  libraryPack,
  parseDismissals,
  parseResult,
  sumQueries,
  type FindMoreDismissals,
  type FindMoreResult,
  type FindMoreSource,
} from "./findMore";
import { STARTER_PACKS } from "./kubernetesPack";
import { matchAlerts, matchPack, readOrgStreams } from "./packMatchData";
import type { StarterPack } from "./types";
import { useInstallRecords } from "./useInstallRecords";
import { useStarterPacks } from "./useStarterPacks";
import { queriesPerDay } from "./wouldFire";

/** What an Add made, kept so its Undo removes exactly that. */
export interface FindMoreAdded {
  source: FindMoreSource;
  installId: string;
  itemIds: string[];
  /** The Add started this record, so Undo removes the whole install. */
  newRecord: boolean;
}

const withoutItem = (source: FindMoreSource, itemId: string): FindMoreSource => {
  const items = source.items.filter(({ id }) => id !== itemId);
  return { ...source, items, queriesPerDay: sumQueries(items) };
};

const unusedFolders = (source: FindMoreSource) => [
  ...(source.items.some(({ kind }) => kind === "dashboard") ? [] : ["dashboards"]),
  ...(source.items.some(({ kind }) => kind === "alert") ? [] : ["alerts"]),
];

const readKv = async (org: string, key: string) => {
  try {
    return await readQuery(kvValueQuery(org, key), true);
  } catch {
    return null;
  }
};

/** Runs the one matcher over every pack and Library alert; reads only, never installs. */
export function useFindMoreCheck(org: string) {
  const { loadManifest, loadAlertFile } = useAlertLibrary();
  const records = useInstallRecords(org);
  const setKv = useMutation(() => setKvMutation(org));

  // Only a missing key reads as none; any other failure must not let a write wipe the list.
  const readDismissals = async () =>
    parseDismissals(await readQuery(kvValueQuery(org, DISMISSED_KEY), true));
  const readLast = async () => parseResult(await readKv(org, LAST_CHECK_KEY));

  const writeLast = (result: FindMoreResult) =>
    setKv.mutateAsync({ key: LAST_CHECK_KEY, value: JSON.stringify(result) });

  const writeDismissals = (value: FindMoreDismissals) =>
    setKv.mutateAsync({ key: DISMISSED_KEY, value: JSON.stringify(value) });

  // The `pack:` tag and `library_id` are what a Library install stamps on every alert.
  const libraryIdsIn = async (groups: string[]): Promise<Set<string>> => {
    const ids = new Set<string>();
    await Promise.all(
      groups.map(async (group) => {
        const tags = [`pack:${group}`.toLowerCase()];
        const rows = await readQuery(alertsByTagsQuery(org, tags), true).catch(() => []);
        // Cached between checks: the list rows carry no library_id, and it does not change.
        const details = await Promise.all(
          rows.map((row) => readQuery(alertDetailQuery(org, row.alert_id)).catch(() => null)),
        );
        for (const alert of details) {
          const id = alert?.context_attributes?.library_id;
          if (typeof id === "string") ids.add(id);
        }
      }),
    );
    return ids;
  };

  const queriesOf = async (entries: AlertLibraryEntry[]) => {
    const counts = new Map<string, number>();
    await Promise.all(
      entries.map(async (entry) => {
        const file = await loadAlertFile(entry).catch(() => null);
        counts.set(entry.id, file ? queriesPerDay([file]) : 0);
      }),
    );
    return counts;
  };

  const check = async (): Promise<FindMoreResult> => {
    const [streams, manifest, dismissals] = await Promise.all([
      readOrgStreams(org),
      loadManifest(),
      readDismissals(),
    ]);
    const library = { loadManifest, loadAlertFile };
    const packAlerts = new Set(STARTER_PACKS.flatMap((pack) => pack.alerts));
    const outside = manifest.alerts.filter((entry) => !packAlerts.has(entry.id));
    const packs = await Promise.all(
      STARTER_PACKS.map(async (pack) => ({
        pack,
        match: await matchPack(org, pack, streams, library),
        records: await records.list(pack.id),
      })),
    );
    const verdicts = await matchAlerts(org, outside, streams, {
      loadFile: loadAlertFile,
      packs: STARTER_PACKS,
    });
    const catalog = new Map(manifest.alerts.map((entry) => [entry.id, entry]));
    for (const pack of STARTER_PACKS) {
      for (const { entry } of pack.bundledAlerts ?? []) {
        if (!catalog.has(entry.id)) catalog.set(entry.id, entry);
      }
    }
    const ready = [...catalog.values()].filter(
      (entry) =>
        verdicts.get(entry.id) || packs.some(({ match }) => match.alerts.get(entry.id) === true),
    );
    const groups = [...new Set(ready.map((entry) => entry.pack))];
    const [installedLibraryIds, queries] = await Promise.all([
      libraryIdsIn(groups),
      queriesOf(ready),
    ]);
    return groupFindMore({
      packs,
      catalog,
      library: { entries: outside, verdicts },
      installedLibraryIds,
      dismissals,
      queriesOf: (id) => queries.get(id) ?? 0,
      nowUs: Date.now() * 1000,
    });
  };

  return { check, readLast, writeLast, readDismissals, writeDismissals };
}

/** Find more for my data: check, add one source, undo it, and dismiss matches. */
export function useFindMore(org: string) {
  const runner = useFindMoreCheck(org);
  const installer = useStarterPacks(org);
  const { loadManifest } = useAlertLibrary();
  const result = ref<FindMoreResult | null>(null);
  const state = ref<"idle" | "checking" | "ready" | "error">("idle");
  const added = ref<FindMoreAdded[]>([]);
  const busy = ref<string | null>(null);

  const check = async () => {
    state.value = "checking";
    try {
      result.value = await runner.check();
      state.value = "ready";
      // A user who cannot write the store still sees the answer.
      await runner.writeLast(result.value).catch(() => {});
    } catch {
      state.value = "error";
    }
  };

  const packFor = async (source: FindMoreSource): Promise<StarterPack> => {
    const shipped = STARTER_PACKS.find(({ id }) => id === source.packId);
    if (shipped) return shipped;
    const manifest = await loadManifest();
    const ids = new Set(source.items.map(({ id }) => id));
    return libraryPack(
      source.label,
      manifest.alerts.filter((entry) => ids.has(entry.id)),
    );
  };

  const dropSource = (sourceId: string) => {
    if (!result.value) return;
    result.value = {
      ...result.value,
      sources: result.value.sources.filter(({ id }) => id !== sourceId),
    };
    void runner.writeLast(result.value).catch(() => {});
  };

  const install = async (
    pack: StarterPack,
    source: FindMoreSource,
  ): Promise<{ done: FindMoreAdded; complete: boolean }> => {
    const itemIds = source.items.map(({ id }) => id);
    const live = (await installer.listInstalls(pack.id)).find(({ status }) => status !== "removed");
    const preview = source.packId ? await installer.previewPack(pack) : null;
    const adaptation = {
      repairs: preview?.repairs ?? [],
      bindings: preview?.bindings ?? [],
      flavours: preview?.flavours ?? {},
    };
    if (live) {
      const record = await installer.appendToInstall(pack, live.installId, itemIds, adaptation);
      const done = { source, installId: live.installId, itemIds, newRecord: false };
      return { done, complete: record.status === "complete" };
    }
    const others = [
      ...pack.dashboards.map(({ id }) => id),
      ...pack.alerts,
      ...pack.savedViews.map(({ id }) => id),
    ].filter((id) => !itemIds.includes(id));
    const record = await installer.installPack(pack, {
      ...adaptation,
      copies: preview?.copies,
      exclude: [...others, ...unusedFolders(source)],
    });
    const done = { source, installId: record.installId, itemIds, newRecord: true };
    return { done, complete: record.status === "complete" };
  };

  /** Installs one source's new matches with alerts off, like a first install. */
  const add = async (source: FindMoreSource): Promise<boolean> => {
    busy.value = source.id;
    try {
      const { done, complete } = await install(await packFor(source), source);
      added.value = [...added.value, done];
      // An incomplete install keeps the source listed; Undo still covers what was made.
      if (complete) dropSource(source.id);
      return complete;
    } catch {
      return false;
    } finally {
      busy.value = null;
    }
  };

  const undo = async (entry: FindMoreAdded): Promise<boolean> => {
    busy.value = entry.source.id;
    try {
      const pack = await packFor(entry.source);
      if (entry.newRecord) await installer.undoPack(pack, entry.installId);
      else await installer.undoItems(pack, entry.installId, entry.itemIds);
      added.value = added.value.filter((row) => row !== entry);
      const listed = result.value?.sources.some(({ id }) => id === entry.source.id);
      if (result.value && !listed) {
        result.value = { ...result.value, sources: [...result.value.sources, entry.source] };
      }
      return true;
    } catch {
      return false;
    } finally {
      busy.value = null;
    }
  };

  let dismissing: Promise<unknown> = Promise.resolve();

  // Serialized, so two quick dismissals cannot overwrite each other's read.
  const updateDismissals = (change: (value: FindMoreDismissals) => FindMoreDismissals) => {
    const run = dismissing
      .catch(() => {})
      .then(async () => {
        const next = change(await runner.readDismissals());
        await runner.writeDismissals({
          sources: [...new Set(next.sources)],
          items: [...new Set(next.items)],
        });
      });
    dismissing = run;
    return run;
  };

  const dismissSource = async (sourceId: string) => {
    await updateDismissals((value) => ({ ...value, sources: [...value.sources, sourceId] }));
    if (result.value) {
      const gone = result.value.sources.find(({ id }) => id === sourceId)?.items.length ?? 0;
      result.value = { ...result.value, dismissed: result.value.dismissed + gone };
    }
    dropSource(sourceId);
  };

  const dismissItem = async (sourceId: string, itemId: string) => {
    await updateDismissals((value) => ({
      ...value,
      items: [...value.items, itemKey(sourceId, itemId)],
    }));
    if (!result.value) return;
    const sources = result.value.sources
      .map((source) => (source.id === sourceId ? withoutItem(source, itemId) : source))
      .filter(({ items }) => items.length > 0);
    result.value = { ...result.value, sources, dismissed: result.value.dismissed + 1 };
    void runner.writeLast(result.value).catch(() => {});
  };

  const restoreDismissed = async () => {
    await updateDismissals(() => ({ sources: [], items: [] }));
    await check();
  };

  return {
    result,
    state,
    added,
    busy,
    check,
    add,
    undo,
    dismissSource,
    dismissItem,
    restoreDismissed,
  };
}
