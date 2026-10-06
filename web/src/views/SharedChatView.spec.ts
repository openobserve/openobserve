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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("dompurify", () => ({
  default: { sanitize: vi.fn((html: string) => html) },
}));

const service = vi.hoisted(() => ({
  create: vi.fn(),
  listForChat: vi.fn(),
  listMine: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
  getShared: vi.fn(),
  fork: vi.fn(),
  getPublic: vi.fn(),
}));
vi.mock("@/services/ai_chat_share", () => ({ default: service }));

const adoptServerChat = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useChatHistory", () => ({
  useChatHistory: () => ({ adoptServerChat }),
}));
vi.mock("@/composables/useAiChat", () => ({
  default: () => ({ chatHistoryServer: () => ({ enabled: () => true }) }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));

import SharedChatView from "./SharedChatView.vue";

const sharedChat = {
  title: "Error spike",
  mode: "snapshot",
  seq: 3,
  created_at: 1_700_000_000_000_000,
  shared_at: 1_700_000_000_000_000,
  owner_name: "Ada",
  not_modified: false,
  turns: [
    {
      user_message_id: "u1",
      user: { text: "Why are errors up?" },
      frames: [{ type: "message", content: "Because of a deploy." }, { type: "complete" }],
    },
  ],
};

const notFound = { response: { status: 404, data: { message: "not found" } } };

function mountView(props: Record<string, unknown>) {
  const dispatch = vi.fn();
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "org1" },
      userInfo: { email: "me@example.com" },
      zoConfig: {},
      theme: "light",
    },
  });
  store.dispatch = dispatch as any;
  const wrapper = mount(SharedChatView, { props, global: { plugins: [store] } });
  return { wrapper, dispatch };
}

describe("SharedChatView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it("renders the shared transcript read-only with title, owner and mode", async () => {
    service.getShared.mockResolvedValue({ data: sharedChat });
    const { wrapper } = mountView({ token: "tok" });
    await flushPromises();
    expect(service.getShared).toHaveBeenCalledWith("org1", "tok");
    expect(wrapper.text()).toContain("Error spike");
    expect(wrapper.find('[data-test="shared-chat-view-shared-by"]').text()).toContain("Ada");
    expect(wrapper.find('[data-test="shared-chat-view-mode"]').text()).toBe("Snapshot");
    expect(wrapper.find('[data-test="o2-ai-chat-transcript"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Why are errors up?");
    expect(wrapper.text()).toContain("Because of a deploy.");
    expect(wrapper.find('[data-test="o2-ai-chat-thumbs-up-btn"]').exists()).toBe(false);
    expect(wrapper.find("textarea").exists()).toBe(false);
  });

  it("shows the uniform not-found state for a 404", async () => {
    service.getShared.mockRejectedValue(notFound);
    const { wrapper } = mountView({ token: "gone" });
    await flushPromises();
    expect(wrapper.find('[data-test="shared-chat-view-not-found"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="o2-ai-chat-transcript"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="shared-chat-view-fork"]').exists()).toBe(false);
  });

  it("shows a retryable error for other failures", async () => {
    service.getShared.mockRejectedValue({ response: { status: 500 } });
    const { wrapper } = mountView({ token: "tok" });
    await flushPromises();
    expect(wrapper.find('[data-test="shared-chat-view-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="shared-chat-view-not-found"]').exists()).toBe(false);
  });

  it("reads public links from the public endpoint and offers no fork", async () => {
    service.getPublic.mockResolvedValue({ data: sharedChat });
    const { wrapper } = mountView({ token: "pub", isPublic: true });
    await flushPromises();
    expect(service.getPublic).toHaveBeenCalledWith("pub");
    expect(service.getShared).not.toHaveBeenCalled();
    expect(wrapper.find('[data-test="o2-ai-chat-transcript"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="shared-chat-view-fork"]').exists()).toBe(false);
  });

  it("shows not-found for a public link that is not available", async () => {
    service.getPublic.mockRejectedValue(notFound);
    const { wrapper } = mountView({ token: "pub", isPublic: true });
    await flushPromises();
    expect(wrapper.find('[data-test="shared-chat-view-not-found"]').exists()).toBe(true);
  });

  it("forks into the caller's chats and opens the new chat in the AI panel", async () => {
    service.getShared.mockResolvedValue({ data: sharedChat });
    service.fork.mockResolvedValue({
      data: { session_id: "new-sess", title: "Error spike (copy)" },
    });
    adoptServerChat.mockResolvedValue(42);
    const { wrapper, dispatch } = mountView({ token: "tok" });
    await flushPromises();
    await wrapper.find('[data-test="shared-chat-view-fork"]').trigger("click");
    await flushPromises();
    expect(service.fork).toHaveBeenCalledWith("org1", "tok");
    expect(adoptServerChat).toHaveBeenCalledWith("new-sess", "Error spike (copy)");
    expect(dispatch).toHaveBeenCalledWith("setCurrentChatTimestamp", 42);
    expect(dispatch).toHaveBeenCalledWith("setIsAiChatEnabled", true);
    expect(dispatch).toHaveBeenCalledWith("setChatUpdated", true);
  });
});
