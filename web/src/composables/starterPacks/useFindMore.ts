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

import { useAlertLibrary } from "@/composables/alerts/useAlertLibrary";

import { groupFindMore, type FindMoreResult } from "./findMore";
import { ensurePackCatalog, packs as allPacks } from "./usePackCatalog";
import { matchPack, readOrgStreams } from "./packMatchData";
import { useInstallRecords } from "./useInstallRecords";
import { fitStreams } from "./useStarterPackMatcher";

/** Runs the one matcher over every pack; reads only, never installs. */
export function useFindMoreCheck(org: string) {
  const { loadManifest, loadAlertFile } = useAlertLibrary();
  const records = useInstallRecords(org);

  const check = async (): Promise<FindMoreResult> => {
    await ensurePackCatalog(org);
    const [streams, manifest] = await Promise.all([readOrgStreams(org), loadManifest()]);
    const library = { loadManifest, loadAlertFile };
    const packs = await Promise.all(
      allPacks().map(async (pack) => ({
        pack,
        match: await matchPack(org, pack, streams, library),
        fits: await fitStreams(org, pack, streams),
        records: await records.list(pack.id),
      })),
    );
    const catalog = new Map(manifest.alerts.map((entry) => [entry.id, entry]));
    for (const pack of allPacks()) {
      for (const { entry } of pack.bundledAlerts ?? []) {
        if (!catalog.has(entry.id)) catalog.set(entry.id, entry);
      }
    }
    return groupFindMore({ packs, catalog, nowUs: Date.now() * 1000 });
  };

  return { check };
}

/** Find more for my data: runs the check and keeps its answer. */
export function useFindMore(org: string) {
  const runner = useFindMoreCheck(org);
  const result = ref<FindMoreResult | null>(null);
  const state = ref<"idle" | "checking" | "ready" | "error">("idle");

  const check = async () => {
    state.value = "checking";
    try {
      result.value = await runner.check();
      state.value = "ready";
    } catch {
      state.value = "error";
    }
  };

  return { result, state, check };
}
