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

import type { SharedChat } from "@/services/ai_chat_share";

import { fakeRouter } from "../__tests__/fakeAssistant";
import { forkSeedOf, forksOf, hashShareToken, readForks, rememberFork } from "./forkMemory";
import SharedChatContinue from "./SharedChatContinue.vue";

const { api, toast, track } = vi.hoisted(() => ({
  api: { fork: vi.fn(), renameChat: vi.fn() },
  toast: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/services/ai_chat_share", () => ({ default: api }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: track }));

const chat = (): SharedChat => ({
  title: "Checkout 5xx",
  mode: "snapshot",
  seq: 3,
  created_at: 1,
  shared_at: 1_760_000_000_000_000,
  owner_name: "Priya",
  not_modified: false,
  turns: [{ created: 1, status: "completed", user: { text: "why" }, frames: [] }],
});

async function setup(reread = vi.fn(async () => ({ data: chat() }))) {
  const router = fakeRouter();
  await router.push("/");
  const wrapper = mount(SharedChatContinue, {
    props: { token: "tok", org: "default", chat: chat(), userOrgKey: "k1", reread },
    global: { plugins: [router] },
  });
  return { wrapper, router, reread };
}

const at = (wrapper: { find: (s: string) => any }, id: string) =>
  wrapper.find(`[data-test="${id}"]`);

enableAutoUnmount(afterEach);

beforeEach(() => {
  localStorage.clear();
  api.fork.mockResolvedValue({
    data: { session_id: "0190a1b2-c3d4-7e5f-8a9b-000000000009", title: "x (copy)" },
  });
  api.renameChat.mockResolvedValue({ data: {} });
});

afterEach(() => vi.clearAllMocks());

describe("SharedChatContinue", () => {
  it("re-reads, forks, titles the copy and opens it on the full view", async () => {
    const { wrapper, router, reread } = await setup();
    await at(wrapper, "shared-chat-continue").trigger("click");
    await vi.waitFor(() => expect(api.renameChat).toHaveBeenCalled());
    await flushPromises();
    expect(reread).toHaveBeenCalledTimes(1);
    expect(api.fork).toHaveBeenCalledWith("default", "tok");
    expect(api.renameChat).toHaveBeenCalledWith(
      "default",
      "0190a1b2-c3d4-7e5f-8a9b-000000000009",
      "Checkout 5xx (continued)",
    );
    expect(router.currentRoute.value.fullPath).toBe(
      "/assistant/0190a1b2-c3d4-7e5f-8a9b-000000000009?org_identifier=default",
    );
    expect(forkSeedOf("0190a1b2-c3d4-7e5f-8a9b-000000000009")).toMatchObject({
      token: "tok",
      title: "Checkout 5xx",
      ownerName: "Priya",
    });
    expect(track).toHaveBeenCalledWith("ai_fork", { result: "ok" });
  });

  it("creates nothing and says so when the link is gone at click time", async () => {
    const { wrapper } = await setup(vi.fn(async () => ({ error: { response: { status: 404 } } })));
    await at(wrapper, "shared-chat-continue").trigger("click");
    await flushPromises();
    expect(api.fork).not.toHaveBeenCalled();
    expect(at(wrapper, "assistant-shared-continue-unavailable").text()).toBe(
      "This link is no longer available, so it can't be continued.",
    );
  });

  it("toasts with Retry and opens nothing when the fork fails", async () => {
    api.fork.mockRejectedValue({ response: { status: 500 } });
    const { wrapper, router } = await setup();
    await at(wrapper, "shared-chat-continue").trigger("click");
    await flushPromises();
    expect(String(toast.mock.calls[0][0].message)).toBe("Couldn't continue this chat");
    expect(toast.mock.calls[0][0].action).toBeDefined();
    expect(router.currentRoute.value.fullPath).toBe("/");
  });

  it("offers Open my copy and numbers the next fork", async () => {
    rememberFork("k1", { tokenHash: await hashShareToken("tok"), sessionId: "s-first", at: 1 });
    const { wrapper, router } = await setup();
    await vi.waitFor(() => expect(at(wrapper, "assistant-shared-open-copy").exists()).toBe(true));
    await at(wrapper, "assistant-shared-open-copy").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/assistant/s-first?org_identifier=default");
    await at(wrapper, "shared-chat-continue").trigger("click");
    await vi.waitFor(() => expect(api.renameChat).toHaveBeenCalled());
    expect(api.renameChat.mock.calls[0][2]).toBe("Checkout 5xx (continued 2)");
  });
});

describe("forkMemory", () => {
  beforeEach(() => localStorage.clear());

  it("keeps forks per user and org, newest last, capped at 50", () => {
    for (let i = 0; i < 60; i++)
      rememberFork("k1", { tokenHash: `h${i % 2}`, sessionId: `s${i}`, at: i });
    expect(readForks("k1")).toHaveLength(50);
    expect(readForks("k1").at(-1)?.sessionId).toBe("s59");
    expect(readForks("k2")).toEqual([]);
    expect(forksOf("k1", "h1").every((entry) => entry.tokenHash === "h1")).toBe(true);
    expect(forksOf("k1", "")).toEqual([]);
  });

  it("stores a hash of the share token, never the token", async () => {
    const tokenHash = await hashShareToken("secret-token");
    rememberFork("k1", { tokenHash, sessionId: "s1", at: 1 });
    expect(localStorage.getItem("o2.assistant.forks:k1")).not.toContain("secret-token");
    expect(tokenHash).toMatch(/^[0-9a-z]+$/);
    expect(await hashShareToken("secret-token")).toBe(tokenHash);
  });

  it("ignores hostile or broken storage", () => {
    localStorage.setItem(
      "o2.assistant.forks:k1",
      JSON.stringify([
        { __proto__: { polluted: true }, tokenHash: "t", sessionId: "s" },
        { token: "raw-legacy-token", sessionId: "s2" },
        "x",
        { token: 1 },
      ]),
    );
    expect(readForks("k1")).toEqual([{ tokenHash: "t", sessionId: "s", at: 0 }]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    localStorage.setItem("o2.assistant.forks:k1", "{not json");
    expect(readForks("k1")).toEqual([]);
  });
});
