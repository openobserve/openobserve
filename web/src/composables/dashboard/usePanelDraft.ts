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

import { getUUID } from "@/utils/uuid";

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

export interface PanelDraftInput extends PanelDraftScope {
  draftId: string;
  folder: string;
  tab: string;
  data: any;
  variables?: unknown[];
  variablesWithCurrentPanel?: string[];
}

export interface PanelDraftRecord extends PanelDraftInput {
  key: string;
  variables: unknown[];
  variablesWithCurrentPanel: string[];
  updatedAt: number;
}

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

const isExpired = (record: PanelDraftRecord, now: number) =>
  record.updatedAt + PANEL_DRAFT_TTL_MS < now;

// Structured clone rejects Vue proxies, so the payload is always plain JSON.
const toPlain = <T>(value: T): T =>
  value === undefined ? value : JSON.parse(JSON.stringify(value));

/** One draft per user, org and dashboard. */
export const panelDraftKey = (scope: PanelDraftScope): string =>
  [scope.userId, scope.org, scope.dashboardId].join("|");

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
  const record: PanelDraftRecord = {
    ...input,
    key: panelDraftKey(input),
    data: toPlain(input.data),
    variables: toPlain(input.variables ?? []),
    variablesWithCurrentPanel: [...(input.variablesWithCurrentPanel ?? [])],
    updatedAt: Date.now(),
  };
  await runRequest("readwrite", (store) => store.put(record));
  return record;
};

export const getPanelDraft = async (
  scope: PanelDraftScope,
): Promise<PanelDraftRecord | undefined> => {
  try {
    const record = await runRequest<PanelDraftRecord | undefined>("readonly", (store) =>
      store.get(panelDraftKey(scope)),
    );
    if (!record) return undefined;
    if (isExpired(record, Date.now())) {
      await deletePanelDraft(scope);
      return undefined;
    }
    return record;
  } catch {
    return undefined;
  }
};

/** With a draftId, deletes only that draft, so a session never removes a draft it did not write. */
export const deletePanelDraft = async (scope: PanelDraftScope, draftId?: string): Promise<void> => {
  try {
    const key = panelDraftKey(scope);
    if (draftId) {
      const record = await runRequest<PanelDraftRecord | undefined>("readonly", (store) =>
        store.get(key),
      );
      if (record?.draftId !== draftId) return;
    }
    await runRequest("readwrite", (store) => store.delete(key));
  } catch {
    /* best-effort */
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

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:32 (2 hours ago)" within a day, "14:32" within the minute, else "Oct 13, 14:32". */
export const formatPanelDraftTime = (ts: number, locale: string, now: number = Date.now()) => {
  const date = new Date(ts);
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const diff = Math.max(0, now - ts);
  if (diff >= 24 * 60 * 60_000) {
    const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
    return `${day}, ${clock}`;
  }
  if (diff < 60_000) return clock;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const relative =
    diff < 60 * 60_000
      ? rtf.format(-Math.floor(diff / 60_000), "minute")
      : rtf.format(-Math.floor(diff / (60 * 60_000)), "hour");
  return `${clock} (${relative})`;
};
