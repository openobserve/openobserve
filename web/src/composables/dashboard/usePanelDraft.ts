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

import { ref, type ComputedRef, type Ref } from "vue";
import type { LocationQuery } from "vue-router";
import { getUUID } from "@/utils/uuid";

const KEY_PREFIX = "o2.dashboards.panelDraft.";
const TAB_ID_KEY = "o2.dashboards.panelDraft.tabId";
const NEW_PANEL_SEGMENT = "new:";
const PROBE_KEY = "o2.dashboards.panelDraft.probe";
const TAB_ID_RELOAD_MS = 60_000;
export const PANEL_DRAFT_SAVE_DELAY_MS = 1000;
export const PANEL_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PANEL_DRAFT_MAX_COUNT = 20;

/** One autosaved Add panel session, as stored in localStorage. */
export interface PanelDraft {
  panel: Record<string, unknown>;
  baseVersion?: string;
  variables: LocationQuery;
  savedAt: number;
}

/** A draft together with the storage key it was read from. */
export interface PanelDraftEntry {
  key: string;
  draft: PanelDraft;
}

/** Draft content without its timestamp; null means there is nothing to keep. */
export type PanelDraftContent = Omit<PanelDraft, "savedAt"> | null;

/** What usePanelDraft returns. */
export interface UsePanelDraft {
  save: (content: () => PanelDraftContent) => void;
  flush: () => void;
  cancel: () => void;
  write: (entry: PanelDraftEntry) => boolean;
  read: () => PanelDraftEntry | undefined;
  remove: (key?: string) => void;
  available: Ref<boolean>;
}

let tabId: string | undefined;
let pendingRestore: PanelDraftEntry | undefined;

// Claimed on load of any page (main.ts imports this module), so a tab duplicated later finds no stash to copy.
if (typeof window !== "undefined") getTabId();

/** Per-tab id for new-panel draft keys; sessionStorage carries it across a reload only, never into a duplicated tab. */
export function getTabId(): string {
  if (tabId) return tabId;
  tabId = claimStashedTabId() ?? getUUID();
  window.addEventListener("pagehide", stashTabId);
  window.addEventListener("pageshow", claimStashedTabId);
  return tabId;
}

export function panelDraftKey(org: string, dashboardId: string, panelId?: string): string {
  return `${KEY_PREFIX}${org}.${dashboardId}.${panelId || NEW_PANEL_SEGMENT + getTabId()}`;
}

/** Hands a discarded draft to the next Add panel mount for its key, which restores it instead of offering it (Undo). */
export function requestDraftRestore(entry: PanelDraftEntry): void {
  pendingRestore = entry;
}

/** The draft an Undo asked this key to restore, if any; the request is consumed either way. */
export function takeDraftRestore(key: string): PanelDraftEntry | undefined {
  const requested = pendingRestore?.key === key ? pendingRestore : undefined;
  pendingRestore = undefined;
  return requested;
}

/** Autosaved Add panel drafts in localStorage; every storage call degrades to a no-op once storage throws. */
export function usePanelDraft(key: ComputedRef<string>): UsePanelDraft {
  const available = ref(probeStorage());

  const guard = <T>(fallback: T, fn: () => T): T => {
    if (!available.value) return fallback;
    try {
      return fn();
    } catch {
      available.value = false;
      return fallback;
    }
  };

  const write = (entry: PanelDraftEntry): boolean =>
    guard(false, () => {
      localStorage.setItem(entry.key, JSON.stringify(entry.draft));
      pruneDrafts(Date.now());
      return true;
    });

  const remove = (draftKey: string = key.value): void =>
    guard(undefined, () => localStorage.removeItem(draftKey));

  let pending: (() => PanelDraftContent) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  const flush = () => {
    const content = pending?.();
    const hadPending = pending !== undefined;
    cancel();
    if (!hadPending) return;
    if (content) write({ key: key.value, draft: { ...content, savedAt: Date.now() } });
    else remove();
  };
  // The content is read when the timer fires, so a burst of edits costs one snapshot.
  const save = (content: () => PanelDraftContent): void => {
    clearTimeout(timer);
    pending = content;
    timer = setTimeout(flush, PANEL_DRAFT_SAVE_DELAY_MS);
  };

  const read = (): PanelDraftEntry | undefined =>
    guard(undefined, () => {
      const drafts = pruneDrafts(Date.now());
      const own = drafts.find((entry) => entry.key === key.value);
      if (own) return own;
      const newSegment = key.value.lastIndexOf(`.${NEW_PANEL_SEGMENT}`);
      if (newSegment === -1) return undefined;
      // A new-panel draft from a closed tab has another tab id, so the newest sibling is offered.
      const siblingPrefix = key.value.slice(0, newSegment + 1 + NEW_PANEL_SEGMENT.length);
      return drafts
        .filter((entry) => entry.key.startsWith(siblingPrefix))
        .sort((a, b) => b.draft.savedAt - a.draft.savedAt)[0];
    });

  return { save, flush, cancel, write, read, remove, available };
}

// A duplicated tab copies sessionStorage, so the id sits there only from this page hiding until the next page claims it.
function stashTabId(): void {
  try {
    sessionStorage.setItem(TAB_ID_KEY, JSON.stringify({ id: tabId, hiddenAt: Date.now() }));
  } catch {
    // storage unavailable: the reloaded page takes a new id and read() offers the draft as a sibling
  }
}

function claimStashedTabId(): string | undefined {
  try {
    const raw = sessionStorage.getItem(TAB_ID_KEY);
    sessionStorage.removeItem(TAB_ID_KEY);
    if (!raw) return undefined;
    const stash = JSON.parse(raw) as { id?: unknown; hiddenAt?: unknown };
    const fresh = Date.now() - Number(stash.hiddenAt) <= TAB_ID_RELOAD_MS;
    return typeof stash.id === "string" && fresh ? stash.id : undefined;
  } catch {
    return undefined;
  }
}

function probeStorage(): boolean {
  try {
    localStorage.setItem(PROBE_KEY, "1");
    localStorage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

function parseDraft(raw: string | null): PanelDraft | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const draft = value as Partial<PanelDraft>;
    if (typeof draft.savedAt !== "number" || typeof draft.panel !== "object" || !draft.panel) {
      return undefined;
    }
    return { variables: {}, ...draft } as PanelDraft;
  } catch {
    return undefined;
  }
}

// Removes expired or unreadable drafts and evicts the oldest beyond the cap; returns the survivors.
function pruneDrafts(now: number): PanelDraftEntry[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const storageKey = localStorage.key(i);
    if (storageKey?.startsWith(KEY_PREFIX) && storageKey !== PROBE_KEY) keys.push(storageKey);
  }
  const kept: PanelDraftEntry[] = [];
  for (const storageKey of keys) {
    const draft = parseDraft(localStorage.getItem(storageKey));
    if (!draft || now - draft.savedAt > PANEL_DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(storageKey);
    } else {
      kept.push({ key: storageKey, draft });
    }
  }
  kept.sort((a, b) => b.draft.savedAt - a.draft.savedAt);
  for (const evicted of kept.splice(PANEL_DRAFT_MAX_COUNT)) {
    localStorage.removeItem(evicted.key);
  }
  return kept;
}
