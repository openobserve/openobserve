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
  Fragment,
  getCurrentInstance,
  isVNode,
  onBeforeUnmount,
  reactive,
  shallowRef,
  Teleport,
  watch,
  type ComponentInternalInstance,
  type VNode,
} from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, type RouteLocationNormalized } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { usePanelDraftAutosave } from "@/composables/dashboard/usePanelDraft";
import {
  cleanupEditorDrafts,
  deleteEditorDraft,
  editorDraftSessionEnded,
  editorDraftSigningOut,
  editorDraftSignOutDiscardOnly,
  editorDraftSignOutForced,
  hashDraftValue,
  isEditorDraftStorageAvailable,
  listEditorDrafts,
  readEditorDraft,
  stableStringify,
  writeEditorDraft,
  type EditorDraft,
  type EditorDraftKind,
  type EditorDraftScope,
} from "@/utils/drafts/editorDraftStore";
import {
  blankRedactedPaths,
  blankSecretLists,
  changedRedactedPaths,
  redactDraftSecrets,
  redactedEntryLabels,
  restoreRedacted,
} from "@/utils/drafts/redactDraftSecrets";

export type EditorDraftRestoreChoice = "continue" | "fresh" | "dismiss";

export type EditorDraftLeaveChoice = "save" | "keep" | "discard" | "stay";

export interface EditorDraftApplyContext<T = unknown> {
  /** Redacted fields the user had changed: they come back blank and must be re-entered before saving. */
  notKeptPaths: string[];
  /** The draft as stored, before any refill, which is what `notKeptPaths` point into. */
  storedData: T;
}

export interface UseEditorDraftOptions<T> {
  kind: EditorDraftKind;
  entityLabel: () => I18nText;
  /** The saved item's id, or null/undefined for a new item. */
  entityId: () => string | null | undefined;
  /** A new item's own draft slot (e.g. its check type), so new items of different variants never share a draft. */
  newVariant?: () => string | null;
  /** Serialisable editor state; must cover everything `hasChanges` tracks. */
  snapshot: () => T;
  apply: (data: T, context: EditorDraftApplyContext<T>) => void | Promise<void>;
  /** Edit mode: the loaded server item, in the same shape on every load; null/undefined once deleted. */
  base?: () => unknown;
  /** The editor's own dirty rule, applied on top of "the snapshot differs from the baseline". */
  hasChanges?: () => boolean;
  /** The part of the snapshot that counts as a change (e.g. without the open tab); the whole snapshot is still drafted. */
  contentOf?: (snapshot: T) => unknown;
  /** After a discard, take the baseline again at the next user input, so a load landing after it is not an edit. */
  rebaselineOnInputAfterDiscard?: boolean;
  /** Runs when a leave takes the edits out of the editor (Discard, or Keep into a draft), e.g. to reset shared editor state. */
  onLeaveWithoutSave?: () => void;
  /** Runs the editor's save without navigating; resolves true on success. */
  save: () => boolean | Promise<boolean>;
  /** Extra redaction after the built-in one; a path into a string (e.g. "/yaml/3") is noted but never restored. */
  redact?: (data: T) => { data: T; paths: string[]; changedPaths?: string[] };
  /** JSON pointers to lists of `{ key|name, value }` entries (e.g. request headers) whose every value is a secret, whatever its name. */
  secretLists?: string[];
  /** Keys the built-in redaction never blanks, for a non-secret field whose name matches the secret pattern (e.g. `authApiKeyHeaderName`). */
  secretExemptKeys?: string[];
  /** Extra elements whose fields count as this editor's, for fields rendered outside its own component tree. */
  inputRoots?: () => (Element | null | undefined)[];
  /** Refills the blanked secrets of a continued draft from the current state, in place of the built-in path restore. */
  restoreSecrets?: (draftData: T, currentData: T, redactedPaths: string[]) => T;
  /** An extra line in the restore dialog about what continuing this draft will do (e.g. a key that is regenerated). */
  restoreNote?: (draftData: T) => I18nText | null;
  /** Names the fields behind redacted paths, so the restore dialog can say which changes were not kept. */
  describeRedacted?: (redactedPaths: string[], draftData: T) => I18nText[];
  restoreTitle?: () => I18nText;
  /** The item has a server-side draft state of its own, so the dialogs say "in this browser" instead of "draft". */
  serverDraftItem?: boolean;
  /** The leave dialog's Save label, when the editor's save is not a plain save (e.g. it publishes). */
  saveLabel?: () => I18nText;
  /** Blanks secrets the built-in redaction cannot see in `base` before it is hashed (the hash is stored with the draft). */
  redactBase?: (base: unknown) => unknown;
  /** Whether a same-component route update leaves this item; defaults to a path change. */
  leaveOnRouteUpdate?: (to: RouteLocationNormalized, from: RouteLocationNormalized) => boolean;
}

export interface EditorDraftDialogState {
  readonly entityLabel: I18nText;
  readonly restoreTitle: I18nText;
  restoreOpen: boolean;
  restoreSavedAt: number;
  changedOnServer: boolean;
  credentialsNotSaved: boolean;
  /** The changed secret fields that were not kept, when the editor names them. */
  notKeptFields: I18nText[];
  /** The editor's own note about the offered draft. */
  restoreNote: I18nText | null;
  leaveOpen: boolean;
  leaveSaving: boolean;
  readonly canKeepDraft: boolean;
  /** False while a sign-out runs with a session that cannot save. */
  readonly canSave: boolean;
  /** Set while signing out, when no draft can be kept. */
  readonly signingOut: boolean;
  /** Set for an item with a server-side draft state: the dialogs avoid the word "draft". */
  readonly serverDraftItem: boolean;
  /** The leave dialog's Save label override. */
  readonly saveLabel: I18nText | null;
}

export interface EditorDraftController {
  start: () => Promise<void>;
  confirmLeave: () => Promise<boolean>;
  /** Keeps the current work as a draft without asking and lets the editor go; false when the draft could not be stored. */
  keepAndRelease: () => boolean;
  /** Call after the save; an editor that stays open must refresh its `base` source first, or the next restore warns of a server change. */
  markSaved: () => void;
  discard: () => void;
  hasUnsavedChanges: () => boolean;
  /** Not-kept fields of a continued draft that are still blank; the editor's Save should wait for them. */
  pendingReentries: () => string[];
  readonly storageAvailable: boolean;
  readonly state: EditorDraftDialogState;
  chooseRestore: (choice: EditorDraftRestoreChoice) => void;
  chooseLeave: (choice: EditorDraftLeaveChoice) => void;
}

export interface EditorDraftIds {
  readonly ids: Set<string>;
  /** Whether the plain new-item draft exists; drafts kept per `newVariant` are read with `hasNewVariant`. */
  readonly hasNew: boolean;
  hasNewVariant: (variant: string) => boolean;
  savedAt: (entityId: string | null) => number | null;
  /** When the new-item draft in this variant was written, or null when there is none. */
  savedAtVariant: (variant: string) => number | null;
}

const isNil = (value: unknown): value is null | undefined => value === null || value === undefined;

const normaliseId = (id: string | null | undefined): string | null =>
  isNil(id) || id === "" ? null : String(id);

const plainCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null)) as T;

const BASELINE_EVENTS = ["pointerdown", "keydown"] as const;

// Autofill, password managers, dictation and IME insert text with no key or pointer event; these fire before it lands.
const FIELD_BASELINE_EVENTS = ["focusin", "beforeinput"] as const;

// Fired after a field's value changed, so keys that only move or submit never count.
const EDIT_EVENTS = ["input", "change"] as const;

const signingOutNow = () => editorDraftSigningOut.value || editorDraftSessionEnded.value;

// A control inside `aria-hidden` (reka's native select or checkbox mirror) changes when code sets a value, not the user.
const isEditable = (target: EventTarget | null): target is HTMLElement =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches("input, textarea, select")) &&
  !target.closest('[aria-hidden="true"]');

const fieldValue = (field: HTMLElement): string => {
  if (field instanceof HTMLInputElement && (field.type === "checkbox" || field.type === "radio")) {
    return String(field.checked);
  }
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field.value;
  if (field instanceof HTMLSelectElement) return field.value;
  return field.textContent ?? "";
};

const isTeleport = (vnode: VNode) => (vnode.type as unknown) === Teleport;

const vnodeChildren = (vnode: VNode): VNode[] =>
  Array.isArray(vnode.children) ? vnode.children.filter(isVNode) : [];

// A component root (e.g. OPageLayout) or a fragment, with dev-build comments, has its elements further down.
const vnodeElements = (vnode: VNode): Element[] => {
  if (vnode.component) return vnodeElements(vnode.component.subTree);
  if (vnode.type === Fragment || isTeleport(vnode))
    return vnodeChildren(vnode).flatMap(vnodeElements);
  if (!(vnode.el instanceof Element)) return [];
  return [vnode.el, ...vnodeChildren(vnode).flatMap(teleportedElements)];
};

// A drawer or dialog the editor renders is teleported out of its root element, so its content is a root of its own.
const teleportedElements = (vnode: VNode): Element[] => {
  if (isTeleport(vnode)) return vnodeElements(vnode);
  if (vnode.component) return teleportedElements(vnode.component.subTree);
  return vnodeChildren(vnode).flatMap(teleportedElements);
};

/** The editor component's own root elements. */
const rootElements = (instance: ComponentInternalInstance | null): Element[] =>
  instance?.subTree ? vnodeElements(instance.subTree) : [];

// Never equal to a snapshot's JSON, so the form counts as changed until the next rebaseline.
const CHANGED_BEFORE_START = "\u0000changed-before-start";

/** Local drafts, restore dialog, leave dialog and autosave for one full-page editor. */
export const useEditorDraft = <T>(options: UseEditorDraftOptions<T>): EditorDraftController => {
  const store = useStore();
  const { t } = useI18nTyped();
  const storageAvailable = isEditorDraftStorageAvailable();

  const scopeParts = { org: "", userEmail: "" };
  let draftEntityId: string | null = null;
  let draftVariant: string | null = null;
  let started = false;
  let disposed = false;
  let baselineJson: string | null = null;
  // Set once a leave is allowed: what the editor changes on its way out (e.g. a stopped recording) is not drafted.
  let leaving = false;
  const instance = getCurrentInstance();

  /** An editable control inside this editor, outside any aria-hidden mirror. */
  const isEditorField = (target: EventTarget | null): target is HTMLElement =>
    isEditable(target) &&
    [...rootElements(instance), ...(options.inputRoots?.() ?? [])].some(
      (root) => !!root && root.contains(target),
    );

  // Fields edited while the item was still loading, with the value the user left in each.
  const preStartEdits = new Map<HTMLElement, string>();
  // Reactive, so an editor's computed field errors follow it.
  const notKept = shallowRef<{ paths: string[]; labels: Record<string, string> }>({
    paths: [],
    labels: {},
  });
  // Set when Escape kept the stored draft: a save or discard with no edit leaves it; the first edit's autosave replaces it.
  let keptSavedAt: number | null = null;
  let restoreResolver: ((choice: EditorDraftRestoreChoice) => void) | null = null;
  let leaveResolver: ((choice: EditorDraftLeaveChoice) => void) | null = null;

  const state = reactive({
    entityLabel: computed(() => options.entityLabel()),
    restoreTitle: computed(() =>
      options.restoreTitle ? options.restoreTitle() : t("common.editorDraft.restoreTitle"),
    ),
    restoreOpen: false,
    restoreSavedAt: 0,
    changedOnServer: false,
    credentialsNotSaved: false,
    notKeptFields: [] as I18nText[],
    restoreNote: null as I18nText | null,
    leaveOpen: false,
    leaveSaving: false,
    canKeepDraft: computed(() => storageAvailable && !signingOutNow()),
    canSave: computed(() => !editorDraftSignOutDiscardOnly.value),
    signingOut: computed(() => signingOutNow()),
    serverDraftItem: !!options.serverDraftItem,
    saveLabel: computed(() => options.saveLabel?.() ?? null),
  });

  const scope = (): EditorDraftScope => ({
    kind: options.kind,
    org: scopeParts.org,
    entityId: draftEntityId,
    userEmail: scopeParts.userEmail,
    variant: draftVariant,
  });

  const captureEntity = () => {
    draftEntityId = normaliseId(options.entityId());
    draftVariant = draftEntityId === null ? (options.newVariant?.() ?? null) || null : null;
  };

  const currentJson = () => stableStringify(options.snapshot());

  const changeKey = (json: string): string =>
    options.contentOf ? stableStringify(options.contentOf(JSON.parse(json) as T)) : json;

  const hasUnsavedChanges = (): boolean => {
    if (!started || disposed || baselineJson === null) return false;
    if (
      baselineJson !== CHANGED_BEFORE_START &&
      changeKey(currentJson()) === changeKey(baselineJson)
    )
      return false;
    return options.hasChanges ? options.hasChanges() : true;
  };

  const keptDraftStillStored = () =>
    keptSavedAt !== null && readEditorDraft(scope())?.savedAt === keptSavedAt;

  const baselineSnapshot = (): unknown =>
    baselineJson === null || baselineJson === CHANGED_BEFORE_START
      ? null
      : (JSON.parse(baselineJson) as unknown);

  // The hash is stored next to the draft, so it covers the base only after the draft's own redaction.
  const baseHashOf = (base: unknown): string => {
    const redacted = redactDraftSecrets(options.redactBase ? options.redactBase(base) : base, {
      containers: !options.redact,
      exemptKeys: options.secretExemptKeys,
    });
    return hashDraftValue(redacted.data);
  };

  /** Writes this session's draft over any kept one (it only runs once there is an edit); false when storage refused it. */
  const writeSessionDraft = (): boolean => {
    if (!storageAvailable) return false;
    keptSavedAt = null;
    const snapshot = options.snapshot();
    // An editor with its own redaction knows which fields of its secret containers are safe to keep.
    const redacted = redactDraftSecrets(snapshot, {
      containers: !options.redact,
      exemptKeys: options.secretExemptKeys,
    });
    const listPaths = blankSecretLists(redacted.data, options.secretLists ?? []);
    const extra = options.redact ? options.redact(redacted.data) : null;
    const base = options.base?.();
    const redactedPaths = [...new Set([...redacted.paths, ...listPaths, ...(extra?.paths ?? [])])];
    const changed = changedRedactedPaths(snapshot, baselineSnapshot(), redactedPaths);
    return writeEditorDraft(scope(), {
      data: extra ? extra.data : redacted.data,
      baseHash: isNil(base) ? undefined : baseHashOf(base),
      redactedPaths,
      redactedLabels: redactedEntryLabels(snapshot, redactedPaths),
      changedRedactedPaths: [...new Set([...changed, ...(extra?.changedPaths ?? [])])],
    });
  };

  // Registered before the autosave's own unmount hook, which cancels the pending write.
  if (getCurrentInstance()) {
    onBeforeUnmount(() => {
      if (started && !disposed) autosave.flushPending();
    });
  }

  const autosave = usePanelDraftAutosave({
    isReady: () => storageAvailable && started && !disposed && !leaving && baselineJson !== null,
    hasChanges: hasUnsavedChanges,
    write: () => writeSessionDraft(),
    remove: () => deleteEditorDraft(scope()),
  });

  // A draft kept by Escape belongs to an earlier session, so this session's save or discard leaves it.
  const discardSessionDraft = () => {
    autosave.release();
    if (!keptDraftStillStored()) deleteEditorDraft(scope());
  };

  const rebaseline = () => {
    if (started) baselineJson = currentJson();
  };

  const rebaselineAfterDiscard = () => {
    if (!options.rebaselineOnInputAfterDiscard) return rebaseline();
    if (!started) return;
    baselineJson = null;
    addBaselineListeners();
  };

  const captureBaselineOnFirstInput = () => {
    if (started && baselineJson === null) baselineJson = currentJson();
    if (baselineJson !== null) removeBaselineListeners();
  };

  const captureBaselineOnFieldInput = (event: Event) => {
    if (isEditorField(event.target)) captureBaselineOnFirstInput();
  };

  // A user input after an allowed leave means the leave did not happen, so drafting resumes.
  const resumeAfterLeave = () => {
    leaving = false;
    removeResumeListeners();
  };

  const removeResumeListeners = () => {
    BASELINE_EVENTS.forEach((name) => window.removeEventListener(name, resumeAfterLeave, true));
  };

  const markLeaving = () => {
    leaving = true;
    BASELINE_EVENTS.forEach((name) => window.addEventListener(name, resumeAfterLeave, true));
  };

  const removeBaselineListeners = () => {
    BASELINE_EVENTS.forEach((name) =>
      window.removeEventListener(name, captureBaselineOnFirstInput, true),
    );
    FIELD_BASELINE_EVENTS.forEach((name) =>
      window.removeEventListener(name, captureBaselineOnFieldInput, true),
    );
  };

  const addBaselineListeners = () => {
    BASELINE_EVENTS.forEach((name) =>
      window.addEventListener(name, captureBaselineOnFirstInput, true),
    );
    FIELD_BASELINE_EVENTS.forEach((name) =>
      window.addEventListener(name, captureBaselineOnFieldInput, true),
    );
  };

  // A draft written before changes were tracked cannot tell, so every secret in it counts as changed.
  const notKeptPathsOf = (draft: EditorDraft<T>): string[] =>
    draft.changedRedactedPaths ?? draft.redactedPaths ?? [];

  const askRestore = (draft: EditorDraft<T>, changedOnServer: boolean) =>
    new Promise<EditorDraftRestoreChoice>((resolve) => {
      restoreResolver = resolve;
      state.restoreSavedAt = draft.savedAt;
      state.changedOnServer = changedOnServer;
      const changed = notKeptPathsOf(draft);
      state.credentialsNotSaved = changed.length > 0;
      state.restoreNote = options.restoreNote?.(draft.data) ?? null;
      state.notKeptFields = changed.length
        ? (options.describeRedacted?.(changed, draft.data) ?? [])
        : [];
      state.restoreOpen = true;
    });

  const chooseRestore = (choice: EditorDraftRestoreChoice) => {
    const resolve = restoreResolver;
    restoreResolver = null;
    state.restoreOpen = false;
    resolve?.(choice);
  };

  const continueDraft = async (draft: EditorDraft<T>) => {
    const current = plainCopy(options.snapshot());
    // Taken before applying, so the restored work counts as unsaved against the state it replaces.
    baselineJson = stableStringify(current);
    const changed = notKeptPathsOf(draft);
    // A changed secret is never refilled: the old value would silently replace what the user typed.
    const paths = (draft.redactedPaths ?? []).filter((path) => !changed.includes(path));
    const restored = options.restoreSecrets
      ? options.restoreSecrets(draft.data, current, paths)
      : restoreRedacted(draft.data, current, paths, draft.redactedLabels ?? {});
    notKept.value = { paths: changed, labels: draft.redactedLabels ?? {} };
    await options.apply(restored, { notKeptPaths: changed, storedData: plainCopy(draft.data) });
    autosave.adopt();
  };

  const offerRestore = async (draft: EditorDraft<T>) => {
    const base = options.base?.();
    if (draftEntityId !== null && options.base && isNil(base)) {
      deleteEditorDraft(scope());
      toast({
        variant: "info",
        message: t("common.editorDraft.itemDeleted", { entity: state.entityLabel }),
      });
      return;
    }
    const changedOnServer = !!draft.baseHash && !isNil(base) && baseHashOf(base) !== draft.baseHash;
    const choice = await askRestore(draft, changedOnServer);
    if (disposed) return;
    if (choice === "fresh") deleteEditorDraft(scope());
    if (choice === "dismiss") keptSavedAt = draft.savedAt;
    if (choice === "continue") await continueDraft(draft);
  };

  const start = async () => {
    if (disposed) return;
    started = false;
    baselineJson = null;
    keptSavedAt = null;
    notKept.value = { paths: [], labels: {} };
    resumeAfterLeave();
    // An edit the load then overwrote no longer shows its value, so only one still on screen counts.
    const edited = [...preStartEdits].some(
      ([field, value]) => field.isConnected && fieldValue(field) === value,
    );
    autosave.release();
    // Captured here, so an org switch still writes the draft under the org it was made in.
    scopeParts.org = String(store.state.selectedOrganization?.identifier ?? "");
    scopeParts.userEmail = String(store.state.userInfo?.email ?? "");
    captureEntity();
    if (storageAvailable) {
      cleanupEditorDrafts();
      const draft = readEditorDraft<T>(scope());
      if (draft) await offerRestore(draft);
      if (disposed) return;
    }
    started = true;
    preStartEdits.clear();
    // The edit is already in the form, so a baseline taken now would hide it.
    if (baselineJson === null && edited) baselineJson = CHANGED_BEFORE_START;
    if (baselineJson === null) addBaselineListeners();
  };

  const markSaved = () => {
    notKept.value = { paths: [], labels: {} };
    discardSessionDraft();
    captureEntity();
    rebaseline();
  };

  const discard = () => {
    notKept.value = { paths: [], labels: {} };
    discardSessionDraft();
    rebaselineAfterDiscard();
  };

  const askLeave = () =>
    new Promise<EditorDraftLeaveChoice>((resolve) => {
      leaveResolver = resolve;
      state.leaveOpen = true;
    });

  const chooseLeave = (requested: EditorDraftLeaveChoice) => {
    // A forced sign-out cannot be cancelled: closing the dialog discards and the sign-out goes on.
    const choice = requested === "stay" && editorDraftSignOutForced.value ? "discard" : requested;
    if (state.leaveSaving || (choice === "save" && !state.canSave)) return;
    const resolve = leaveResolver;
    leaveResolver = null;
    // Save keeps the dialog up with its spinner until the save settles.
    if (choice !== "save") state.leaveOpen = false;
    resolve?.(choice);
  };

  const saveFromLeave = async (): Promise<boolean> => {
    state.leaveSaving = true;
    let saved = false;
    try {
      saved = await options.save();
    } catch {
      saved = false;
    } finally {
      state.leaveSaving = false;
      state.leaveOpen = false;
    }
    if (saved) markSaved();
    return saved;
  };

  const keepAndRelease = (): boolean => {
    const kept = keepWork();
    if (kept) markLeaving();
    return kept;
  };

  const keepWork = (): boolean => {
    if (!hasUnsavedChanges()) {
      autosave.flush();
      return true;
    }
    // An explicit Keep draft replaces a kept older draft; a refused write must not lose the edits silently.
    if (!writeSessionDraft()) {
      toast({
        variant: "error",
        message: t("common.editorDraft.keepFailed", { entity: state.entityLabel }),
      });
      return false;
    }
    autosave.release();
    rebaseline();
    return true;
  };

  /** Carries out the leave dialog's answer; resolves true when the user may leave. */
  const resolveLeave = async (choice: EditorDraftLeaveChoice): Promise<boolean> => {
    if (choice === "stay") return false;
    if (choice === "save") return saveFromLeave();
    if (choice === "keep") {
      if (!keepWork()) return false;
      options.onLeaveWithoutSave?.();
      rebaseline();
      return true;
    }
    discardSessionDraft();
    options.onLeaveWithoutSave?.();
    rebaselineAfterDiscard();
    return true;
  };

  const decideLeave = async (): Promise<boolean> => {
    // A second navigation while the dialog is up, or while its Save runs, must not stack another dialog.
    if (leaveResolver || state.leaveOpen || state.leaveSaving) return false;
    if (!hasUnsavedChanges()) {
      // Edits that were undone must not leave their earlier draft behind.
      autosave.flush();
      return true;
    }
    return resolveLeave(await askLeave());
  };

  const confirmLeave = async (): Promise<boolean> => {
    const allowed = await decideLeave();
    if (allowed) markLeaving();
    return allowed;
  };

  const noteEditBeforeStart = (event: Event) => {
    const field = event.target;
    if (started || state.restoreOpen || !isEditorField(field)) return;
    preStartEdits.set(field, fieldValue(field));
  };

  const orgChanged = () =>
    started && String(store.state.selectedOrganization?.identifier ?? "") !== scopeParts.org;

  const guardNavigation = async (): Promise<boolean> => {
    // A sign-out drops every draft, so only Save or Discard is offered and the org-switch flush is skipped.
    if (signingOutNow()) return confirmLeave();
    // An org switch is forced: the draft is written under the old org and the editor goes.
    if (orgChanged()) {
      autosave.flush();
      markLeaving();
      return true;
    }
    return confirmLeave();
  };

  const leavesOnUpdate =
    options.leaveOnRouteUpdate ??
    ((to: RouteLocationNormalized, from: RouteLocationNormalized) => to.path !== from.path);

  if (getCurrentInstance()) {
    EDIT_EVENTS.forEach((name) => window.addEventListener(name, noteEditBeforeStart, true));
    onBeforeRouteLeave(() => guardNavigation());
    onBeforeRouteUpdate((to, from) => (leavesOnUpdate(to, from) ? guardNavigation() : true));
    onBeforeUnmount(() => {
      disposed = true;
      removeBaselineListeners();
      removeResumeListeners();
      EDIT_EVENTS.forEach((name) => window.removeEventListener(name, noteEditBeforeStart, true));
      // Settles the opening sequence and any open leave guard, so nothing keeps this editor alive.
      chooseRestore("dismiss");
      state.leaveSaving = false;
      chooseLeave("stay");
    });
  }

  watch(
    () => options.snapshot(),
    () => {
      if (started && storageAvailable) autosave.schedule();
    },
    { deep: true },
  );

  // An org switch remounts the editor without a route leave, so the draft is written before the old org is gone.
  watch(
    () => store.state.selectedOrganization?.identifier,
    (next, prev) => {
      if (prev && next !== prev) autosave.flush();
    },
    { flush: "sync" },
  );

  return {
    start,
    confirmLeave,
    keepAndRelease,
    markSaved,
    discard,
    hasUnsavedChanges,
    pendingReentries: () =>
      blankRedactedPaths(options.snapshot(), notKept.value.paths, notKept.value.labels),
    storageAvailable,
    state,
    chooseRestore,
    chooseLeave,
  };
};

/** Reactive draft ids of one editor kind for the current user and org, for list-page dots. */
export const useEditorDraftIds = (kind: EditorDraftKind): EditorDraftIds => {
  const store = useStore();
  const entries = computed(() =>
    listEditorDrafts(
      kind,
      String(store.state.selectedOrganization?.identifier ?? ""),
      String(store.state.userInfo?.email ?? ""),
    ),
  );
  const savedAtById = computed(
    () =>
      new Map(
        entries.value.flatMap((entry) =>
          entry.variant === null ? [[entry.entityId, entry.savedAt] as const] : [],
        ),
      ),
  );
  const newVariants = computed(
    () =>
      new Map(
        entries.value.flatMap((entry) =>
          entry.entityId === null && entry.variant !== null
            ? [[entry.variant, entry.savedAt] as const]
            : [],
        ),
      ),
  );
  return reactive({
    ids: computed(
      () =>
        new Set(
          entries.value.flatMap((entry) => (entry.entityId === null ? [] : [entry.entityId])),
        ),
    ),
    hasNew: computed(() => savedAtById.value.has(null)),
    hasNewVariant: (variant: string) => newVariants.value.has(variant),
    savedAt: (entityId: string | null) => savedAtById.value.get(normaliseId(entityId)) ?? null,
    savedAtVariant: (variant: string) => newVariants.value.get(variant) ?? null,
  });
};
