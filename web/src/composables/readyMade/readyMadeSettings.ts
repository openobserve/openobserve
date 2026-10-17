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

import settings from "@/services/settings";
import { settingQuery } from "@/services/settings.queries";
import { settingKeys } from "@/services/settings.querykeys";
import { queryClient } from "@/composables/query/queryClient";
import type { ReadyMadeSourceId } from "./catalog";

export const READY_MADE_SETTING_KEY = "ready_made_dashboards";
const SETTING_CATEGORY = "dashboards";

export type ReadyMadeState = "added" | "dismissed";

export interface ReadyMadeSourceEntry {
  state: ReadyMadeState;
  at: string;
}

export type ReadyMadeSourceEntries = Partial<Record<ReadyMadeSourceId, ReadyMadeSourceEntry>>;

export interface ReadyMadeSettingValue {
  version: 1;
  sources: ReadyMadeSourceEntries;
}

/** Entries whose write failed, so the banner stays quiet for the rest of the session. */
const sessionMemory = new Map<string, ReadyMadeSourceEntries>();
/** One read-merge-write at a time per user, or two quick saves drop each other's entry. */
const writeChains = new Map<string, Promise<unknown>>();

const memoryKey = (org: string, userId: string) => `${org}\u0000${userId}`;

function normalize(value: unknown): ReadyMadeSettingValue {
  const sources: ReadyMadeSourceEntries = {};
  const raw = (value as { sources?: unknown } | null)?.sources;
  if (raw && typeof raw === "object") {
    for (const [id, entry] of Object.entries(raw as Record<string, any>)) {
      if (entry?.state === "added" || entry?.state === "dismissed") {
        sources[id as ReadyMadeSourceId] = { state: entry.state, at: String(entry.at ?? "") };
      }
    }
  }
  return { version: 1, sources };
}

function withMemory(
  value: ReadyMadeSettingValue,
  org: string,
  userId: string,
): ReadyMadeSettingValue {
  const remembered = sessionMemory.get(memoryKey(org, userId));
  return remembered ? { version: 1, sources: { ...value.sources, ...remembered } } : value;
}

async function readServer(org: string, userId: string, force: boolean) {
  const options = settingQuery(org, READY_MADE_SETTING_KEY, userId);
  if (force) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
  }
  // A 404 resolves to null inside settingQuery; any other failure throws.
  return normalize(await queryClient.fetchQuery(options));
}

/** The user's ready-made memory; throws when it can't be read, so callers can stay silent. */
export async function readReadyMadeSettings(
  org: string,
  userId: string,
  { force = false }: { force?: boolean } = {},
): Promise<ReadyMadeSettingValue> {
  return withMemory(await readServer(org, userId, force), org, userId);
}

async function writeStates(
  org: string,
  userId: string,
  states: Partial<Record<ReadyMadeSourceId, ReadyMadeState>>,
): Promise<{ saved: boolean; value: ReadyMadeSettingValue }> {
  const at = new Date().toISOString();
  const updates: ReadyMadeSourceEntries = {};
  for (const [id, state] of Object.entries(states)) {
    if (state) updates[id as ReadyMadeSourceId] = { state, at };
  }
  const key = memoryKey(org, userId);
  const remember = () => sessionMemory.set(key, { ...(sessionMemory.get(key) ?? {}), ...updates });

  let server: ReadyMadeSettingValue;
  try {
    // Fresh copy: another device may have written since this tab cached it.
    server = await readServer(org, userId, true);
  } catch {
    remember();
    return { saved: false, value: withMemory({ version: 1, sources: {} }, org, userId) };
  }
  const next: ReadyMadeSettingValue = {
    version: 1,
    sources: { ...server.sources, ...(sessionMemory.get(key) ?? {}), ...updates },
  };
  try {
    await settings.setUserSetting(org, userId, READY_MADE_SETTING_KEY, next, SETTING_CATEGORY);
    queryClient.setQueryData(settingKeys.one(org, READY_MADE_SETTING_KEY, userId), next);
    sessionMemory.delete(key);
    return { saved: true, value: next };
  } catch {
    remember();
    return { saved: false, value: next };
  }
}

/** Read-merge-write of per-source states; a failed write is kept in memory for the session. */
export function saveReadyMadeStates(
  org: string,
  userId: string,
  states: Partial<Record<ReadyMadeSourceId, ReadyMadeState>>,
): Promise<{ saved: boolean; value: ReadyMadeSettingValue }> {
  const key = memoryKey(org, userId);
  const previous = writeChains.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => writeStates(org, userId, states));
  writeChains.set(key, run);
  return run.finally(() => {
    if (writeChains.get(key) === run) writeChains.delete(key);
  });
}

/** Test seam: the session memory is module state. */
export function resetReadyMadeSessionMemory(): void {
  sessionMemory.clear();
  writeChains.clear();
}
