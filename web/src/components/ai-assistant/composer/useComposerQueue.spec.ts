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

import type { TurnState } from "@/composables/assistant";

import {
  queuedOf,
  resetComposerQueueForTests,
  useComposerQueue,
  type ComposerQueue,
} from "./useComposerQueue";

// The store's own shape for two chats: the turn state and the draft are all the drain reads.
function fakeStore() {
  const store = reactive({
    state: {
      sessions: {
        s1: { turn: { state: "responding.writing" } as TurnState, composer: { text: "" } },
        s2: { turn: { state: "idle" } as TurnState, composer: { text: "" } },
      } as Record<string, { turn: TurnState; composer: { text: string } }>,
    },
    setDraft: vi.fn((sid: string, patch: { text: string }) => {
      store.state.sessions[sid]!.composer.text = patch.text;
    }),
    resend: vi.fn(async () => undefined),
  });
  return store;
}

const DONE = { state: "done", saved: "server" } as TurnState;
const STOPPED = { state: "stopped", steps: 1, partial: true } as TurnState;

function harness(sid = "s1", store = fakeStore()) {
  const restore = vi.fn((id: string, text: string) => store.setDraft(id, { text }));
  let queue!: ComposerQueue;
  const shown = ref(sid);
  mount(
    defineComponent({
      setup() {
        queue = useComposerQueue({
          sid: () => shown.value,
          draft: (id) => store.state.sessions[id]?.composer.text ?? "",
          restore,
          store,
        });
        return () => null;
      },
    }),
  );
  return { store, shown, restore, queue: () => queue };
}

const sentText = (store: ReturnType<typeof fakeStore>) =>
  store.resend.mock.calls.map((call) => (call as unknown as [string, { text: string }])[1].text);

afterEach(() => resetComposerQueueForTests());

describe("useComposerQueue: Enter while answering queues one message", () => {
  it("holds one message and refuses a second until the answer ends", () => {
    const { queue } = harness();
    expect(queue().enqueue("first")).toBe(true);
    expect(queue().enqueue("second")).toBe(false);
    expect(queue().enqueue("   ")).toBe(false);
    expect(queue().queued.value?.text).toBe("first");
  });

  it("sends the queued message as its own prompt when the answer ends well", async () => {
    const { queue, store } = harness();
    queue().enqueue("and the p95?");
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(store.resend).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ text: "and the p95?" }),
      "typed",
    );
    expect(queuedOf("s1")).toBeNull();
  });

  it("B-composer-12: sends the queued text alone and leaves the draft typed since in the field", async () => {
    const { queue, store } = harness();
    queue().enqueue("AAA first queued");
    store.state.sessions.s1!.composer.text = "BBB second";
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(sentText(store)).toEqual(["AAA first queued"]);
    expect(store.state.sessions.s1!.composer.text).toBe("BBB second");
  });

  it("hands the message back into an empty field after an answer that did not finish", async () => {
    const { queue, store } = harness();
    queue().enqueue("and the p95?");
    store.state.sessions.s1!.turn = STOPPED;
    await flushPromises();
    expect(store.resend).not.toHaveBeenCalled();
    expect(store.state.sessions.s1!.composer.text).toBe("and the p95?");
    expect(queuedOf("s1")).toBeNull();
  });

  it("B-composer-12: keeps the message queued, never joined, when the field holds a draft after a stop", async () => {
    const { queue, store } = harness();
    queue().enqueue("first");
    store.state.sessions.s1!.composer.text = "second";
    store.state.sessions.s1!.turn = STOPPED;
    await flushPromises();
    expect(store.resend).not.toHaveBeenCalled();
    expect(store.state.sessions.s1!.composer.text).toBe("second");
    expect(queuedOf("s1")?.text).toBe("first");
  });

  it("Edit swaps the queued message and the draft, never joining them", () => {
    const { queue, store } = harness();
    queue().enqueue("first");
    store.state.sessions.s1!.composer.text = "more";
    queue().edit();
    expect(store.state.sessions.s1!.composer.text).toBe("first");
    expect(queuedOf("s1")?.text).toBe("more");
  });

  it("Edit with an empty field takes the message out of the queue", () => {
    const { queue, store } = harness();
    queue().enqueue("first");
    queue().edit();
    expect(store.state.sessions.s1!.composer.text).toBe("first");
    expect(queue().queued.value).toBeNull();
  });

  it("shares one queue per chat, so a second composer on it never sends twice", async () => {
    const store = fakeStore();
    const one = harness("s1", store);
    const two = harness("s1", store);
    one.queue().enqueue("only once");
    expect(two.queue().queued.value?.text).toBe("only once");
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(store.resend).toHaveBeenCalledTimes(1);
  });

  it("B-composer-8: sends a chat's queued message when its turn ends while another chat is shown", async () => {
    const { queue, store, shown } = harness();
    queue().enqueue("Now say only: QUEUED-SWITCH");
    shown.value = "s2";
    await nextTick();
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(sentText(store)).toEqual(["Now say only: QUEUED-SWITCH"]);
    expect(queuedOf("s1")).toBeNull();
  });

  it("B-composer-8: off screen, a stopped turn hands the message back into the empty field", async () => {
    const { queue, store, shown } = harness();
    queue().enqueue("follow-up");
    shown.value = "s2";
    store.state.sessions.s1!.turn = STOPPED;
    await flushPromises();
    expect(store.resend).not.toHaveBeenCalled();
    expect(store.state.sessions.s1!.composer.text).toBe("follow-up");
  });

  it("B-composer-8: off screen, a draft typed since stays and the queued text still goes", async () => {
    const { queue, store, shown } = harness();
    queue().enqueue("queued");
    store.state.sessions.s1!.composer.text = "typed later";
    shown.value = "s2";
    store.state.sessions.s1!.turn = DONE;
    await flushPromises();
    expect(sentText(store)).toEqual(["queued"]);
    expect(store.state.sessions.s1!.composer.text).toBe("typed later");
  });
});
