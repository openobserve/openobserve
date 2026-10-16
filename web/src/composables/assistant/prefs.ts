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

import type { HistoryFilter, Placement, Sid } from "./assistantStore.types";
import type { ContextChip } from "./context/types";

export const RECALL_CAP = 10;

const SESSION_PREFIX = "o2.assistant.";

const LEGACY_HOME_ORDER = "o2_home_tab_order";

const LEGACY_HOME_ACTIVE = "o2_home_active_tab";

const LOCAL_KEYS = {
  // The legacy name is kept so recall survives the switch to the new composer.
  recall: (k: string) => `ai-chat-query-history:${k}`,
  sidebar: (k: string) => `o2.assistant.sidebar:${k}`,
  home: (k: string) => `o2.assistant.home:${k}`,
  hints: (k: string) => `o2.assistant.hints:${k}`,
  creditNotice: (k: string, threshold: number) => `o2.assistant.creditNotice:${k}:${threshold}`,
  importDismissed: (k: string) => `o2.assistant.importDismissed:${k}`,
};

const SESSION_KEYS = {
  selected: (k: string) => `o2.assistant.selected:${k}`,
  placement: (k: string) => `o2.assistant.placement:${k}`,
  historyFilter: (k: string) => `o2.assistant.historyFilter:${k}`,
  tab: (k: string) => `o2.assistant.tab:${k}`,
};

// One restore per user+org per page load, so a later "New chat" is never undone by it (constraint 19).
const restoredSelections = new Set<string>();

// Decided once per user+org per page load, so switching back to an earlier org never reads as a duplicate.
const markedTabs = new Map<string, boolean>();

let tabListenersAttached = false;

/** One recalled prompt (`40` §7); images are never recalled. */
export interface RecallEntry {
  text: string;
  chips: ContextChip[];
  at: number;
}

export interface SidebarPrefs {
  widthRem?: number;
  mode?: "pinned" | "floating";
}

export interface HomePrefs {
  order?: string[];
  active?: string | null;
  migratedFromUnscoped?: boolean;
}

export interface HintPrefs {
  recall?: boolean;
  disclosure?: boolean;
}

export interface PlacementPrefs {
  placement: Placement;
  previousPlacement: Placement | null;
}

/** The cached values a `storage` event from another tab can change. */
export type PrefName = "recall" | "sidebar" | "home" | "hints" | "creditNotice" | "importDismissed";

type Area = "local" | "session";

export function readRecall(userOrgKey: string): RecallEntry[] {
  const entries = readJson<RecallEntry[]>("local", LOCAL_KEYS.recall(userOrgKey));
  return Array.isArray(entries) ? entries : [];
}

/** Re-reads, dedupes by text and chip refs, prepends and caps, so two tabs never drop each other's prompts. */
export function pushRecall(userOrgKey: string, entry: RecallEntry): void {
  const identity = recallIdentity(entry);
  const rest = readRecall(userOrgKey).filter((e) => recallIdentity(e) !== identity);
  writeJson("local", LOCAL_KEYS.recall(userOrgKey), [entry, ...rest].slice(0, RECALL_CAP));
}

export function removeRecall(userOrgKey: string): void {
  removeKey("local", LOCAL_KEYS.recall(userOrgKey));
}

export function readSidebar(userOrgKey: string): SidebarPrefs {
  return readJson<SidebarPrefs>("local", LOCAL_KEYS.sidebar(userOrgKey)) ?? {};
}

export function writeSidebar(userOrgKey: string, delta: SidebarPrefs): void {
  mergeJson("local", LOCAL_KEYS.sidebar(userOrgKey), delta);
}

export function readHome(userOrgKey: string): HomePrefs {
  return readJson<HomePrefs>("local", LOCAL_KEYS.home(userOrgKey)) ?? {};
}

export function writeHome(userOrgKey: string, delta: HomePrefs): void {
  mergeJson("local", LOCAL_KEYS.home(userOrgKey), delta);
}

/** Copies the unscoped legacy tab state once; a saved `ai` tab becomes `overview` because the AI tab is gone. */
export function migrateHome(userOrgKey: string): HomePrefs {
  const current = readHome(userOrgKey);
  if (current.migratedFromUnscoped) return current;
  const legacyOrder = readJson<unknown>("local", LEGACY_HOME_ORDER);
  const order = Array.isArray(legacyOrder)
    ? [...new Set(legacyOrder.map((id) => (id === "ai" ? "overview" : String(id))))]
    : current.order;
  const legacyActive = readRaw("local", LEGACY_HOME_ACTIVE);
  const active = legacyActive === "ai" ? "overview" : (legacyActive ?? current.active ?? null);
  return mergeJson<HomePrefs>("local", LOCAL_KEYS.home(userOrgKey), {
    ...(order && { order }),
    active,
    migratedFromUnscoped: true,
  });
}

export function readHints(userOrgKey: string): HintPrefs {
  return readJson<HintPrefs>("local", LOCAL_KEYS.hints(userOrgKey)) ?? {};
}

export function markHintSeen(userOrgKey: string, hint: keyof HintPrefs): void {
  mergeJson<HintPrefs>("local", LOCAL_KEYS.hints(userOrgKey), { [hint]: true });
}

export function isCreditNoticeDismissed(userOrgKey: string, threshold: number): boolean {
  return readRaw("local", LOCAL_KEYS.creditNotice(userOrgKey, threshold)) === "1";
}

export function dismissCreditNotice(userOrgKey: string, threshold: number): void {
  writeRaw("local", LOCAL_KEYS.creditNotice(userOrgKey, threshold), "1");
}

export function isImportDismissed(userOrgKey: string): boolean {
  return readRaw("local", LOCAL_KEYS.importDismissed(userOrgKey)) === "1";
}

export function dismissImport(userOrgKey: string): void {
  writeRaw("local", LOCAL_KEYS.importDismissed(userOrgKey), "1");
}

/** The chat this tab had open for the user+org before a reload, once per page load. */
export function recallSelection(userOrgKey: string): Sid | null {
  if (restoredSelections.has(userOrgKey)) return null;
  restoredSelections.add(userOrgKey);
  return readRaw("session", SESSION_KEYS.selected(userOrgKey));
}

/** `null` forgets the selection ("New chat"). */
export function rememberSelection(userOrgKey: string, sid: Sid | null): void {
  if (sid === null) removeKey("session", SESSION_KEYS.selected(userOrgKey));
  else writeRaw("session", SESSION_KEYS.selected(userOrgKey), sid);
}

export function readPlacement(userOrgKey: string): PlacementPrefs | null {
  return readJson<PlacementPrefs>("session", SESSION_KEYS.placement(userOrgKey));
}

export function writePlacement(userOrgKey: string, value: PlacementPrefs): void {
  writeJson("session", SESSION_KEYS.placement(userOrgKey), value);
}

export function readHistoryFilter(userOrgKey: string): HistoryFilter | null {
  return readJson<HistoryFilter>("session", SESSION_KEYS.historyFilter(userOrgKey));
}

export function writeHistoryFilter(userOrgKey: string, filter: HistoryFilter): void {
  writeJson("session", SESSION_KEYS.historyFilter(userOrgKey), filter);
}

/** Every `o2.assistant.*` sessionStorage key of this user+org, drafts included (sign-out, SH-03 AC 8). */
export function removeAllSessionKeys(userOrgKey: string): void {
  const store = storage("session");
  if (!store) return;
  try {
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(
      (key): key is string =>
        !!key &&
        key.startsWith(SESSION_PREFIX) &&
        (key.endsWith(`:${userOrgKey}`) || key.includes(`:${userOrgKey}:`)),
    );
    for (const key of keys) store.removeItem(key);
  } catch {
    // Blocked storage holds nothing to remove.
  }
}

/** True when this page load is a duplicate of a live tab (sessionStorage is copied on duplicate, SH-02 AC 7). */
export function markTabAlive(userOrgKey: string): { duplicated: boolean } {
  const known = markedTabs.get(userOrgKey);
  if (known !== undefined) return { duplicated: known };
  const duplicated =
    readJson<{ live?: boolean }>("session", SESSION_KEYS.tab(userOrgKey))?.live === true;
  writeJson("session", SESSION_KEYS.tab(userOrgKey), { live: true });
  markedTabs.set(userOrgKey, duplicated);
  attachTabListeners();
  return { duplicated };
}

/** Calls `onChange` when another tab writes one of this user+org's prefs; returns the unsubscribe. */
export function watchPrefs(userOrgKey: string, onChange: (name: PrefName) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: StorageEvent) => {
    const name = event.key ? prefNameOf(userOrgKey, event.key) : null;
    if (name) onChange(name);
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
}

/** Lets a spec start a fresh page load; never called by app code. */
export function resetPrefsForTests(): void {
  restoredSelections.clear();
  markedTabs.clear();
}

// A reload fires pagehide first, so only a marker copied from a live tab still says live.
function attachTabListeners(): void {
  if (tabListenersAttached || typeof window === "undefined") return;
  tabListenersAttached = true;
  const mark = (live: boolean) => () => {
    for (const userOrgKey of markedTabs.keys())
      writeJson("session", SESSION_KEYS.tab(userOrgKey), { live });
  };
  window.addEventListener("pagehide", mark(false));
  window.addEventListener("pageshow", mark(true));
}

function prefNameOf(userOrgKey: string, key: string): PrefName | null {
  if (key === LOCAL_KEYS.recall(userOrgKey)) return "recall";
  if (key === LOCAL_KEYS.sidebar(userOrgKey)) return "sidebar";
  if (key === LOCAL_KEYS.home(userOrgKey)) return "home";
  if (key === LOCAL_KEYS.hints(userOrgKey)) return "hints";
  if (key === LOCAL_KEYS.importDismissed(userOrgKey)) return "importDismissed";
  return key.startsWith(`o2.assistant.creditNotice:${userOrgKey}:`) ? "creditNotice" : null;
}

function recallIdentity(entry: RecallEntry): string {
  const refs = entry.chips.map((c) => `${c.kind}:${c.ref?.type ?? ""}:${c.ref?.id ?? c.id}`);
  return JSON.stringify([entry.text, refs]);
}

function storage(area: Area): Storage | null {
  try {
    return area === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function readRaw(area: Area, key: string): string | null {
  try {
    return storage(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(area: Area, key: string, value: string): boolean {
  try {
    const store = storage(area);
    if (!store) return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeKey(area: Area, key: string): void {
  try {
    storage(area)?.removeItem(key);
  } catch {
    // Blocked storage holds nothing to remove.
  }
}

function readJson<T>(area: Area, key: string): T | null {
  const value = readRaw(area, key);
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function writeJson(area: Area, key: string, value: unknown): boolean {
  return writeRaw(area, key, JSON.stringify(value));
}

// Never writes a whole object from memory: another tab may have written since this tab read (gap-1 §3g).
function mergeJson<T extends object>(area: Area, key: string, delta: Partial<T>): T {
  const stored = readJson<T>(area, key);
  const merged = { ...(stored && typeof stored === "object" ? stored : {}), ...delta } as T;
  writeJson(area, key, merged);
  return merged;
}
