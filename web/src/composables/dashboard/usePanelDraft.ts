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

import { getCurrentInstance, onBeforeUnmount, ref } from "vue";

export const PANEL_DRAFT_VERSION = 1;
export const PANEL_DRAFT_PREFIX = "o2_panel_draft:";
export const PANEL_DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;
export const PANEL_DRAFT_MAX = 20;
export const PANEL_DRAFT_AUTOSAVE_MS = 1000;
export const NEW_PANEL_DRAFT_ID = "new";

/** Bumped on every write, delete and cross-tab storage event, so dots can re-read storage. */
export const panelDraftRevision = ref(0);

export interface PanelDraftScope {
  userEmail: string;
  org: string;
  dashboardId: string;
  /** A saved panel's id; omitted or empty for the dashboard's new-panel draft. */
  panelId?: string | null;
}

export interface PanelDraftLayout {
  currentQueryIndex: number;
  vrlFunctionToggle: boolean;
}

export interface PanelDraftInput {
  tabId: string;
  data: any;
  layout: PanelDraftLayout;
  sessionVariables: any[];
  variablesWithCurrentPanel: string[];
  basePanel?: any;
}

export interface PanelDraft extends PanelDraftInput {
  v: number;
  savedAt: number;
}

const bumpRevision = () => {
  panelDraftRevision.value++;
};

const getStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const onStorageEvent = (event: StorageEvent) => {
  // A null key means another tab cleared the whole storage.
  if (event.key === null || event.key.startsWith(PANEL_DRAFT_PREFIX)) bumpRevision();
};

// Registered once at module load, so reading a draft never adds listeners.
if (typeof window !== "undefined") window.addEventListener("storage", onStorageEvent);

const draftKeys = (storage: Storage): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(PANEL_DRAFT_PREFIX)) keys.push(key);
  }
  return keys;
};

const parseDraft = (raw: string | null): PanelDraft | null => {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    return draft && typeof draft === "object" ? (draft as PanelDraft) : null;
  } catch {
    return null;
  }
};

const isLive = (draft: PanelDraft | null, now: number): draft is PanelDraft =>
  !!draft &&
  draft.v === PANEL_DRAFT_VERSION &&
  typeof draft.savedAt === "number" &&
  now - draft.savedAt <= PANEL_DRAFT_TTL_MS;

const isQuotaError = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");

export const panelDraftKey = (scope: PanelDraftScope): string =>
  PANEL_DRAFT_PREFIX +
  [scope.userEmail, scope.org, scope.dashboardId, scope.panelId || NEW_PANEL_DRAFT_ID].join(":");

/** False in private modes or sandboxes that block localStorage; drafts are then silently off. */
export const isPanelDraftStorageAvailable = (): boolean => {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const probe = `${PANEL_DRAFT_PREFIX}probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
};

/** Drops expired, unreadable and old-format drafts, then keeps only the newest PANEL_DRAFT_MAX. */
export const cleanupPanelDrafts = (now: number = Date.now(), max: number = PANEL_DRAFT_MAX) => {
  const storage = getStorage();
  if (!storage) return 0;
  let removed = 0;
  try {
    const live: { key: string; savedAt: number }[] = [];
    for (const key of draftKeys(storage)) {
      const draft = parseDraft(storage.getItem(key));
      if (isLive(draft, now)) {
        live.push({ key, savedAt: draft.savedAt });
      } else {
        storage.removeItem(key);
        removed++;
      }
    }
    live.sort((a, b) => b.savedAt - a.savedAt);
    for (const { key } of live.slice(Math.max(0, max))) {
      storage.removeItem(key);
      removed++;
    }
  } catch {
    return removed;
  }
  if (removed) bumpRevision();
  return removed;
};

export const readPanelDraft = (scope: PanelDraftScope, now: number = Date.now()) => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const key = panelDraftKey(scope);
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const draft = parseDraft(raw);
    if (isLive(draft, now)) return draft;
    storage.removeItem(key);
    bumpRevision();
  } catch {
    return null;
  }
  return null;
};

/** Side-effect free, so it is safe in a computed; reading the revision re-runs it after any write in any tab. */
export const hasPanelDraft = (scope: PanelDraftScope): boolean => {
  panelDraftRevision.value;
  try {
    return isLive(parseDraft(getStorage()?.getItem(panelDraftKey(scope)) ?? null), Date.now());
  } catch {
    return false;
  }
};

/** Returns false when the draft could not be stored, even after pruning for space. */
export const writePanelDraft = (scope: PanelDraftScope, input: PanelDraftInput): boolean => {
  const storage = getStorage();
  if (!storage) return false;
  const key = panelDraftKey(scope);
  let payload: string;
  try {
    const draft: PanelDraft = { ...input, v: PANEL_DRAFT_VERSION, savedAt: Date.now() };
    payload = JSON.stringify(draft);
  } catch {
    return false;
  }
  const attempt = () => {
    storage.setItem(key, payload);
    bumpRevision();
    return true;
  };
  try {
    attempt();
  } catch (error) {
    if (!isQuotaError(error)) return false;
    try {
      cleanupPanelDrafts(Date.now(), Math.max(0, PANEL_DRAFT_MAX / 2));
      attempt();
    } catch {
      return false;
    }
  }
  return true;
};

export const deletePanelDraft = (scope: PanelDraftScope) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    const key = panelDraftKey(scope);
    if (storage.getItem(key) === null) return;
    storage.removeItem(key);
    bumpRevision();
  } catch {
    /* storage blocked: nothing to delete */
  }
};

/** Drops one panel's drafts, or with no panelId every draft of the dashboard, for every user in this browser. */
export const deletePanelDraftsFor = (target: {
  org: string;
  dashboardId: string;
  panelId?: string | null;
}) => {
  const storage = getStorage();
  if (!storage) return 0;
  let removed = 0;
  try {
    for (const key of draftKeys(storage)) {
      // The email is the only part that may contain a colon, so the other parts are read from the end.
      const [panelId, dashboardId, org] = key.slice(PANEL_DRAFT_PREFIX.length).split(":").reverse();
      if (org !== target.org || dashboardId !== target.dashboardId) continue;
      if (target.panelId && panelId !== target.panelId) continue;
      storage.removeItem(key);
      removed++;
    }
  } catch {
    return removed;
  }
  if (removed) bumpRevision();
  return removed;
};

/** Runs on logout so no draft outlives the session that wrote it. */
export const clearAllPanelDrafts = () => {
  const storage = getStorage();
  if (!storage) return;
  try {
    draftKeys(storage).forEach((key) => storage.removeItem(key));
  } catch {
    return;
  }
  bumpRevision();
};

/** Minute precision in the user's locale and timezone, e.g. "Oct 21, 2026, 14:32". */
export const formatPanelDraftTime = (ts: number, locale: string, timeZone?: string): string => {
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(ts);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(ts);
  }
};

export interface PanelDraftAutosaveOptions {
  /** True once the editor finished loading and the user's first input set the starting snapshot. */
  isReady: () => boolean;
  hasChanges: () => boolean;
  /** Resolves true only when the draft was actually stored. */
  write: () => boolean;
  remove: () => void;
  delay?: number;
}

/** Debounced write-or-delete of the open editor's draft, plus silent writes when the page hides or unloads. */
export const usePanelDraftAutosave = (options: PanelDraftAutosaveOptions) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Only a draft this session wrote or continued may be deleted by undoing; an older kept draft waits for an edit.
  let owned = false;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const flush = () => {
    cancel();
    if (!options.isReady()) return;
    if (options.hasChanges()) {
      // A refused write (storage full, protected draft) must not count as this session's draft.
      if (options.write()) owned = true;
    } else if (owned) {
      options.remove();
      owned = false;
    }
  };

  const schedule = () => {
    cancel();
    timer = setTimeout(flush, options.delay ?? PANEL_DRAFT_AUTOSAVE_MS);
  };

  const adopt = () => {
    owned = true;
  };

  const release = () => {
    cancel();
    owned = false;
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush();
  };

  window.addEventListener("beforeunload", flush);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onVisibilityChange);

  const stop = () => {
    cancel();
    window.removeEventListener("beforeunload", flush);
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };

  // A write still pending at unmount would run against the reset editor and delete the draft.
  if (getCurrentInstance()) onBeforeUnmount(stop);

  return { schedule, flush, cancel, adopt, release, stop };
};
