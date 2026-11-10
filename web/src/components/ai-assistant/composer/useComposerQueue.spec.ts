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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, reactive, ref } from "vue";

import type {
  ComposerSnapshot,
  ComposerState,
  ContextChip,
  ImageAttachment,
  TurnState,
  TurnTerminal,
} from "@/composables/assistant";
import { queuedDraftSid } from "@/composables/assistant";
import { raw } from "@/types/i18n";

import { fakeAssistant } from "../__tests__/fakeAssistant";

import {
  queuedOf,
  resetComposerQueueForTests,
  takeQueued,
  useComposerQueue,
  type ComposerQueue,
} from "./useComposerQueue";

type FakeComposer = Pick<
  ComposerState,
  | "text"
  | "chips"
  | "images"
  | "timeOverride"
  | "removedPageKeys"
  | "homeStarter"
  | "recallIndex"
  | "recallDraft"
>;

const ROW: ContextChip = {
  id: "row-1",
  kind: "log_row",
  label: raw("Log row · cart · 13:57"),
  data: { level: "error" },
  sizeBytes: 17,
  provenance: "door",
  sent: "serialized",
};
const PAGE: ContextChip = { ...ROW, id: "page-1", provenance: "page" };
const IMAGE: ImageAttachment = {
  data: "AAAA",
  mimeType: "image/png",
  filename: "a.png",
  size: 1024,
};
const WINDOW = { from: 1_700_000_000_000_000, to: 1_700_000_900_000_000, period: "15m" };
const DONE = { state: "done", saved: "server" } as TurnState;
const STOPPED = { state: "stopped", steps: 1, partial: true } as TurnState;
const REFUSED = { state: "refused", error: { code: "turn_locked" } } as unknown as TurnTerminal;

const composerOf = (text = ""): FakeComposer => ({
  text,
  chips: [],
  images: [],
  timeOverride: null,
  removedPageKeys: [],
  recallIndex: -1,
  recallDraft: null,
});

type Stored = Pick<ComposerState, "text" | "chips" | "timeOverride" | "removedPageKeys">;

// The draft store's contract: one payload per user+org and chat key, surviving a reload of the tab.
function fakeDrafts(saved = new Map<string, Stored>()) {
  return {
    saved,
    schedule: (key: string, sid: string, draft: Stored) =>
      saved.set(`${key}|${sid}`, JSON.parse(JSON.stringify(draft))),
    read: (key: string, sid: string) => saved.get(`${key}|${sid}`) ?? null,
    remove: (key: string, sid: string) => void saved.delete(`${key}|${sid}`),
  };
}

// The store's own shape for two chats: the turn, the composer and the key drafts are stored under.
function fakeStore(drafts = fakeDrafts()) {
  const store = reactive({
    drafts,
    state: {
      sessions: {
        s1: {
          turn: { state: "responding.writing" } as TurnState,
          composer: composerOf(),
          userOrgKey: "u1:default",
        },
        s2: {
          turn: { state: "idle" } as TurnState,
          composer: composerOf(),
          userOrgKey: "u1:default",
        },
      } as Record<string, { turn: TurnState; composer: FakeComposer; userOrgKey: string }>,
    },
    setDraft: vi.fn((sid: string, patch: Partial<ComposerState>) => {
      Object.assign(store.state.sessions[sid]!.composer, patch);
    }),
    sentComposer: [] as FakeComposer[],
    // Like the engine's `queueTurn`: the composer's content is what goes, and the field clears.
    send: vi.fn(async (sid: string): Promise<TurnTerminal | undefined> => {
      const composer = store.state.sessions[sid]!.composer;
      store.sentComposer.push(JSON.parse(JSON.stringify(composer)));
      Object.assign(composer, { text: "", chips: [], images: [] });
      return DONE as TurnTerminal;
    }),
    resend: vi.fn(
      async (_sid: string, _snapshot: ComposerSnapshot): Promise<TurnTerminal | undefined> =>
        DONE as TurnTerminal,
    ),
  });
  return store;
}

type Store = ReturnType<typeof fakeStore>;

function harness(sid = "s1", store: Store = fakeStore(), blocked?: () => boolean) {
  let queue!: ComposerQueue;
  const shown = ref(sid);
  const focus = vi.fn();
  const wrapper = mount(
    defineComponent({
      setup() {
        queue = useComposerQueue({ sid: () => shown.value, blocked, focus, store });
        return () => null;
      },
    }),
  );
  return { store, shown, focus, wrapper, queue: () => queue };
}

const composer = (store: Store, sid = "s1") => store.state.sessions[sid]!.composer;
const type = (store: Store, text: string, sid = "s1") => (composer(store, sid).text = text);
const sentText = (store: Store) => [
  ...store.sentComposer.map((c) => c.text),
  ...store.resend.mock.calls.map((call) => call[1].text),
];

afterEach(() => resetComposerQueueForTests());

describe("useComposerQueue: Enter while answering queues one message", () => {
  it("holds one message and refuses a second until the answer ends", () => {
    const { queue, store } = harness();
    type(store, "first");
    expect(queue().enqueue()).toBe(true);
    type(store, "second");
    expect(queue().enqueue()).toBe(false);
    type(store, "   ");
    expect(queue().enqueue()).toBe(false);
    expect(queue().queued.value?.text).toBe("first");
  });

  it("Q1: queues the staged chip, image and time window with the text and clears them from the field", () => {
    const { queue, store } = harness();
    Object.assign(composer(store), {
      text: "why these errors?",
      chips: [ROW],
      images: [IMAGE],
      timeOverride: WINDOW,
    });
    expect(queue().enqueue()).toBe(true);
    expect(queuedOf("s1")?.snapshot).toMatchObject({
      text: "why these errors?",
      chips: [ROW],
      images: [IMAGE],
      timeOverride: WINDOW,
    });
    expect(composer(store)).toMatchObject({ text: "", chips: [], images: [] });
  });

  it("Q1: sends the queued message through the composer, chips and window included, when the answer ends well", async () => {
    const { queue, store } = harness();
    Object.assign(composer(store), { text: "and the p95?", chips: [ROW], timeOverride: WINDOW });
    queue().enqueue();
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(store.send).toHaveBeenCalledWith("s1");
    expect(store.resend).not.toHaveBeenCalled();
    expect(store.sentComposer[0]).toMatchObject({
      text: "and the p95?",
      chips: [ROW],
      timeOverride: WINDOW,
    });
    expect(queuedOf("s1")).toBeNull();
  });

  it("a page chip alone is not a draft, so the queued message still goes through the composer", async () => {
    const { queue, store } = harness();
    type(store, "next");
    queue().enqueue();
    composer(store).chips = [PAGE];
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(sentText(store)).toEqual(["next"]);
    expect(store.send).toHaveBeenCalledTimes(1);
  });

  it("B-composer-12: sends the queued message alone and leaves the draft typed since in the field", async () => {
    const { queue, store } = harness();
    Object.assign(composer(store), { text: "AAA first queued", chips: [ROW] });
    queue().enqueue();
    type(store, "BBB second");
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(sentText(store)).toEqual(["AAA first queued"]);
    expect(store.resend.mock.calls[0]![1].chips).toEqual([ROW]);
    expect(composer(store).text).toBe("BBB second");
  });

  it("Q3: a refused send hands the message back into the empty field", async () => {
    const { queue, store } = harness();
    type(store, "and the p95?");
    queue().enqueue();
    store.send.mockImplementationOnce(async () => REFUSED);
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(composer(store).text).toBe("and the p95?");
    expect(queuedOf("s1")).toBeNull();
  });

  it("Q3: a send that throws hands the message back instead of losing it", async () => {
    const { queue, store } = harness();
    type(store, "and the p95?");
    queue().enqueue();
    store.send.mockImplementationOnce(async (sid: string) => {
      store.state.sessions[sid]!.composer.text = "";
      throw new Error("network");
    });
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(composer(store).text).toBe("and the p95?");
  });

  it("Q3: a refused send with a draft typed since keeps the message queued for Edit, and never retries it alone", async () => {
    const { queue, store } = harness();
    type(store, "queued");
    queue().enqueue();
    type(store, "typed later");
    store.resend.mockImplementation(async () => REFUSED);
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    await flushPromises();
    expect(store.resend).toHaveBeenCalledTimes(1);
    expect(queuedOf("s1")).toMatchObject({ text: "queued", held: true });
    expect(composer(store).text).toBe("typed later");
  });

  it("Q3: a composer that would refuse Send holds the queued message instead of sending it", async () => {
    const lost = ref(true);
    const { queue, store } = harness("s1", fakeStore(), () => lost.value);
    type(store, "next");
    queue().enqueue();
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(store.send).not.toHaveBeenCalled();
    expect(composer(store).text).toBe("next");
    expect(queuedOf("s1")).toBeNull();
  });

  it("Q3: a held message with a draft typed since stays queued, unsent", async () => {
    const { queue, store } = harness("s1", fakeStore(), () => true);
    type(store, "next");
    queue().enqueue();
    type(store, "typed later");
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(store.resend).not.toHaveBeenCalled();
    expect(queuedOf("s1")).toMatchObject({ text: "next", held: true });
  });

  it("hands the message back into an empty field after an answer that did not finish", async () => {
    const { queue, store } = harness();
    Object.assign(composer(store), { text: "and the p95?", chips: [ROW] });
    queue().enqueue();
    store.state.sessions.s1!.turn = STOPPED;
    await flushPromises();
    expect(store.send).not.toHaveBeenCalled();
    expect(composer(store)).toMatchObject({ text: "and the p95?", chips: [ROW] });
    expect(queuedOf("s1")).toBeNull();
  });

  it("B-composer-12: keeps the message queued, never joined, when the field holds a draft after a stop", async () => {
    const { queue, store } = harness();
    type(store, "first");
    queue().enqueue();
    type(store, "second");
    store.state.sessions.s1!.turn = STOPPED;
    await flushPromises();
    expect(store.resend).not.toHaveBeenCalled();
    expect(composer(store).text).toBe("second");
    expect(queuedOf("s1")?.text).toBe("first");
  });

  it("Edit swaps the queued message and the draft, chips included, never joining them", () => {
    const { queue, store, focus } = harness();
    Object.assign(composer(store), { text: "first", chips: [ROW] });
    queue().enqueue();
    type(store, "more");
    queue().edit();
    expect(composer(store)).toMatchObject({ text: "first", chips: [ROW] });
    expect(queuedOf("s1")?.text).toBe("more");
    expect(focus).toHaveBeenCalled();
  });

  it("Edit after the answer ended never sends the draft it swaps into the queue", async () => {
    const { queue, store } = harness("s1", fakeStore(), () => true);
    type(store, "first");
    queue().enqueue();
    type(store, "typed later");
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    queue().edit();
    await flushPromises();
    expect(store.send).not.toHaveBeenCalled();
    expect(store.resend).not.toHaveBeenCalled();
    expect(composer(store).text).toBe("first");
    expect(queuedOf("s1")).toMatchObject({ text: "typed later", held: true });
  });

  it("Edit with an empty field takes the message out of the queue", () => {
    const { queue, store } = harness();
    type(store, "first");
    queue().enqueue();
    queue().edit();
    expect(composer(store).text).toBe("first");
    expect(queue().queued.value).toBeNull();
  });

  it("shares one queue per chat, so a second composer on it never sends twice", async () => {
    const store = fakeStore();
    const one = harness("s1", store);
    const two = harness("s1", store);
    type(store, "only once");
    one.queue().enqueue();
    expect(two.queue().queued.value?.text).toBe("only once");
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(store.send).toHaveBeenCalledTimes(1);
  });

  it("B-composer-8: sends a chat's queued message when its turn ends while another chat is shown", async () => {
    const { queue, store, shown } = harness();
    type(store, "Now say only: QUEUED-SWITCH");
    queue().enqueue();
    shown.value = "s2";
    await nextTick();
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(sentText(store)).toEqual(["Now say only: QUEUED-SWITCH"]);
    expect(queuedOf("s1")).toBeNull();
  });

  it("B-composer-8: off screen, a stopped turn hands the message back into the empty field", async () => {
    const { queue, store, shown } = harness();
    type(store, "follow-up");
    queue().enqueue();
    shown.value = "s2";
    store.state.sessions.s1!.turn = STOPPED;
    await flushPromises();
    expect(store.send).not.toHaveBeenCalled();
    expect(composer(store).text).toBe("follow-up");
  });

  it("B-composer-8: off screen, a draft typed since stays and the queued text still goes", async () => {
    const { queue, store, shown } = harness();
    type(store, "queued");
    queue().enqueue();
    type(store, "typed later");
    shown.value = "s2";
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(sentText(store)).toEqual(["queued"]);
    expect(composer(store).text).toBe("typed later");
  });
});

describe("useComposerQueue: a queued message leaves with its chat (S2-5)", () => {
  it.each(["dropSession", "reset"] as const)(
    "drops the queued message, in memory and in storage, on %s",
    async (how) => {
      const { store } = fakeAssistant();
      const sid = store.createSession({
        origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
      });
      const session = store.state.sessions[sid];
      session.turn = { state: "responding.writing" };
      let queue!: ComposerQueue;
      mount(
        defineComponent({
          setup() {
            queue = useComposerQueue({ sid: () => sid, store });
            return () => null;
          },
        }),
      );
      session.composer.text = "and the one before?";
      expect(queue.enqueue()).toBe(true);
      store.drafts.flush();
      expect(store.drafts.read(session.userOrgKey, queuedDraftSid(sid))).toMatchObject({
        text: "and the one before?",
      });
      const key = session.userOrgKey;
      if (how === "dropSession") store.dropSession(sid);
      else store.reset();
      await flushPromises();
      expect(queuedOf(sid)).toBeNull();
      if (how === "dropSession") expect(store.drafts.read(key, queuedDraftSid(sid))).toBeNull();
    },
  );
});

describe("useComposerQueue: a queued message survives a reload (Q2)", () => {
  const KEY = "u1:default|s1:queued";

  it("stores the queued message beside the chat's draft, without its images, and removes it once taken", () => {
    const { queue, store } = harness();
    Object.assign(composer(store), { text: "next", chips: [ROW], images: [IMAGE] });
    queue().enqueue();
    expect(store.drafts.saved.get(KEY)).toEqual({
      text: "next",
      chips: [ROW],
      timeOverride: null,
      removedPageKeys: [],
    });
    takeQueued("s1");
    expect(store.drafts.saved.has(KEY)).toBe(false);
  });

  it("after a reload, gives the message back into the empty field instead of sending it", async () => {
    const before = harness();
    Object.assign(composer(before.store), { text: "next", chips: [ROW], timeOverride: WINDOW });
    before.queue().enqueue();
    before.wrapper.unmount();
    resetComposerQueueForTests();
    const store = fakeStore(fakeDrafts(before.store.drafts.saved));
    store.state.sessions.s1!.turn = DONE;
    harness("s1", store);
    await flushPromises();
    expect(store.send).not.toHaveBeenCalled();
    expect(composer(store)).toMatchObject({ text: "next", chips: [ROW], timeOverride: WINDOW });
    expect(store.drafts.saved.has(KEY)).toBe(false);
  });

  it("after a reload with a draft in the field, keeps the message queued for Edit", async () => {
    const before = harness();
    type(before.store, "next");
    before.queue().enqueue();
    resetComposerQueueForTests();
    const store = fakeStore(fakeDrafts(before.store.drafts.saved));
    store.state.sessions.s1!.turn = DONE;
    type(store, "typed after reload");
    harness("s1", store);
    await flushPromises();
    expect(store.send).not.toHaveBeenCalled();
    expect(store.resend).not.toHaveBeenCalled();
    expect(queuedOf("s1")).toMatchObject({ text: "next", held: true });
  });
});
