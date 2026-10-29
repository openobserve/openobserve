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
import { countPanelDraftsFor, formatPanelDraftTime } from "@/composables/dashboard/usePanelDraft";
import {
  draftSessionEnded,
  draftUserSignedOut,
  markDraftSessionEnded,
  resumeDraftSession,
} from "@/utils/drafts/draftSession";

export type EditorDraftKind =
  | "alert"
  | "alert_template"
  | "alert_destination"
  | "downtime"
  | "pipeline"
  | "function"
  | "report"
  | "slo"
  | "synthetic_check"
  | "synthetic_browser"
  | "prompt"
  | "experiment"
  | "dashboard_settings"
  | "cipher_key"
  | "ai_toolset"
  | "announcement_banner"
  | "status_page"
  | "rum_named_event"
  | "iam_role"
  | "oncall_policy"
  | "oncall_schedule"
  | "regex_pattern"
  | "model_pricing"
  | "remote_task"
  | "eval_job"
  | "eval_scorer"
  | "fleet_config";

export interface EditorDraftScope {
  kind: EditorDraftKind;
  org: string;
  /** The saved item's id; null for the editor's new-item draft. */
  entityId: string | null;
  userEmail: string;
  /** Splits the new-item draft into one slot per variant (e.g. a check type); ignored for saved items. */
  variant?: string | null;
}

export interface EditorDraft<T = unknown> {
  v: 1;
  savedAt: number;
  data: T;
  baseHash?: string;
  redactedPaths?: string[];
  /** The `key`/`name`/`id` of the list entry each redacted path sits in, so restore can find it by label. */
  redactedLabels?: Record<string, string>;
  /** Redacted paths whose value the user had changed: restore leaves them blank instead of refilling the old value. */
  changedRedactedPaths?: string[];
}

export interface EditorDraftInput<T = unknown> {
  data: T;
  /** Puts back an earlier draft as it was; a new draft is stamped now. */
  savedAt?: number;
  baseHash?: string;
  redactedPaths?: string[];
  redactedLabels?: Record<string, string>;
  changedRedactedPaths?: string[];
}

/** What identifies a draft within its kind and org. */
export interface EditorDraftKeyParts {
  entityId: string | null;
  variant: string | null;
}

export interface EditorDraftEntry {
  entityId: string | null;
  /** The new-item variant; always null for a saved item's draft. */
  variant: string | null;
  savedAt: number;
}

export const EDITOR_DRAFT_VERSION = 1;
export const EDITOR_DRAFT_PREFIX = "o2_draft:";
export const EDITOR_DRAFT_TTL_MS = 7 * 24 * 60 * 60_000;
/** How many drafts one user keeps per kind in one org; older ones are pruned. */
export const EDITOR_DRAFT_MAX_PER_KIND = 20;
/** Key -> savedAt of every live draft, so lists and counts never parse the drafts themselves. */
export const EDITOR_DRAFT_INDEX_KEY = "o2_draft_index";
export const NEW_EDITOR_DRAFT_ID = "new";
const NEW_VARIANT_PREFIX = `${NEW_EDITOR_DRAFT_ID}~`;

/** Bumped on every write, delete and cross-tab storage event, so list dots can re-read storage. */
export const editorDraftRevision = ref(0);

export {
  draftSessionEnded as editorDraftSessionEnded,
  draftSigningOut as editorDraftSigningOut,
  draftSignOutDiscardOnly as editorDraftSignOutDiscardOnly,
  draftSignOutForced as editorDraftSignOutForced,
  beginDraftSignOut,
  cancelDraftSignOut,
} from "@/utils/drafts/draftSession";

interface ParsedKey {
  kind: string;
  org: string;
  entityId: string | null;
  variant: string | null;
  userEmail: string;
}

const bumpRevision = () => {
  editorDraftRevision.value++;
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
  if (
    event.key === null ||
    event.key === EDITOR_DRAFT_INDEX_KEY ||
    event.key.startsWith(EDITOR_DRAFT_PREFIX)
  ) {
    indexCache = null;
    bumpRevision();
  }
};

// Registered once at module load, so reading a draft never adds listeners.
if (typeof window !== "undefined") window.addEventListener("storage", onStorageEvent);

// An item literally named "new" or "new~..." is escaped so it cannot share a new-item key.
const encodeEntityId = (entityId: string | null, variant?: string | null): string => {
  if (entityId === null || entityId === "") {
    return variant ? NEW_VARIANT_PREFIX + encodeURIComponent(variant) : NEW_EDITOR_DRAFT_ID;
  }
  const encoded = encodeURIComponent(entityId);
  if (encoded === NEW_EDITOR_DRAFT_ID || encoded.startsWith(NEW_VARIANT_PREFIX)) {
    return `%6E${encoded.slice(1)}`;
  }
  return encoded;
};

const decodePart = (part: string): string | null => {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
};

const parseKey = (key: string): ParsedKey | null => {
  const parts = key.slice(EDITOR_DRAFT_PREFIX.length).split(":");
  if (parts.length !== 4) return null;
  const [kind, org, id, email] = parts.map(decodePart);
  if (kind === null || org === null || id === null || email === null) return null;
  if (parts[2] === NEW_EDITOR_DRAFT_ID) {
    return { kind, org, entityId: null, variant: null, userEmail: email };
  }
  if (parts[2].startsWith(NEW_VARIANT_PREFIX)) {
    const variant = decodePart(parts[2].slice(NEW_VARIANT_PREFIX.length));
    return variant ? { kind, org, entityId: null, variant, userEmail: email } : null;
  }
  return { kind, org, entityId: id, variant: null, userEmail: email };
};

const draftKeys = (storage: Storage): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(EDITOR_DRAFT_PREFIX)) keys.push(key);
  }
  return keys;
};

const parseDraft = (raw: string | null): EditorDraft | null => {
  if (!raw) return null;
  try {
    const draft: unknown = JSON.parse(raw);
    return draft && typeof draft === "object" ? (draft as EditorDraft) : null;
  } catch {
    return null;
  }
};

const isLive = (draft: EditorDraft | null, now: number): draft is EditorDraft =>
  !!draft &&
  draft.v === EDITOR_DRAFT_VERSION &&
  typeof draft.savedAt === "number" &&
  now - draft.savedAt <= EDITOR_DRAFT_TTL_MS;

// The index is kept in step with every write and delete, and rebuilt from a full scan when missing or unreadable.
let indexCache: Map<string, number> | null = null;
let indexCacheRaw: string | null = null;

// A key that is not a live draft is indexed at 0, which every list skips as expired until cleanup removes it.
const scanIndex = (storage: Storage, now: number): Map<string, number> => {
  const index = new Map<string, number>();
  for (const key of draftKeys(storage)) {
    const draft = parseDraft(storage.getItem(key));
    index.set(key, parseKey(key) && isLive(draft, now) ? draft.savedAt : 0);
  }
  return index;
};

const persistIndex = (storage: Storage, index: Map<string, number>) => {
  indexCache = index;
  indexCacheRaw = index.size ? JSON.stringify(Object.fromEntries(index)) : null;
  try {
    // No drafts leaves no index behind, so a browser without drafts holds no draft key at all.
    if (indexCacheRaw === null) storage.removeItem(EDITOR_DRAFT_INDEX_KEY);
    else storage.setItem(EDITOR_DRAFT_INDEX_KEY, indexCacheRaw);
  } catch {
    // Storage is full: the in-memory index stays valid against the stale stored one, so lists do not rescan.
    indexCacheRaw = storage.getItem(EDITOR_DRAFT_INDEX_KEY);
  }
};

// Listing keys reads no values, so this stays cheap; a draft key added or removed behind the store's back forces a rebuild.
const coversKeys = (index: Map<string, number>, keys: string[]) =>
  index.size === keys.length && keys.every((key) => index.has(key));

const parseIndex = (raw: string | null): Map<string, number> | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.every(([, at]) => typeof at === "number")) return null;
    return new Map(entries as [string, number][]);
  } catch {
    return null;
  }
};

const readIndex = (storage: Storage): Map<string, number> => {
  const raw = storage.getItem(EDITOR_DRAFT_INDEX_KEY);
  const keys = draftKeys(storage);
  if (indexCache && raw === indexCacheRaw && coversKeys(indexCache, keys)) return indexCache;
  const stored = parseIndex(raw);
  if (stored && coversKeys(stored, keys)) {
    indexCache = stored;
    indexCacheRaw = raw;
    return stored;
  }
  const rebuilt = scanIndex(storage, Date.now());
  persistIndex(storage, rebuilt);
  return rebuilt;
};

// Storage already holds the change, so the index it is applied to is read without the key check, which only follows it.
const updateIndex = (storage: Storage, change: (index: Map<string, number>) => void) => {
  const raw = storage.getItem(EDITOR_DRAFT_INDEX_KEY);
  const known = indexCache && raw === indexCacheRaw ? indexCache : parseIndex(raw);
  const index = new Map(known ?? scanIndex(storage, Date.now()));
  change(index);
  const keys = draftKeys(storage);
  persistIndex(storage, coversKeys(index, keys) ? index : scanIndex(storage, Date.now()));
};

const isQuotaError = (error: unknown) =>
  error instanceof DOMException &&
  (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");

const sortObjectKeys = (_key: string, value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) sorted[key] = source[key];
  return sorted;
};

export const editorDraftKey = (scope: EditorDraftScope): string =>
  EDITOR_DRAFT_PREFIX +
  [
    encodeURIComponent(scope.kind),
    encodeURIComponent(scope.org),
    encodeEntityId(scope.entityId, scope.variant),
    encodeURIComponent(scope.userEmail),
  ].join(":");

/** JSON with object keys sorted, so two equal values always serialise identically. */
export const stableStringify = (value: unknown): string =>
  JSON.stringify(value, sortObjectKeys) ?? "";

/** FNV-1a (32-bit) over the stable JSON of the value, as 8 hex digits. */
export const hashDraftValue = (value: unknown): string => {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

/** False in private modes or sandboxes that block localStorage; drafts are then silently off. */
export const isEditorDraftStorageAvailable = (): boolean => {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const probe = `${EDITOR_DRAFT_PREFIX}probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
};

// One user's drafts of one kind in one org: the unit a cap applies to, so nobody else's draft is ever evicted.
const capGroup = (parsed: ParsedKey) =>
  [parsed.kind, parsed.org, parsed.userEmail].map(encodeURIComponent).join(":");

/** Drops expired, unreadable and old-format drafts, then keeps only the newest `maxPerKind` of each kind per user and org; reads the index, not the drafts. */
export const cleanupEditorDrafts = (
  now: number = Date.now(),
  maxPerKind: number = EDITOR_DRAFT_MAX_PER_KIND,
): number => {
  const storage = getStorage();
  if (!storage) return 0;
  let removed = 0;
  try {
    const live = new Map<string, number>();
    const byGroup = new Map<string, { key: string; savedAt: number }[]>();
    // A rebuilt index holds 0 for an unreadable or old-format draft, so the TTL check removes those too.
    for (const [key, savedAt] of readIndex(storage)) {
      const parsed = parseKey(key);
      if (parsed && now - savedAt <= EDITOR_DRAFT_TTL_MS) {
        live.set(key, savedAt);
        const list = byGroup.get(capGroup(parsed)) ?? [];
        list.push({ key, savedAt });
        byGroup.set(capGroup(parsed), list);
      } else {
        storage.removeItem(key);
        removed++;
      }
    }
    for (const list of byGroup.values()) {
      list.sort((a, b) => b.savedAt - a.savedAt);
      for (const { key } of list.slice(Math.max(0, maxPerKind))) {
        storage.removeItem(key);
        live.delete(key);
        removed++;
      }
    }
    if (removed) persistIndex(storage, live);
  } catch {
    return removed;
  }
  if (removed) bumpRevision();
  return removed;
};

let cleanedThisLoad = false;

/** The cleanup an editor runs on open, done once per page load. */
export const cleanupEditorDraftsOnce = (): void => {
  if (cleanedThisLoad) return;
  cleanedThisLoad = true;
  cleanupEditorDrafts();
};

/** Keeps the newest `keep` drafts of the scope's own kind, user and org, to make room for its next write. */
const pruneScopeGroup = (storage: Storage, scope: EditorDraftScope, keep: number) => {
  const own = parseKey(editorDraftKey(scope));
  if (!own) return;
  const group = capGroup(own);
  const list = [...readIndex(storage)]
    .filter(([key]) => {
      const parsed = parseKey(key);
      return !!parsed && capGroup(parsed) === group;
    })
    .sort((a, b) => b[1] - a[1]);
  const dropped = list.slice(Math.max(0, keep)).map(([key]) => key);
  dropped.forEach((key) => storage.removeItem(key));
  if (dropped.length) updateIndex(storage, (index) => dropped.forEach((key) => index.delete(key)));
};

export const readEditorDraft = <T = unknown>(
  scope: EditorDraftScope,
  now: number = Date.now(),
): EditorDraft<T> | null => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const key = editorDraftKey(scope);
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const draft = parseDraft(raw);
    if (isLive(draft, now)) return draft as EditorDraft<T>;
    storage.removeItem(key);
    updateIndex(storage, (index) => index.delete(key));
    bumpRevision();
  } catch {
    return null;
  }
  return null;
};

/** Side-effect free, so it is safe in a computed; reading the revision re-runs it after any write in any tab. */
export const hasEditorDraft = (scope: EditorDraftScope): boolean => {
  void editorDraftRevision.value;
  try {
    return isLive(parseDraft(getStorage()?.getItem(editorDraftKey(scope)) ?? null), Date.now());
  } catch {
    return false;
  }
};

/** Returns false when the draft could not be stored, even after pruning for space. */
export const writeEditorDraft = <T>(
  scope: EditorDraftScope,
  input: EditorDraftInput<T>,
): boolean => {
  if (draftSessionEnded.value || draftUserSignedOut(scope.userEmail)) return false;
  const storage = getStorage();
  if (!storage) return false;
  const key = editorDraftKey(scope);
  const savedAt = input.savedAt ?? Date.now();
  let payload: string;
  try {
    const draft: EditorDraft<T> = {
      v: EDITOR_DRAFT_VERSION,
      savedAt,
      data: input.data,
      ...(input.baseHash ? { baseHash: input.baseHash } : {}),
      ...(input.redactedPaths?.length ? { redactedPaths: input.redactedPaths } : {}),
      ...(input.redactedLabels && Object.keys(input.redactedLabels).length
        ? { redactedLabels: input.redactedLabels }
        : {}),
      // A not-kept secret left blank is no longer redacted, so it can be changed with nothing redacted.
      ...((input.redactedPaths?.length || input.changedRedactedPaths?.length) &&
      input.changedRedactedPaths
        ? { changedRedactedPaths: input.changedRedactedPaths }
        : {}),
    };
    payload = JSON.stringify(draft);
  } catch {
    return false;
  }
  const attempt = () => {
    storage.setItem(key, payload);
    updateIndex(storage, (index) => index.set(key, savedAt));
    bumpRevision();
  };
  const tryAttempt = () => {
    try {
      attempt();
      return true;
    } catch {
      return false;
    }
  };
  try {
    attempt();
  } catch (error) {
    if (!isQuotaError(error)) return false;
    // Expired and over-cap drafts of anyone go first, before any of this user's live drafts.
    if (cleanupEditorDrafts() > 0 && tryAttempt()) return true;
    try {
      // Room is made only among this user's drafts of this kind in this org.
      pruneScopeGroup(storage, scope, Math.floor(EDITOR_DRAFT_MAX_PER_KIND / 2));
      attempt();
    } catch {
      return false;
    }
  }
  return true;
};

export const deleteEditorDraft = (scope: EditorDraftScope): void => {
  const storage = getStorage();
  if (!storage) return;
  try {
    const key = editorDraftKey(scope);
    if (storage.getItem(key) === null) return;
    storage.removeItem(key);
    updateIndex(storage, (index) => index.delete(key));
    bumpRevision();
  } catch {
    /* storage blocked: nothing to delete */
  }
};

/** Live drafts of one kind for this user and org, newest first; a new-item draft has a null entityId and maybe a variant. */
export const listEditorDrafts = (
  kind: EditorDraftKind,
  org: string,
  userEmail: string,
  now: number = Date.now(),
): EditorDraftEntry[] => {
  void editorDraftRevision.value;
  const storage = getStorage();
  if (!storage) return [];
  const entries: EditorDraftEntry[] = [];
  try {
    for (const [key, savedAt] of readIndex(storage)) {
      if (now - savedAt > EDITOR_DRAFT_TTL_MS) continue;
      const parsed = parseKey(key);
      if (!parsed || parsed.kind !== kind || parsed.org !== org) continue;
      if (parsed.userEmail !== userEmail) continue;
      entries.push({ entityId: parsed.entityId, variant: parsed.variant, savedAt });
    }
  } catch {
    return entries;
  }
  return entries.sort((a, b) => b.savedAt - a.savedAt);
};

/** Ids of saved items that have a live draft; the new-item draft is not included. */
export const listEditorDraftIds = (
  kind: EditorDraftKind,
  org: string,
  userEmail: string,
): string[] =>
  listEditorDrafts(kind, org, userEmail).flatMap((entry) =>
    entry.entityId === null ? [] : [entry.entityId],
  );

/** How many live drafts this user has in this browser, across every kind and org. */
export const countEditorDraftsFor = (userEmail: string, now: number = Date.now()): number => {
  void editorDraftRevision.value;
  const storage = getStorage();
  if (!storage) return 0;
  try {
    return [...readIndex(storage)].filter(
      ([key, savedAt]) =>
        now - savedAt <= EDITOR_DRAFT_TTL_MS && parseKey(key)?.userEmail === userEmail,
    ).length;
  } catch {
    return 0;
  }
};

/** Editor and panel drafts this user would lose by signing out. */
export const countAllDraftsFor = (userEmail: string): number =>
  countEditorDraftsFor(userEmail) + countPanelDraftsFor(userEmail);

const matchesDeleteTarget = (
  parsed: ParsedKey,
  target: {
    entityId?: string;
    variant?: string;
    match?: (draft: EditorDraftKeyParts) => boolean;
  },
): boolean => {
  if (target.match?.({ entityId: parsed.entityId, variant: parsed.variant })) return true;
  if (target.entityId !== undefined && parsed.entityId === target.entityId) return true;
  if (parsed.entityId !== null || parsed.variant === null) return false;
  return target.variant !== undefined && parsed.variant === target.variant;
};

/** Drops one item's drafts for every user in this browser; run when the item is deleted. */
export const deleteEditorDraftsFor = (target: {
  kind: EditorDraftKind;
  org: string;
  entityId?: string;
  /** Also drops every user's new-item drafts in this variant, e.g. the `clone:<id>` copies of a deleted source. */
  variant?: string;
  /** Any other rule over a draft's entity id and variant, e.g. every draft of a deleted team's rotations. */
  match?: (draft: EditorDraftKeyParts) => boolean;
}): number => {
  const storage = getStorage();
  if (!storage) return 0;
  const dropped: string[] = [];
  try {
    for (const key of draftKeys(storage)) {
      const parsed = parseKey(key);
      if (!parsed || parsed.kind !== target.kind || parsed.org !== target.org) continue;
      if (!matchesDeleteTarget(parsed, target)) continue;
      storage.removeItem(key);
      dropped.push(key);
    }
    if (dropped.length)
      updateIndex(storage, (index) => dropped.forEach((key) => index.delete(key)));
  } catch {
    return dropped.length;
  }
  if (dropped.length) bumpRevision();
  return dropped.length;
};

/** Drops every draft of one user in this browser; other users' drafts stay. */
export const clearEditorDraftsFor = (userEmail: string): void => {
  const storage = getStorage();
  if (!storage) return;
  try {
    const dropped = draftKeys(storage).filter((key) => parseKey(key)?.userEmail === userEmail);
    dropped.forEach((key) => storage.removeItem(key));
    updateIndex(storage, (index) => dropped.forEach((key) => index.delete(key)));
  } catch {
    return;
  }
  bumpRevision();
};

/** Runs on an explicit sign-out: drops that user's drafts and refuses writes until `resumeEditorDraftSession`, so an editor still open cannot write one back. */
export const endEditorDraftSession = (userEmail: string): void => {
  markDraftSessionEnded(userEmail);
  clearEditorDraftsFor(userEmail);
};

/** Runs on login, and on app start with a live session; the user's other tabs may write drafts again too. */
export const resumeEditorDraftSession = (userEmail?: string): void => {
  resumeDraftSession(userEmail);
};

/** Minute precision in the user's locale and timezone, the same format the panel drafts use. */
export const formatEditorDraftTime = formatPanelDraftTime;
