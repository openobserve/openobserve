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
import { createStore } from "vuex";

import { queryClient } from "@/composables/query/queryClient";
import type { ShareView } from "@/services/ai_chat_share";

import { fakeAssistant } from "../__tests__/fakeAssistant";
import AssistantShareManager from "./AssistantShareManager.vue";

const { fake, api } = vi.hoisted(() => ({
  fake: { current: null as any },
  api: { listForChat: vi.fn(), listMine: vi.fn(), listAll: vi.fn() },
}));

vi.mock("@/composables/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/assistant")>()),
  useAssistantStore: () => fake.current.store,
  useAssistantCapability: () => fake.current.handle,
}));
vi.mock("@/services/ai_chat_share", () => ({ default: api }));
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: vi.fn() }));

const share = (id: string, over: Partial<ShareView> = {}): ShareView => ({
  id,
  token: `tok-${id}`,
  url_path: `/web/ai/shared/tok-${id}`,
  mode: "live",
  visibility: "org",
  snapshot_seq: null,
  expires_at: null,
  created_at: 1,
  updated_at: 1,
  access_count: 0,
  last_accessed_at: null,
  session_id: "c1",
  title: `Chat ${id}`,
  redact_tools: true,
  ...over,
});

async function setup(initialScope: "chat" | "mine" | "all", isAdmin = true) {
  fake.current = fakeAssistant("available", { isAdmin });
  const wrapper = mount(AssistantShareManager, {
    props: { open: true, sid: initialScope === "chat" ? "c1" : null, initialScope },
    global: {
      plugins: [
        createStore({ state: { selectedOrganization: { identifier: "default" }, zoConfig: {} } }),
      ],
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const q = (id: string) => document.querySelector(`[data-test="${id}"]`);

enableAutoUnmount(afterEach);

beforeEach(() => {
  queryClient.clear();
  api.listForChat.mockResolvedValue({ data: { shares: [share("a")] } });
  api.listMine.mockResolvedValue({ data: { shares: [share("a"), share("b")] } });
  api.listAll.mockResolvedValue({
    data: { shares: [share("c", { token: undefined, url_path: undefined, owner_name: "Diego" })] },
  });
});

afterEach(() => vi.clearAllMocks());

describe("AssistantShareManager", () => {
  it("reads the scope it opened on: this chat, mine or the whole org", async () => {
    await setup("chat");
    expect(api.listForChat).toHaveBeenCalledWith("default", "c1");
    expect(q("assistant-share-manager-row-a")).not.toBeNull();
    expect(q("assistant-share-manager-new")).not.toBeNull();
  });

  it("lists mine without the New link form, which needs a chat", async () => {
    await setup("mine");
    expect(api.listMine).toHaveBeenCalledWith("default");
    expect(
      document.querySelectorAll(
        '[data-test^="assistant-share-manager-row-"][data-test$="a"], [data-test="assistant-share-manager-row-b"]',
      ).length,
    ).toBe(2);
    expect(q("assistant-share-manager-new")).toBeNull();
  });

  it("never exposes another owner's token in the org list", async () => {
    await setup("all");
    expect(q("assistant-share-manager-row-c")).not.toBeNull();
    expect(q("assistant-share-manager-row-copy")).toBeNull();
    expect(document.body.innerHTML).not.toContain("tok-c");
  });

  it("offers All in organization to admins only", async () => {
    await setup("mine", false);
    expect(q("assistant-share-manager-scope-all")).toBeNull();
  });

  it.each([
    ["mine", "You haven't shared any chats."],
    ["chat", "This chat has no links yet."],
    ["all", "No chats are shared in this organization."],
  ] as const)("says so when %s has no links", async (scope, text) => {
    api.listForChat.mockResolvedValue({ data: { shares: [] } });
    api.listMine.mockResolvedValue({ data: { shares: [] } });
    api.listAll.mockResolvedValue({ data: { shares: [] } });
    await setup(scope);
    expect(q("assistant-share-manager-empty")?.textContent).toBe(text);
  });

  it("shows the named permission state with no Retry when my list is forbidden", async () => {
    api.listMine.mockRejectedValue({ response: { status: 403, data: {} } });
    await setup("mine");
    expect(q("assistant-gate-state")?.getAttribute("data-gate")).toBe("no_share_read");
    expect(q("assistant-share-manager-retry")).toBeNull();
  });

  it("keeps the scope toggle usable when the org list is admin-only", async () => {
    api.listAll.mockRejectedValue({ response: { status: 403, data: {} } });
    await setup("all");
    expect(q("assistant-share-manager-admin-only")?.textContent).toBe(
      "Only organization admins can see every shared chat.",
    );
    expect(q("assistant-share-manager-scope")).not.toBeNull();
  });

  it("offers Retry when the list fails", async () => {
    api.listMine.mockRejectedValue({ response: { status: 500, data: {} } });
    await setup("mine");
    expect(q("assistant-share-manager-error")?.textContent).toContain("Couldn't load your links");
    (q("assistant-share-manager-retry") as HTMLElement).click();
    await flushPromises();
    expect(api.listMine.mock.calls.length).toBeGreaterThan(1);
  });
});
