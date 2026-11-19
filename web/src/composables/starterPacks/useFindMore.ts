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
  NO_DISMISSALS,
  groupFindMore,
  parseDismissals,
  parseResult,
  type FindMoreDismissals,
  type FindMoreResult,
} from "./findMore";
import { ensurePackCatalog, packs as allPacks } from "./usePackCatalog";
import { matchAlerts, matchPack, readOrgStreams } from "./packMatchData";
import { useInstallRecords } from "./useInstallRecords";
import { fitStreams } from "./useStarterPackMatcher";
import { queriesPerDay } from "./wouldFire";

const REFUSED = [401, 403];

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

  // A user refused the org list still gets a check; writes keep using the strict read above.
  const readDismissalsForCheck = () =>
    readDismissals().catch((error) => {
      if (REFUSED.includes(error?.response?.status)) return NO_DISMISSALS;
      throw error;
    });
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
    await ensurePackCatalog(org);
    const [streams, manifest, dismissals] = await Promise.all([
      readOrgStreams(org),
      loadManifest(),
      readDismissalsForCheck(),
    ]);
    const library = { loadManifest, loadAlertFile };
    const packAlerts = new Set(allPacks().flatMap((pack) => pack.alerts));
    const outside = manifest.alerts.filter((entry) => !packAlerts.has(entry.id));
    const packs = await Promise.all(
      allPacks().map(async (pack) => ({
        pack,
        match: await matchPack(org, pack, streams, library),
        fits: await fitStreams(org, pack, streams),
        records: await records.list(pack.id),
      })),
    );
    const verdicts = await matchAlerts(org, outside, streams, {
      loadFile: loadAlertFile,
      packs: allPacks(),
    });
    const catalog = new Map(manifest.alerts.map((entry) => [entry.id, entry]));
    for (const pack of allPacks()) {
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
  const result = ref<FindMoreResult | null>(null);
  const state = ref<"idle" | "checking" | "ready" | "error">("idle");

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

  return { result, state, check };
}
