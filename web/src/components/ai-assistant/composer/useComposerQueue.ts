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
  effectScope,
  onScopeDispose,
  reactive,
  toRaw,
  watch,
  type ComputedRef,
  type EffectScope,
} from "vue";

import {
  isRunning,
  useAssistantStore,
  type ComposerSnapshot,
  type ComposerState,
  type Sid,
  type TurnTerminal,
} from "@/composables/assistant";

// Keyed by chat, so a container move or a second composer on the same chat sees one queue.
const queues = reactive(new Map<string, QueuedMessage>());

// The composer showing a chat says whether a send there is held (no access, cooldown, credits).
const guards = new Map<string, () => boolean>();

// One drain for the app's store, outside any component, so a chat's queue goes when its turn ends wherever the user is.
let drain: { store: QueueStore; scope: EffectScope } | null = null;

export interface QueuedMessage {
  text: string;
  at: number;
  /** Everything staged with the text, so it goes out as it was when Enter was pressed. */
  snapshot: ComposerSnapshot;
  /** Handed back, never sent on its own: it came back from a reload or a refused send. */
  held?: true;
}

export interface ComposerQueueOptions {
  sid(): Sid | null;
  /** True while this composer would refuse Send for the chat it shows. */
  blocked?(): boolean;
  /** Called after Edit puts the queued message in the field. */
  focus?(): void;
  /** The store whose turn ends drain the queue of a chat no composer shows; the app's own by default. */
  store?: QueueStore;
}

type QueueComposer = Pick<
  ComposerState,
  "text" | "chips" | "images" | "timeOverride" | "removedPageKeys" | "homeStarter"
>;

type StoredQueue = Pick<
  ComposerState,
  "text" | "chips" | "timeOverride" | "removedPageKeys" | "homeStarter"
>;

/** The slice of the assistant store the background drain reads and drives. */
export interface QueueStore {
  state: {
    sessions: Record<
      string,
      | {
          turn: Parameters<typeof isRunning>[0];
          composer: QueueComposer;
          userOrgKey: string;
          record?: { ephemeral?: boolean };
        }
      | undefined
    >;
  };
  /** The store's tab-scoped draft storage, keyed by user+org and chat. */
  drafts: {
    schedule(userOrgKey: string, sid: Sid, draft: StoredQueue): void;
    read(userOrgKey: string, sid: Sid): StoredQueue | null;
    remove(userOrgKey: string, sid: Sid): void;
  };
  setDraft(sid: Sid, patch: Partial<ComposerState>): void;
  send(sid: Sid): Promise<TurnTerminal | undefined>;
  resend(sid: Sid, snapshot: ComposerSnapshot, input: "typed"): Promise<TurnTerminal | undefined>;
}

export interface ComposerQueue {
  queued: ComputedRef<QueuedMessage | null>;
  /** Moves the whole draft into the queue until the answer ends; false when one already waits. */
  enqueue(): boolean;
  /** Puts the queued message in the field; a draft there becomes the queued message. */
  edit(): void;
}

/** The message waiting in a chat, if any. */
export function queuedOf(sid: Sid | null): QueuedMessage | null {
  return sid ? (queues.get(sid) ?? null) : null;
}

/** Removes and returns a chat's queued message; only one caller ever gets it. */
export function takeQueued(sid: Sid): QueuedMessage | null {
  const item = queues.get(sid) ?? null;
  queues.delete(sid);
  if (item) writeStored(sid, null);
  return item;
}

/** One plain-chat message queued while an answer runs; it sends when the answer ends. */
export function useComposerQueue(options: ComposerQueueOptions): ComposerQueue {
  const store = options.store ?? useAssistantStore();
  const queued = computed(() => queuedOf(options.sid()));
  const blocked = options.blocked;

  if (blocked) {
    let owned: Sid | null = null;
    const release = () => {
      if (owned && guards.get(owned) === blocked) guards.delete(owned);
    };
    watch(
      options.sid,
      (sid) => {
        release();
        owned = sid;
        if (sid) guards.set(sid, blocked);
      },
      { immediate: true },
    );
    onScopeDispose(release);
  }
  watch(options.sid, (sid) => sid && restoreStored(store, sid), { immediate: true });

  function enqueue(): boolean {
    const sid = options.sid();
    const composer = sid ? store.state.sessions[sid]?.composer : undefined;
    if (!sid || !composer || !holdsDraft(composer) || queues.has(sid)) return false;
    putQueued(sid, { text: composer.text, at: Date.now(), snapshot: snapshotOf(composer) });
    store.setDraft(sid, clearedDraft());
    return true;
  }

  // Never joins the two: with a draft in the field the queued message and the draft swap places.
  function edit(): void {
    const sid = options.sid();
    const item = sid ? takeQueued(sid) : null;
    const session = sid ? store.state.sessions[sid] : undefined;
    if (!sid || !item || !session) return;
    const { composer } = session;
    // With no answer running, nothing would end to send it, so the swapped draft waits for the user.
    const held = isRunning(session.turn) ? {} : { held: true as const };
    if (holdsDraft(composer))
      putQueued(sid, {
        text: composer.text,
        at: Date.now(),
        snapshot: snapshotOf(composer),
        ...held,
      });
    store.setDraft(sid, draftOf(item.snapshot));
    options.focus?.();
  }

  installQueueDrain(store);
  return { queued, enqueue, edit };
}

/** Sends or hands back each queued message whose chat's turn ended, whichever chat is on screen. */
export function installQueueDrain(store: QueueStore): void {
  if (drain?.store === store) return;
  drain?.scope.stop();
  const scope = effectScope(true);
  drain = { store, scope };
  scope.run(() =>
    watch(
      () => [...queues.keys()].filter((sid) => endedTurn(store, sid)),
      (ended) => ended.forEach((sid) => drainOne(store, sid)),
      { flush: "post", immediate: true },
    ),
  );
}

/** Lets a spec start with no queued messages; never called by app code. */
export function resetComposerQueueForTests(): void {
  queues.clear();
  guards.clear();
  drain?.scope.stop();
  drain = null;
}

// A chat this store no longer holds keeps its message until it is opened again.
function endedTurn(store: QueueStore, sid: string): boolean {
  const session = store.state.sessions[sid];
  return !!session && !isRunning(session.turn);
}

function drainOne(store: QueueStore, sid: Sid): void {
  const session = store.state.sessions[sid];
  const item = queues.get(sid);
  if (!session || !item || isRunning(session.turn)) return;
  const sendable = session.turn.state === "done" && !item.held && !guards.get(sid)?.();
  if (sendable) return sendQueued(store, sid, item);
  // A message that cannot go now comes back only into an empty field; else Edit swaps them.
  if (holdsDraft(session.composer)) {
    if (session.turn.state === "done" && !item.held) putQueued(sid, { ...item, held: true });
    return;
  }
  takeQueued(sid);
  store.setDraft(sid, draftOf(item.snapshot));
}

// An empty field sends through the composer, as Enter would; a draft typed since stays and the message goes on its own.
function sendQueued(store: QueueStore, sid: Sid, item: QueuedMessage): void {
  takeQueued(sid);
  const composer = store.state.sessions[sid]!.composer;
  const viaComposer = !holdsDraft(composer);
  if (viaComposer) store.setDraft(sid, draftOf(item.snapshot));
  let sent: Promise<TurnTerminal | undefined>;
  try {
    sent = viaComposer ? store.send(sid) : store.resend(sid, item.snapshot, "typed");
  } catch (error) {
    sent = Promise.reject(error);
  }
  void sent.then(
    (result) => result?.state === "refused" && handBack(store, sid, item),
    () => handBack(store, sid, item),
  );
}

// A refused send must not lose the message: the field takes it if empty, else the queue keeps it for Edit.
function handBack(store: QueueStore, sid: Sid, item: QueuedMessage): void {
  const composer = store.state.sessions[sid]?.composer;
  if (composer && composer.text === item.snapshot.text && holdsDraft(composer)) return;
  if (composer && !holdsDraft(composer)) return store.setDraft(sid, draftOf(item.snapshot));
  if (!queues.has(sid)) putQueued(sid, { ...item, held: true });
}

function putQueued(sid: Sid, item: QueuedMessage): void {
  queues.set(sid, item);
  writeStored(sid, item);
}

// Kept in the store's own draft storage under a sibling key, so sign-out's sweep of the user's drafts removes it too; images stay in memory.
function writeStored(sid: Sid, item: QueuedMessage | null): void {
  const store = drain?.store;
  const session = store?.state.sessions[sid];
  if (!store || !session?.userOrgKey || session.record?.ephemeral) return;
  if (!item) return store.drafts.remove(session.userOrgKey, storedSid(sid));
  const { text, chips, timeOverride, removedPageKeys, homeStarter } = item.snapshot;
  store.drafts.schedule(session.userOrgKey, storedSid(sid), {
    text,
    chips,
    timeOverride,
    removedPageKeys: removedPageKeys ?? [],
    ...(homeStarter && { homeStarter }),
  });
}

// A message queued before a reload is held: its answer is gone, so it waits for the user to send it.
function restoreStored(store: QueueStore, sid: Sid): void {
  const session = store.state.sessions[sid];
  if (queues.has(sid) || !session?.userOrgKey || session.record?.ephemeral) return;
  const stored = store.drafts.read(session.userOrgKey, storedSid(sid));
  if (!stored || !holdsDraft({ ...stored, images: [] })) return;
  const snapshot: ComposerSnapshot = {
    text: stored.text,
    chips: stored.chips,
    images: [],
    mentions: [],
    timeOverride: stored.timeOverride,
    removedPageKeys: stored.removedPageKeys,
    ...(stored.homeStarter && { homeStarter: true }),
  };
  queues.set(sid, { text: stored.text, at: Date.now(), snapshot, held: true });
}

function storedSid(sid: Sid): Sid {
  return `${sid}:queued`;
}

// Page chips come with the page, so they alone are not a draft.
function holdsDraft(composer: QueueComposer): boolean {
  return (
    /[^@\s]/.test(composer.text) ||
    composer.images.length > 0 ||
    composer.chips.some((chip) => chip.provenance !== "page")
  );
}

function snapshotOf(composer: QueueComposer): ComposerSnapshot {
  const raw = toRaw(composer);
  return {
    text: raw.text,
    chips: raw.chips.map((chip) => ({ ...toRaw(chip) })),
    images: [...raw.images],
    mentions: [],
    timeOverride: raw.timeOverride ? { ...raw.timeOverride } : null,
    removedPageKeys: [...raw.removedPageKeys],
    ...(raw.homeStarter && { homeStarter: true }),
  };
}

function draftOf(snapshot: ComposerSnapshot): Partial<ComposerState> {
  return {
    text: snapshot.text,
    chips: snapshot.chips.map((chip) => ({ ...chip })),
    images: [...snapshot.images],
    timeOverride: snapshot.timeOverride ? { ...snapshot.timeOverride } : null,
    removedPageKeys: [...(snapshot.removedPageKeys ?? [])],
    homeStarter: snapshot.homeStarter,
    recallIndex: -1,
    recallDraft: null,
  };
}

function clearedDraft(): Partial<ComposerState> {
  return {
    text: "",
    chips: [],
    images: [],
    recallIndex: -1,
    recallDraft: null,
    homeStarter: undefined,
  };
}
