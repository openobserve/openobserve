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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useOrgId } from "@/composables/query/useOrgId";
import { queryClient } from "@/composables/query/queryClient";
import { foldersQuery } from "@/services/common.queries";
import type { ReadyMadeCopy } from "@/services/readyMade.queries";
import { READY_MADE_SOURCES, type ReadyMadeSourceId } from "./catalog";
import { fetchReadyMadeCopies } from "./installReadyMade";
import {
  readReadyMadeSettings,
  saveReadyMadeStates,
  type ReadyMadeSettingValue,
  type ReadyMadeState,
} from "./readyMadeSettings";
import { useReadyMadeDetection } from "./useReadyMadeDetection";

type CopiesBySource = Partial<Record<ReadyMadeSourceId, ReadyMadeCopy[]>>;

/** What the Dashboards list knows about each ready-made source for the current user. */
export function useReadyMadeOffers() {
  const store = useStore();
  const orgId = useOrgId();
  const userId = computed<string>(() => store.state.userInfo?.email ?? "");
  const { detect } = useReadyMadeDetection();

  const detected = ref<ReadyMadeSourceId[] | null>(null);
  // Null while unread or after a failed read — either way, no banner.
  const settings = ref<ReadyMadeSettingValue | null>(null);
  const copies = ref<CopiesBySource>({});
  // Null while unread or after a failed read: a row must not claim "new" for a folder it never looked for.
  const folderNames = ref<Set<string> | null>(null);
  const loaded = ref(false);
  let generation = 0;

  const loadCopies = async (
    org: string,
    ids: ReadyMadeSourceId[],
    force: boolean,
  ): Promise<CopiesBySource> => {
    const entries = await Promise.all(
      ids.map(async (id) => {
        // A failed lookup leaves the source unknown, which never offers it.
        const list = await fetchReadyMadeCopies(org, id, { force }).catch(() => undefined);
        return [id, list] as const;
      }),
    );
    const result: CopiesBySource = {};
    for (const [id, list] of entries) if (list) result[id] = list;
    return result;
  };

  /** Detection, the user's memory and marked copies of detected sources; `force` reaches the server for all three. */
  const refresh = async ({ force = false }: { force?: boolean } = {}) => {
    const run = ++generation;
    const org = orgId.value;
    const user = userId.value;
    if (!org || !user) return;
    const [found, setting] = await Promise.all([
      detect({ force }).catch(() => null),
      readReadyMadeSettings(org, user, { force }).catch(() => null),
    ]);
    if (run !== generation) return;
    const ids = found ?? [];
    const loadedCopies = await loadCopies(org, ids, force);
    if (run !== generation) return;
    detected.value = found;
    settings.value = setting;
    // Merged: the Import dialog's copies of undetected sources must survive a banner refresh.
    copies.value = { ...copies.value, ...loadedCopies };
    loaded.value = true;
  };

  const fetchFolderNames = async (org: string, force: boolean): Promise<Set<string> | null> => {
    const options = foldersQuery(org, "dashboards");
    if (force) {
      await queryClient.invalidateQueries({
        queryKey: options.queryKey,
        exact: true,
        refetchType: "none",
      });
    }
    const folders = await queryClient.fetchQuery(options).catch(() => null);
    return folders ? new Set(folders.map((folder) => folder.name)) : null;
  };

  /** The org's folder names, so each checklist row can say whether its folder already exists. */
  const loadFolders = async ({ force = false }: { force?: boolean } = {}) => {
    const org = orgId.value;
    if (!org) return;
    const names = await fetchFolderNames(org, force);
    if (org === orgId.value) folderNames.value = names;
  };

  /** Every source's copies and the folder names, for the Import dialog. */
  const loadAll = async ({ force = false }: { force?: boolean } = {}) => {
    const org = orgId.value;
    if (!org) return;
    const [all, names] = await Promise.all([
      loadCopies(
        org,
        READY_MADE_SOURCES.map((source) => source.id),
        force,
      ),
      fetchFolderNames(org, force),
    ]);
    // Only an org switch voids these: a banner refresh that overlaps reads fewer sources and must not drop them.
    if (org !== orgId.value) return;
    copies.value = { ...copies.value, ...all };
    folderNames.value = names;
  };

  const isDetected = (id: ReadyMadeSourceId) => !!detected.value?.includes(id);
  const copiesOf = (id: ReadyMadeSourceId): ReadyMadeCopy[] | undefined => copies.value[id];

  const offered = computed<ReadyMadeSourceId[]>(() => {
    const memory = settings.value;
    if (!loaded.value || !detected.value || !memory) return [];
    return detected.value.filter((id) => !memory.sources[id] && copies.value[id]?.length === 0);
  });

  /** Optimistic: the banner reacts at once, the write (or session memory) follows. */
  const remember = async (states: Partial<Record<ReadyMadeSourceId, ReadyMadeState>>) => {
    const org = orgId.value;
    const user = userId.value;
    if (!org || !user) return;
    const current = settings.value;
    // An unread memory stays unread: filling it here would let the banner appear on a partial copy.
    if (current) {
      const at = new Date().toISOString();
      const sources = { ...current.sources };
      for (const [id, state] of Object.entries(states)) {
        if (state) sources[id as ReadyMadeSourceId] = { state, at };
      }
      settings.value = { version: 1, sources };
    }
    await saveReadyMadeStates(org, user, states);
  };

  return {
    orgId,
    userId,
    detected,
    settings,
    copies,
    folderNames,
    loaded,
    offered,
    isDetected,
    copiesOf,
    refresh,
    loadFolders,
    loadAll,
    remember,
  };
}
