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

import {
  computed,
  reactive,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref,
} from "vue";

import type { FindMoreResult, FindMoreSource } from "./findMore";
import { packs } from "./usePackCatalog";

export interface BrowserInterrupted {
  packId: string;
  label: string;
  done?: number;
  total?: number;
}

export interface BrowserMatchCopy {
  /** Milliseconds since epoch of the last check (full or Home) that ran in this browser. */
  checkedAt: number;
  /** Built-in packs, set-up ones hidden by `installedPackIds`; load drops older copies' Library groups. */
  sources: FindMoreSource[];
  /** Built-in pack ids known to be installed at the last check. */
  installedPackIds: string[];
  interrupted: BrowserInterrupted | null;
}

interface OrgState {
  copy: BrowserMatchCopy | null;
}

export const matchesKey = (org: string) => `o2.starterPacks.browserMatches.${org}`;

const isBuiltIn = (packId: string) => packs().some(({ id }) => id === packId);

const builtInOnly = (sources: FindMoreSource[]) =>
  sources.filter(({ packId }) => !!packId && isBuiltIn(packId));

// Shared by every caller in the tab, so a save on Home updates the header at once.
const orgs = new Map<string, OrgState>();

// Storage can be missing or throw (private mode, blocked site data), so every access is guarded.
const readJson = (key: string): unknown => {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The in-memory copy still serves this tab.
  }
};

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const parseCopy = (value: unknown): BrowserMatchCopy | null => {
  const parsed = value as Partial<BrowserMatchCopy> | null;
  if (typeof parsed?.checkedAt !== "number" || !Array.isArray(parsed?.sources)) return null;
  const sources = builtInOnly(
    parsed.sources.filter(
      (source): source is FindMoreSource =>
        typeof source?.id === "string" &&
        Array.isArray(source?.items) &&
        Array.isArray(source?.streams),
    ),
  );
  const interrupted = typeof parsed.interrupted?.packId === "string" ? parsed.interrupted : null;
  return {
    checkedAt: parsed.checkedAt,
    sources,
    installedPackIds: strings(parsed.installedPackIds),
    interrupted,
  };
};

const stateOf = (org: string): OrgState => {
  let state = orgs.get(org);
  if (!state) {
    state = reactive<OrgState>({ copy: parseCopy(readJson(matchesKey(org))) });
    orgs.set(org, state);
  }
  return state;
};

/** Forgets the in-memory copies, so the next read comes from storage. */
export const resetBrowserMatches = () => orgs.clear();

/** This browser's last match result for an org; no network calls. */
export function useBrowserMatches(org: MaybeRefOrGetter<string>): {
  copy: Readonly<Ref<BrowserMatchCopy | null>>;
  visible: ComputedRef<FindMoreSource[]>;
  count: ComputedRef<number>;
  show: ComputedRef<boolean>;
  saveFull(
    result: FindMoreResult,
    installedPackIds: string[],
    interrupted?: BrowserInterrupted | null,
  ): void;
  saveBuiltIn(
    sources: FindMoreSource[],
    installedPackIds: string[],
    interrupted: BrowserInterrupted | null,
  ): void;
  markInstalled(sourceId: string, packId?: string): void;
  markRemoved(packId: string): void;
  clear(): void;
} {
  const state = computed(() => stateOf(toValue(org)));
  const copy = computed(() => state.value.copy);
  const visible = computed(() => {
    const installed = copy.value?.installedPackIds ?? [];
    return (copy.value?.sources ?? []).filter(
      ({ packId }) => !(packId && installed.includes(packId)),
    );
  });
  const count = computed(() => visible.value.length);
  // Set-up packs stay listed and an empty check still has its screen, so any check shows the chip.
  const show = computed(() => copy.value !== null);

  const setCopy = (next: BrowserMatchCopy) => {
    state.value.copy = next;
    writeJson(matchesKey(toValue(org)), next);
  };

  const saveBuiltIn = (
    sources: FindMoreSource[],
    installedPackIds: string[],
    interrupted: BrowserInterrupted | null = null,
  ) => {
    const installed = [...new Set(installedPackIds)];
    const fresh = builtInOnly(sources);
    // A check leaves out a set-up pack, so its last source is kept for an undo to list it again.
    const kept = (copy.value?.sources ?? []).filter(
      ({ packId }) =>
        !!packId && installed.includes(packId) && !fresh.some((row) => row.packId === packId),
    );
    setCopy({
      checkedAt: Date.now(),
      sources: [...fresh, ...kept],
      installedPackIds: installed,
      interrupted,
    });
  };

  const saveFull = (
    result: FindMoreResult,
    installedPackIds: string[],
    interrupted: BrowserInterrupted | null = null,
  ) => saveBuiltIn(result.sources, installedPackIds, interrupted);

  const markInstalled = (sourceId: string, packId?: string) => {
    const current = copy.value;
    if (!current) return;
    const builtIn = !!packId && isBuiltIn(packId);
    // A built-in source stays, hidden by its installed id, so an undo can list it again.
    setCopy({
      ...current,
      sources: builtIn ? current.sources : current.sources.filter(({ id }) => id !== sourceId),
      installedPackIds: builtIn
        ? [...new Set([...current.installedPackIds, packId])]
        : current.installedPackIds,
      interrupted: current.interrupted?.packId === packId ? null : current.interrupted,
    });
  };

  const markRemoved = (packId: string) => {
    const current = copy.value;
    if (!current) return;
    setCopy({
      ...current,
      installedPackIds: current.installedPackIds.filter((id) => id !== packId),
      interrupted: current.interrupted?.packId === packId ? null : current.interrupted,
    });
  };

  const clear = () => {
    state.value.copy = null;
    try {
      window.localStorage.removeItem(matchesKey(toValue(org)));
    } catch {
      // The in-memory copy is gone for this tab either way.
    }
  };

  return { copy, visible, count, show, saveFull, saveBuiltIn, markInstalled, markRemoved, clear };
}
