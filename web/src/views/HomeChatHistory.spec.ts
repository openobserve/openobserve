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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { queryClient } from "@/composables/query/queryClient";
import { notifyChatListChanged } from "@/utils/chatListRevision";
import { useConfirmDialog } from "@/composables/useConfirmDialog";

const history = vi.hoisted(() => ({
  loadHistory: vi.fn(),
  loadChat: vi.fn(),
  deleteChatById: vi.fn(),
  clearAllHistory: vi.fn(),
}));
vi.mock("@/composables/useChatHistory", () => ({ useChatHistory: () => history }));
vi.mock("@/composables/useAiChat", () => ({
  default: () => ({ chatHistoryServer: () => ({ enabled: () => true }) }),
}));
const service = vi.hoisted(() => ({ listForChat: vi.fn(), listMine: vi.fn(), listAll: vi.fn() }));
vi.mock("@/services/ai_chat_share", () => ({ default: service }));

import HomeChatHistory from "./HomeChatHistory.vue";

const chats = [
  {
    id: 1,
    title: "Error spike",
    timestamp: new Date().toISOString(),
    messages: [],
    sessionId: "s-1",
    serverBacked: true,
  },
];

const mounted: { unmount: () => void }[] = [];

function mountList() {
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "org1" },
      userInfo: { email: "me@example.com" },
      zoConfig: { ai_enabled: true, ai_chat_persistence_enabled: true },
      currentChatTimestamp: null,
      chatUpdated: false,
      theme: "light",
    },
  });
  store.dispatch = vi.fn() as any;
  const wrapper = mount(HomeChatHistory, {
    global: { plugins: [store] },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return { wrapper, store };
}

describe("HomeChatHistory", () => {
  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    document.body.innerHTML = "";
  });

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    history.loadHistory.mockResolvedValue(chats);
    history.deleteChatById.mockResolvedValue(true);
    history.loadChat.mockResolvedValue({ ...chats[0] });
    service.listForChat.mockResolvedValue({ data: { shares: [{ id: "a" }, { id: "b" }] } });
  });

  it("opens a chat from the keyboard", async () => {
    const { wrapper } = mountList();
    await flushPromises();
    const row = wrapper.find('[data-test="home-chat-history-item-1"]');
    expect(row.attributes("tabindex")).toBe("0");
    await row.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("load-chat")).toEqual([[1]]);
  });

  it("confirms a delete, naming the chat in bold and the links that stop working", async () => {
    const { wrapper } = mountList();
    await flushPromises();
    const q = (dt: string) => document.querySelector<HTMLElement>(`[data-test="${dt}"]`);

    await wrapper.find('[data-test="home-chat-history-delete-1"]').trigger("click");
    await flushPromises();
    const name = q("home-chat-history-delete-name");
    expect(name?.textContent).toBe("Error spike");
    expect(name?.classList.contains("font-semibold")).toBe(true);
    expect(name?.closest("p")?.textContent).toBe(
      "Delete the Error spike chat? Its 2 active share links stop working. This action cannot be undone.",
    );
    const ok = q("o-dialog-primary-btn");
    expect(ok?.textContent?.trim()).toBe("Delete");
    expect(ok?.getAttribute("data-o2-variant")).toBe("destructive");
    q("o-dialog-secondary-btn")!.click();
    await flushPromises();
    expect(q("home-chat-history-delete-name")).toBeNull();
    expect(history.deleteChatById).not.toHaveBeenCalled();

    await wrapper.find('[data-test="home-chat-history-delete-1"]').trigger("click");
    await flushPromises();
    q("o-dialog-primary-btn")!.click();
    await flushPromises();
    expect(history.deleteChatById).toHaveBeenCalledWith(1);
  });

  it("asks for a destructive confirm before clearing all chats", async () => {
    const { wrapper } = mountList();
    await flushPromises();
    const dialog = useConfirmDialog();

    const clearAll = wrapper.findAll("button").find((b) => b.text().includes("Clear"));
    await clearAll!.trigger("click");
    expect(dialog.currentDialog.value?.confirmVariant).toBe("destructive");
    dialog.handleCancel();
    await flushPromises();
    expect(history.clearAllHistory).not.toHaveBeenCalled();
  });

  it("names the chat when it has no share links", async () => {
    service.listForChat.mockResolvedValue({ data: { shares: [] } });
    const { wrapper } = mountList();
    await flushPromises();

    await wrapper.find('[data-test="home-chat-history-delete-1"]').trigger("click");
    await flushPromises();
    const name = document.querySelector('[data-test="home-chat-history-delete-name"]');
    expect(name?.closest("p")?.textContent).toBe(
      "Are you sure you want to delete the Error spike chat? This action cannot be undone.",
    );
  });

  it("warns on Share when the chat's history cannot be read", async () => {
    history.loadChat.mockResolvedValueOnce({ ...chats[0], historyUnavailable: true });
    const { wrapper } = mountList();
    await flushPromises();
    await wrapper.find('[data-test="home-chat-history-share-1"]').trigger("click");
    await flushPromises();
    expect(history.loadChat).toHaveBeenCalledWith(1);
    const dialog = wrapper.findComponent({ name: "AiChatShareDialog" });
    expect(dialog.props()).toMatchObject({ sessionId: "s-1", historyUnavailable: true });
  });

  it("does not warn on Share when the chat's history reads", async () => {
    const { wrapper } = mountList();
    await flushPromises();
    await wrapper.find('[data-test="home-chat-history-share-1"]').trigger("click");
    await flushPromises();
    const dialog = wrapper.findComponent({ name: "AiChatShareDialog" });
    expect(dialog.props()).toMatchObject({ sessionId: "s-1", historyUnavailable: false });
  });

  it("re-reads the list whenever a chat changed elsewhere", async () => {
    mountList();
    await flushPromises();
    expect(history.loadHistory).toHaveBeenCalledTimes(1);
    notifyChatListChanged();
    await flushPromises();
    expect(history.loadHistory).toHaveBeenCalledTimes(2);
  });
});
