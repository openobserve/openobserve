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

import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { useChatHistoryList } from "./useChatHistoryList";

import type { ChatHistoryEntry } from "@/ts/interfaces/chat";

const entry = (id: number, title: string) =>
  ({ id, title, messages: [], timestamp: id, sessionId: `s${id}` }) as unknown as ChatHistoryEntry;

const make = (overrides: Partial<Parameters<typeof useChatHistoryList>[0]> = {}) => {
  const deps = {
    loadHistoryFromDb: vi.fn(async () => [entry(1, "Alpha"), entry(2, "Beta")]),
    deleteChatById: vi.fn(async () => true),
    clearAllHistory: vi.fn(async () => true),
    updateChatTitle: vi.fn(async () => true),
    currentChatId: ref<number | null>(null),
    displayedTitle: ref(""),
    aiGeneratedTitle: ref<string | null>(null),
    addNewChat: vi.fn(),
    ...overrides,
  };
  return { deps, list: useChatHistoryList(deps) };
};

describe("useChatHistoryList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loadHistory", () => {
    it("stores what the db returned and returns it", async () => {
      const { list } = make();
      const result = await list.loadHistory();
      expect(list.chatHistory.value).toHaveLength(2);
      expect(result).toBe(list.chatHistory.value);
    });

    it("swallows a db failure and returns an empty array without clobbering the list", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { list } = make();
      await list.loadHistory();

      const { list: broken } = make({
        loadHistoryFromDb: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      await expect(broken.loadHistory()).resolves.toEqual([]);
      expect(broken.chatHistory.value).toEqual([]);
      expect(error).toHaveBeenCalled();
    });
  });

  describe("openHistory", () => {
    it("opens the drawer and refreshes the list", async () => {
      const { deps, list } = make();
      await list.openHistory();
      expect(list.showHistory.value).toBe(true);
      expect(deps.loadHistoryFromDb).toHaveBeenCalledTimes(1);
    });
  });

  describe("filteredChatHistory", () => {
    it("passes the list through untouched when the search term is empty", async () => {
      const { list } = make();
      await list.loadHistory();
      expect(list.filteredChatHistory.value).toBe(list.chatHistory.value);
    });

    it("matches titles case-insensitively on a substring", async () => {
      const { list } = make();
      await list.loadHistory();
      list.historySearchTerm.value = "ALP";
      expect(list.filteredChatHistory.value.map((c) => c.title)).toEqual(["Alpha"]);
      list.historySearchTerm.value = "zzz";
      expect(list.filteredChatHistory.value).toEqual([]);
    });
  });

  describe("title editing", () => {
    it("seeds the dialog from the currently displayed title", () => {
      const { deps, list } = make();
      deps.displayedTitle.value = "Current";
      list.openEditTitleDialog();
      expect(list.editingTitle.value).toBe("Current");
      expect(list.showEditTitleDialog.value).toBe(true);
    });

    it("closes without saving when there is no current chat", async () => {
      const { deps, list } = make();
      list.editingTitle.value = "New";
      await list.saveEditedTitle();
      expect(deps.updateChatTitle).not.toHaveBeenCalled();
      expect(list.showEditTitleDialog.value).toBe(false);
    });

    it("closes without saving when the title is only whitespace", async () => {
      const { deps, list } = make({ currentChatId: ref<number | null>(7) });
      list.editingTitle.value = "   ";
      await list.saveEditedTitle();
      expect(deps.updateChatTitle).not.toHaveBeenCalled();
    });

    it("writes the trimmed title to both title refs and reloads the list", async () => {
      const { deps, list } = make({ currentChatId: ref<number | null>(7) });
      list.editingTitle.value = "  Renamed  ";
      await list.saveEditedTitle();
      expect(deps.updateChatTitle).toHaveBeenCalledWith(7, "Renamed");
      expect(deps.displayedTitle.value).toBe("Renamed");
      expect(deps.aiGeneratedTitle.value).toBe("Renamed");
      expect(deps.loadHistoryFromDb).toHaveBeenCalledTimes(1);
      expect(list.showEditTitleDialog.value).toBe(false);
    });

    it("leaves the titles alone when the db reports no update", async () => {
      const { deps, list } = make({
        currentChatId: ref<number | null>(7),
        updateChatTitle: vi.fn(async () => false),
      });
      list.editingTitle.value = "Renamed";
      await list.saveEditedTitle();
      expect(deps.displayedTitle.value).toBe("");
      expect(deps.loadHistoryFromDb).not.toHaveBeenCalled();
    });

    it("still closes the dialog when the db throws", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { list } = make({
        currentChatId: ref<number | null>(7),
        updateChatTitle: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      list.editingTitle.value = "Renamed";
      await list.saveEditedTitle();
      expect(list.showEditTitleDialog.value).toBe(false);
      expect(error).toHaveBeenCalled();
    });
  });

  describe("deleting one chat", () => {
    it("arms the confirm dialog with the target id", () => {
      const { list } = make();
      list.deleteChat(5);
      expect(list.chatToDelete.value).toBe(5);
      expect(list.showDeleteChatConfirmDialog.value).toBe(true);
    });

    it("does nothing when nothing is armed", async () => {
      const { deps, list } = make();
      await list.confirmDeleteChat();
      expect(deps.deleteChatById).not.toHaveBeenCalled();
      expect(list.showDeleteChatConfirmDialog.value).toBe(false);
    });

    it("deletes, reloads, and resets the dialog", async () => {
      const { deps, list } = make({ currentChatId: ref<number | null>(9) });
      list.deleteChat(5);
      await list.confirmDeleteChat();
      expect(deps.deleteChatById).toHaveBeenCalledWith(5);
      expect(deps.addNewChat).not.toHaveBeenCalled();
      expect(deps.loadHistoryFromDb).toHaveBeenCalledTimes(1);
      expect(list.chatToDelete.value).toBeNull();
      expect(list.showDeleteChatConfirmDialog.value).toBe(false);
    });

    it("starts a new chat when the deleted chat was the open one", async () => {
      const { deps, list } = make({ currentChatId: ref<number | null>(5) });
      list.deleteChat(5);
      await list.confirmDeleteChat();
      expect(deps.addNewChat).toHaveBeenCalledTimes(1);
    });

    it("skips the reload when the db reports no delete", async () => {
      const { deps, list } = make({ deleteChatById: vi.fn(async () => false) });
      list.deleteChat(5);
      await list.confirmDeleteChat();
      expect(deps.loadHistoryFromDb).not.toHaveBeenCalled();
      expect(list.chatToDelete.value).toBeNull();
    });
  });

  describe("clearing all conversations", () => {
    it("only opens the dialog", () => {
      const { deps, list } = make();
      list.clearAllConversations();
      expect(list.showClearAllConfirmDialog.value).toBe(true);
      expect(deps.clearAllHistory).not.toHaveBeenCalled();
    });

    it("resets to a new chat and empties the list", async () => {
      const { deps, list } = make();
      await list.loadHistory();
      list.clearAllConversations();
      await list.confirmClearAllConversations();
      expect(deps.addNewChat).toHaveBeenCalledTimes(1);
      expect(list.chatHistory.value).toEqual([]);
      expect(list.showClearAllConfirmDialog.value).toBe(false);
    });

    it("keeps the list when the db reports no clear", async () => {
      const { deps, list } = make({ clearAllHistory: vi.fn(async () => false) });
      await list.loadHistory();
      await list.confirmClearAllConversations();
      expect(deps.addNewChat).not.toHaveBeenCalled();
      expect(list.chatHistory.value).toHaveLength(2);
      expect(list.showClearAllConfirmDialog.value).toBe(false);
    });

    it("still closes the dialog when the db throws", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { list } = make({
        clearAllHistory: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      await list.confirmClearAllConversations();
      expect(list.showClearAllConfirmDialog.value).toBe(false);
      expect(error).toHaveBeenCalled();
    });
  });
});
