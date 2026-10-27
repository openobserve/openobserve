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
  | "fleet_config"
  | "prompt"
  | "experiment";

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
  baseHash?: string;
  redactedPaths?: string[];
  redactedLabels?: Record<string, string>;
  changedRedactedPaths?: string[];
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
export const EDITOR_DRAFT_MAX_PER_KIND = 20;
export const NEW_EDITOR_DRAFT_ID = "new";
const NEW_VARIANT_PREFIX = `${NEW_EDITOR_DRAFT_ID}~`;

/** Bumped on every write, delete and cross-tab storage event, so list dots can re-read storage. */
export const editorDraftRevision = ref(0);

export {
  draftSessionEnded as editorDraftSessionEnded,
  draftSigningOut as editorDraftSigningOut,
  draftSignOutDiscardOnly as editorDraftSignOutDiscardOnly,
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
  if (event.key === null || event.key.startsWith(EDITOR_DRAFT_PREFIX)) bumpRevision();
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

/** Drops expired, unreadable and old-format drafts, then keeps only the newest `maxPerKind` of each kind. */
export const cleanupEditorDrafts = (
  now: number = Date.now(),
  maxPerKind: number = EDITOR_DRAFT_MAX_PER_KIND,
): number => {
  const storage = getStorage();
  if (!storage) return 0;
  let removed = 0;
  try {
    const liveByKind = new Map<string, { key: string; savedAt: number }[]>();
    for (const key of draftKeys(storage)) {
      const parsed = parseKey(key);
      const draft = parseDraft(storage.getItem(key));
      if (parsed && isLive(draft, now)) {
        const list = liveByKind.get(parsed.kind) ?? [];
        list.push({ key, savedAt: draft.savedAt });
        liveByKind.set(parsed.kind, list);
      } else {
        storage.removeItem(key);
        removed++;
      }
    }
    for (const list of liveByKind.values()) {
      list.sort((a, b) => b.savedAt - a.savedAt);
      for (const { key } of list.slice(Math.max(0, maxPerKind))) {
        storage.removeItem(key);
        removed++;
      }
    }
  } catch {
    return removed;
  }
  if (removed) bumpRevision();
  return removed;
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
  if (draftSessionEnded.value) return false;
  const storage = getStorage();
  if (!storage) return false;
  const key = editorDraftKey(scope);
  let payload: string;
  try {
    const draft: EditorDraft<T> = {
      v: EDITOR_DRAFT_VERSION,
      savedAt: Date.now(),
      data: input.data,
      ...(input.baseHash ? { baseHash: input.baseHash } : {}),
      ...(input.redactedPaths?.length ? { redactedPaths: input.redactedPaths } : {}),
      ...(input.redactedLabels && Object.keys(input.redactedLabels).length
        ? { redactedLabels: input.redactedLabels }
        : {}),
      ...(input.redactedPaths?.length && input.changedRedactedPaths
        ? { changedRedactedPaths: input.changedRedactedPaths }
        : {}),
    };
    payload = JSON.stringify(draft);
  } catch {
    return false;
  }
  const attempt = () => {
    storage.setItem(key, payload);
    bumpRevision();
  };
  try {
    attempt();
  } catch (error) {
    if (!isQuotaError(error)) return false;
    try {
      cleanupEditorDrafts(Date.now(), Math.floor(EDITOR_DRAFT_MAX_PER_KIND / 2));
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
    for (const key of draftKeys(storage)) {
      const parsed = parseKey(key);
      if (!parsed || parsed.kind !== kind || parsed.org !== org) continue;
      if (parsed.userEmail !== userEmail) continue;
      const draft = parseDraft(storage.getItem(key));
      if (isLive(draft, now)) {
        entries.push({
          entityId: parsed.entityId,
          variant: parsed.variant,
          savedAt: draft.savedAt,
        });
      }
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
    return draftKeys(storage).filter(
      (key) =>
        parseKey(key)?.userEmail === userEmail && isLive(parseDraft(storage.getItem(key)), now),
    ).length;
  } catch {
    return 0;
  }
};

/** Editor and panel drafts this user would lose by signing out. */
export const countAllDraftsFor = (userEmail: string): number =>
  countEditorDraftsFor(userEmail) + countPanelDraftsFor(userEmail);

/** Drops one item's drafts for every user in this browser; run when the item is deleted. */
export const deleteEditorDraftsFor = (target: {
  kind: EditorDraftKind;
  org: string;
  entityId: string;
}): number => {
  const storage = getStorage();
  if (!storage) return 0;
  let removed = 0;
  try {
    for (const key of draftKeys(storage)) {
      const parsed = parseKey(key);
      if (!parsed || parsed.kind !== target.kind || parsed.org !== target.org) continue;
      if (parsed.entityId !== target.entityId) continue;
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
export const clearAllEditorDrafts = (): void => {
  const storage = getStorage();
  if (!storage) return;
  try {
    draftKeys(storage).forEach((key) => storage.removeItem(key));
  } catch {
    return;
  }
  bumpRevision();
};

/** Runs on an explicit sign-out: drops every draft and refuses writes until `resumeEditorDraftSession`, so an editor still open cannot write one back. */
export const endEditorDraftSession = (): void => {
  markDraftSessionEnded();
  clearAllEditorDrafts();
};

/** Runs on login. */
export const resumeEditorDraftSession = (): void => {
  resumeDraftSession();
};

/** Minute precision in the user's locale and timezone, the same format the panel drafts use. */
export const formatEditorDraftTime = formatPanelDraftTime;
