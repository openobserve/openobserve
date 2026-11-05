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

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "@/composables/query/queryClient";

import { fakeAssistant } from "../__tests__/fakeAssistant";
import { keepForkSeed } from "../shared/forkMemory";
import AssistantForkSource from "./AssistantForkSource.vue";

const { fake, api } = vi.hoisted(() => ({
  fake: { current: null as any },
  api: { getShared: vi.fn() },
}));

vi.mock("@/composables/assistant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/composables/assistant")>();
  return {
    ...actual,
    useAssistantStore: () => fake.current.store,
    useAssistantSession: (sid: () => string) => actual.useAssistantSession(sid, fake.current.store),
  };
});
vi.mock("@/services/ai_chat_share", () => ({ default: api }));

const turns = [
  {
    created: 1,
    status: "completed",
    user: { text: "Why did checkout fail?" },
    frames: [{ type: "message", content: "The payment service timed out." }],
  },
];

// Seeds outlive a fake store, so ids stay unique across tests.
let seq = 0;

function session(opts: { seed?: boolean; forked?: boolean; messages?: boolean } = {}) {
  fake.current = fakeAssistant("available", {}, { uuid: () => `fork-${++seq}` });
  const store = fake.current.store;
  const sid = store.createSession({
    origin: { entryKind: "share_fork", objectKind: "none", container: "full_view" },
    title: "Checkout (continued)",
  });
  const s = store.state.sessions[sid];
  if (opts.forked) s.record.forkedFromShare = "tok";
  if (opts.messages) s.messages = [{ role: "user", content: "next" }];
  if (opts.seed !== false) {
    keepForkSeed(sid, {
      token: "tok",
      title: "Checkout",
      ownerName: "Priya",
      asOf: 1_760_000_000_000,
      turns,
    });
  }
  return sid;
}

const mountSource = (sid: string) =>
  mount(AssistantForkSource, { props: { sid }, attachTo: document.body });
const at = (wrapper: ReturnType<typeof mountSource>, id: string) =>
  wrapper.find(`[data-test="${id}"]`);

enableAutoUnmount(afterEach);

beforeEach(() => {
  queryClient.clear();
  api.getShared.mockResolvedValue({ data: { title: "Checkout", mode: "snapshot", seq: 1, turns } });
});

afterEach(() => vi.clearAllMocks());

describe("AssistantForkSource", () => {
  it("renders nothing for a chat that was not continued from a share", () => {
    fake.current = fakeAssistant();
    const sid = fake.current.store.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    expect(at(mountSource(sid), "assistant-fork-source").exists()).toBe(false);
  });

  it("names the source and shows its turns read-only above the divider", async () => {
    const wrapper = mountSource(session());
    await flushPromises();
    const region = at(wrapper, "assistant-fork-source");
    expect(region.attributes("aria-label")).toBe("Continued from Checkout");
    expect(at(wrapper, "assistant-fork-source-heading").text()).toMatch(
      /^Continued from “Checkout” · shared by Priya · snapshot as of /,
    );
    expect(at(wrapper, "assistant-fork-source-transcript").text()).toContain(
      "The payment service timed out.",
    );
    expect(region.find('[data-test="assistant-feedback"]').exists()).toBe(false);
    expect(at(wrapper, "assistant-fork-source-divider").text()).toBe("Your chat starts here");
    expect(at(wrapper, "assistant-fork-source-note").text()).toBe(
      "Your first message uses the shared chat as context.",
    );
  });

  it("keeps a redacted share's masking in the source panel", async () => {
    const sid = session({ seed: false });
    keepForkSeed(sid, {
      token: "tok",
      title: "Checkout",
      ownerName: "Priya",
      asOf: 1_760_000_000_000,
      redacted: true,
      turns: [
        {
          ...turns[0],
          frames: [
            { type: "query", language: "sql", text: "SELECT card FROM payments" },
            ...turns[0].frames,
          ],
        },
      ],
    });
    const wrapper = mountSource(sid);
    await flushPromises();
    const transcript = at(wrapper, "assistant-fork-source-transcript").text();
    expect(transcript).toContain("The payment service timed out.");
    expect(transcript).not.toContain("SELECT card");
  });

  it("collapses to a count once the fork has its own turns", async () => {
    const wrapper = mountSource(session({ messages: true }));
    await flushPromises();
    expect(at(wrapper, "assistant-fork-source-show").text()).toBe("Show 1 shared turn");
  });

  it("warns before relying on a source that is gone, and Send anyway marks it", async () => {
    api.getShared.mockRejectedValue({ response: { status: 404 } });
    const wrapper = mountSource(session());
    await flushPromises();
    expect(at(wrapper, "assistant-fork-source-seed-lost").text()).toContain(
      "The shared chat is no longer available, so the assistant won't have its earlier messages.",
    );
    await at(wrapper, "assistant-fork-source-send-anyway").trigger("click");
    expect(at(wrapper, "assistant-fork-source-seed-lost").exists()).toBe(false);
    expect(at(wrapper, "assistant-fork-source-gone").text()).toBe("· source no longer available");
  });

  it("names the source without a transcript on a device that has no seed", async () => {
    const wrapper = mountSource(session({ seed: false, forked: true }));
    await flushPromises();
    expect(at(wrapper, "assistant-fork-source").exists()).toBe(true);
    expect(at(wrapper, "assistant-fork-source-missing").text()).toBe(
      "Shared transcript not available on this device",
    );
  });
});
