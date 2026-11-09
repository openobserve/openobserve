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

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, ref } from "vue";

import {
  mergeQueued,
  queuedOf,
  resetComposerQueueForTests,
  useComposerQueue,
  type ComposerQueue,
} from "./useComposerQueue";

function harness(sid = "s1") {
  const running = ref(true);
  const state = ref<"done" | "failed">("done");
  const drafts = ref<Record<string, string>>({ [sid]: "" });
  const send = vi.fn();
  const restore = vi.fn((id: string, text: string) => (drafts.value[id] = text));
  let queue!: ComposerQueue;
  const wrapper = mount(
    defineComponent({
      setup() {
        queue = useComposerQueue({
          sid: () => sid,
          running: () => running.value,
          endedDone: () => state.value === "done",
          draft: (id) => drafts.value[id] ?? "",
          send,
          restore,
        });
        return () => null;
      },
    }),
  );
  return { wrapper, running, state, drafts, send, restore, queue: () => queue };
}

afterEach(() => resetComposerQueueForTests());

describe("useComposerQueue: Enter while answering queues one message", () => {
  it("holds one message and refuses a second until the answer ends", () => {
    const { queue } = harness();
    expect(queue().enqueue("first")).toBe(true);
    expect(queue().enqueue("second")).toBe(false);
    expect(queue().enqueue("   ")).toBe(false);
    expect(queue().queued.value?.text).toBe("first");
  });

  it("sends the queued message when the answer ends well and nothing new was typed", async () => {
    const { queue, running, send } = harness();
    queue().enqueue("and the p95?");
    running.value = false;
    await nextTick();
    expect(send).toHaveBeenCalledWith("s1", "and the p95?");
    expect(queuedOf("s1")).toBeNull();
  });

  it("hands the message back instead of sending after a failed answer", async () => {
    const { queue, running, state, send, restore } = harness();
    queue().enqueue("and the p95?");
    state.value = "failed";
    running.value = false;
    await nextTick();
    expect(send).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith("s1", "and the p95?");
  });

  it("puts the queued text ahead of what was typed since, and sends neither on its own", async () => {
    const { queue, running, drafts, send, restore } = harness();
    queue().enqueue("first");
    drafts.value.s1 = "second";
    running.value = false;
    await nextTick();
    expect(send).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith("s1", "first\nsecond");
  });

  it("Edit takes the message out of the queue and back into the draft", () => {
    const { queue, drafts, restore } = harness();
    queue().enqueue("first");
    drafts.value.s1 = "more";
    queue().edit();
    expect(restore).toHaveBeenCalledWith("s1", "first\nmore");
    expect(queue().queued.value).toBeNull();
  });

  it("shares one queue per chat, so a second composer on it never sends twice", async () => {
    const one = harness();
    const two = harness();
    one.queue().enqueue("only once");
    expect(two.queue().queued.value?.text).toBe("only once");
    one.running.value = false;
    two.running.value = false;
    await nextTick();
    expect(one.send.mock.calls.length + two.send.mock.calls.length).toBe(1);
  });

  it("merges without a stray newline when nothing was typed", () => {
    expect(mergeQueued("a", "  ")).toBe("a");
    expect(mergeQueued("a", "b")).toBe("a\nb");
  });
});
