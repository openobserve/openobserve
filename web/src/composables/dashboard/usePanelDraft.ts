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

import { computed, onScopeDispose, ref, watch, type ComputedRef, type InjectionKey } from "vue";
import { isEqual } from "lodash-es";
import { getUUID } from "@/utils/uuid";
import { findPanelById } from "@/utils/dashboard/findPanel";

// A dedicated database: the shared o2Cache store LRU-trims and is purged on org switch, which would drop drafts.
const DB_NAME = "o2PanelDrafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

export const PANEL_DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;
export const PANEL_DRAFT_AUTOSAVE_MS = 1000;

export interface PanelDraftScope {
  userId: string;
  org: string;
  dashboardId: string;
}

export interface PanelDraftTarget {
  panelId?: string | null;
  draftId?: string | null;
}

export interface PanelDraftInput extends PanelDraftScope, PanelDraftTarget {
  folder: string;
  tab: string;
  base: unknown;
  data: any;
  variables?: unknown[];
  variablesWithCurrentPanel?: string[];
}

export interface PanelDraftRecord extends PanelDraftInput {
  key: string;
  panelId: string | null;
  draftId: string | null;
  isNew: boolean;
  variables: unknown[];
  variablesWithCurrentPanel: string[];
  updatedAt: number;
}

export type PanelDraftStatus = "new" | "edited" | "stale" | "deleted";

export interface PanelDraftEntry {
  record: PanelDraftRecord;
  status: PanelDraftStatus;
  tabId: string;
}

export interface PanelDraftsContext {
  entries: ComputedRef<PanelDraftEntry[]>;
  byPanelId: ComputedRef<Map<string, PanelDraftEntry>>;
  open: (entry: PanelDraftEntry) => void;
  remove: (entry: PanelDraftEntry) => Promise<void>;
  removeForPanel: (panelId: string) => Promise<void>;
}

export const PANEL_DRAFTS_KEY: InjectionKey<PanelDraftsContext> = Symbol("panelDrafts");

/** Bumped on every write so open dashboards re-read their drafts. */
export const panelDraftsRevision = ref(0);

// Writes started on the way out of the editor may still be in flight when the dashboard reads its drafts.
const pendingWrites = new Set<Promise<unknown>>();

const trackWrite = <T>(write: Promise<T>): Promise<T> => {
  pendingWrites.add(write);
  const settle = () => pendingWrites.delete(write);
  write.then(settle, settle);
  return write;
};

const CHANNEL_NAME = "o2-panel-drafts";
let _channel: BroadcastChannel | null | undefined;
const draftsChannel = (): BroadcastChannel | null => {
  if (_channel === undefined) {
    _channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);
    // Node's channel would otherwise hold the test runner's event loop open.
    (_channel as unknown as { unref?: () => void } | null)?.unref?.();
  }
  return _channel;
};

const notifyDraftsChanged = () => {
  panelDraftsRevision.value++;
  try {
    draftsChannel()?.postMessage("changed");
  } catch {
    /* other tabs simply refresh on their next load */
  }
};

/** Set by the editor when leaving keeps a draft; the dashboard it lands on announces it once. */
let keptDraftToAnnounce: { dashboardId: string; key: string } | null = null;

export const markPanelDraftKept = (dashboardId: string, key: string) => {
  keptDraftToAnnounce = { dashboardId, key };
};

const ANNOUNCED_STORAGE_KEY = "o2-panel-draft-announced";

/** True once per kept draft per browser session, for the dashboard that owns it. */
export const takeKeptDraftAnnouncement = (dashboardId: string): boolean => {
  const pending = keptDraftToAnnounce;
  if (!pending || pending.dashboardId !== dashboardId) return false;
  keptDraftToAnnounce = null;
  let seen: string[] = [];
  try {
    seen = JSON.parse(sessionStorage.getItem(ANNOUNCED_STORAGE_KEY) ?? "[]");
  } catch {
    seen = [];
  }
  if (seen.includes(pending.key)) return false;
  try {
    sessionStorage.setItem(
      ANNOUNCED_STORAGE_KEY,
      JSON.stringify([...seen, pending.key].slice(-50)),
    );
  } catch {
    /* best-effort */
  }
  return true;
};

let _db: IDBDatabase | null = null;
let _openPromise: Promise<IDBDatabase> | null = null;

const openDraftDB = (): Promise<IDBDatabase> => {
  if (_db) return Promise.resolve(_db);
  if (_openPromise) return _openPromise;
  if (typeof indexedDB === "undefined" || indexedDB === null) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  _openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      _openPromise = null;
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onclose = () => {
        _db = null;
        _openPromise = null;
      };
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
        _openPromise = null;
      };
      resolve(_db);
    };
    req.onerror = () => {
      _openPromise = null;
      reject(req.error);
    };
  });
  return _openPromise;
};

const runRequest = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDraftDB();
  const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  return new Promise<T>((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};

const prefixRange = (prefix: string) => IDBKeyRange.bound(prefix, prefix + "￿");

const isExpired = (record: PanelDraftRecord, now: number) =>
  record.updatedAt + PANEL_DRAFT_TTL_MS < now;

// Structured clone rejects Vue proxies, so the payload is always plain JSON.
const toPlain = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));

export const panelDraftPrefix = (scope: PanelDraftScope): string =>
  [scope.userId, scope.org, scope.dashboardId, ""].join("|");

// A draftId wins over panelId so a second editor session can keep its own copy of a panel's edits.
export const panelDraftKey = (scope: PanelDraftScope, target: PanelDraftTarget): string =>
  panelDraftPrefix(scope) + (target.draftId ? `d:${target.draftId}` : `p:${target.panelId}`);

export const newPanelDraftId = (): string => getUUID();

let _availability: Promise<boolean> | null = null;

/** Resolves false where IndexedDB cannot be opened (private modes, jsdom). */
export const isPanelDraftStorageAvailable = (): Promise<boolean> => {
  _availability ??= openDraftDB().then(
    () => true,
    () => {
      _availability = null;
      return false;
    },
  );
  return _availability;
};

export const savePanelDraft = async (input: PanelDraftInput): Promise<PanelDraftRecord> => {
  const panelId = input.panelId || null;
  const draftId = input.draftId || null;
  if (!panelId && !draftId) throw new Error("A panel draft needs a panelId or a draftId");
  const record: PanelDraftRecord = {
    ...input,
    key: panelDraftKey(input, { panelId, draftId }),
    panelId,
    draftId,
    isNew: !panelId,
    base: toPlain(input.base ?? null),
    data: toPlain(input.data),
    variables: toPlain(input.variables ?? []),
    variablesWithCurrentPanel: [...(input.variablesWithCurrentPanel ?? [])],
    updatedAt: Date.now(),
  };
  await trackWrite(runRequest("readwrite", (store) => store.put(record)));
  notifyDraftsChanged();
  return record;
};

export const getPanelDraft = async (
  scope: PanelDraftScope,
  target: PanelDraftTarget,
): Promise<PanelDraftRecord | undefined> => {
  try {
    const key = panelDraftKey(scope, target);
    const record = await runRequest<PanelDraftRecord | undefined>("readonly", (store) =>
      store.get(key),
    );
    if (!record) return undefined;
    if (isExpired(record, Date.now())) {
      await deletePanelDraft(scope, target);
      return undefined;
    }
    return record;
  } catch {
    return undefined;
  }
};

export const deletePanelDraft = async (
  scope: PanelDraftScope,
  target: PanelDraftTarget,
): Promise<void> => {
  try {
    const key = panelDraftKey(scope, target);
    await trackWrite(runRequest("readwrite", (store) => store.delete(key)));
    notifyDraftsChanged();
  } catch {
    /* best-effort */
  }
};

/** Live drafts for one user on one dashboard, newest first. */
export const listPanelDrafts = async (scope: PanelDraftScope): Promise<PanelDraftRecord[]> => {
  try {
    await Promise.allSettled([...pendingWrites]);
    const now = Date.now();
    const all = await runRequest<PanelDraftRecord[]>("readonly", (store) =>
      store.getAll(prefixRange(panelDraftPrefix(scope))),
    );
    return all.filter((r) => !isExpired(r, now)).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
};

/** Deletes every draft past its TTL, across users and orgs. */
export const prunePanelDrafts = async (now: number = Date.now()): Promise<number> => {
  try {
    const all = await runRequest<PanelDraftRecord[]>("readonly", (store) => store.getAll());
    const expired = all.filter((r) => isExpired(r, now));
    for (const record of expired) {
      await runRequest("readwrite", (store) => store.delete(record.key));
    }
    return expired.length;
  } catch {
    return 0;
  }
};

// Layout moves by anyone are not edits to the panel's content.
const comparablePanel = (panel: any) => {
  if (!panel || typeof panel !== "object") return panel ?? null;
  const { layout: _layout, ...rest } = toPlain(panel);
  return rest;
};

export const isPanelDraftStale = (record: PanelDraftRecord, serverPanel: unknown): boolean =>
  !record.isNew && !isEqual(comparablePanel(record.base), comparablePanel(serverPanel));

export const panelDraftStatus = (
  record: PanelDraftRecord,
  dashboard: any,
): { status: PanelDraftStatus; tabId: string } => {
  const firstTab = dashboard?.tabs?.[0]?.tabId ?? record.tab;
  const tabExists = (id: string) => !!dashboard?.tabs?.some((tab: any) => tab?.tabId == id);
  if (record.isNew) {
    return { status: "new", tabId: tabExists(record.tab) ? record.tab : firstTab };
  }
  const found = findPanelById(dashboard, record.panelId, record.tab);
  if (!found) {
    return { status: "deleted", tabId: tabExists(record.tab) ? record.tab : firstTab };
  }
  return {
    status: isPanelDraftStale(record, found.panel) ? "stale" : "edited",
    tabId: found.tab.tabId,
  };
};

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:32 (5 minutes ago)" within a day ("14:32" within the minute), else "Oct 13, 14:32". */
/** `justNow` replaces Intl's bare "now" for anything under a minute old. */
export const formatPanelDraftTime = (
  ts: number,
  locale: string,
  now: number = Date.now(),
  justNow?: string,
) => {
  const date = new Date(ts);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const diff = Math.max(0, now - ts);
  if (diff >= 24 * 60 * 60_000) {
    const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
    return { full: `${day}, ${clock}`, relative: `${day}, ${clock}` };
  }
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const relative =
    diff < 60_000
      ? (justNow ?? rtf.format(0, "second"))
      : diff < 60 * 60_000
        ? rtf.format(-Math.floor(diff / 60_000), "minute")
        : rtf.format(-Math.floor(diff / (60 * 60_000)), "hour");
  // "(just now)" after a clock time that is this minute says nothing new.
  return { full: diff < 60_000 ? clock : `${clock} (${relative})`, relative };
};

/** The current user's drafts on one dashboard, pruned on dashboard change and refreshed on every write. */
export const usePanelDraftsList = (options: {
  scope: () => PanelDraftScope | null;
  dashboard: () => any;
  open: (entry: PanelDraftEntry) => void;
  onKeptDraft?: () => void;
}): PanelDraftsContext => {
  const records = ref<PanelDraftRecord[]>([]);
  let loadSeq = 0;

  const load = async (prune: boolean) => {
    const scope = options.scope();
    const seq = ++loadSeq;
    if (!scope || !(await isPanelDraftStorageAvailable())) {
      records.value = [];
      return;
    }
    if (prune) await prunePanelDrafts();
    const list = await listPanelDrafts(scope);
    if (seq !== loadSeq) return;
    records.value = list;
    if (list.length && takeKeptDraftAnnouncement(scope.dashboardId)) options.onKeptDraft?.();
  };

  watch(
    () => {
      const scope = options.scope();
      return scope ? panelDraftPrefix(scope) : "";
    },
    () => void load(true),
    { immediate: true },
  );
  watch(panelDraftsRevision, () => void load(false));

  const channel = draftsChannel();
  const onChannelMessage = () => void load(false);
  channel?.addEventListener("message", onChannelMessage);
  onScopeDispose(() => channel?.removeEventListener("message", onChannelMessage));

  const entries = computed<PanelDraftEntry[]>(() => {
    const dashboard = options.dashboard();
    return records.value.map((record) => ({ record, ...panelDraftStatus(record, dashboard) }));
  });

  const byPanelId = computed(() => {
    const map = new Map<string, PanelDraftEntry>();
    for (const entry of entries.value) {
      // Records arrive newest first, so the badge opens the latest of several copies.
      if (entry.record.panelId && !map.has(entry.record.panelId)) {
        map.set(entry.record.panelId, entry);
      }
    }
    return map;
  });

  const remove = async (entry: PanelDraftEntry) => {
    const scope = options.scope();
    if (!scope) return;
    await deletePanelDraft(scope, entry.record);
  };

  const removeForPanel = async (panelId: string) => {
    for (const entry of entries.value.filter((e) => e.record.panelId === panelId)) {
      await remove(entry);
    }
  };

  return { entries, byPanelId, open: options.open, remove, removeForPanel };
};
