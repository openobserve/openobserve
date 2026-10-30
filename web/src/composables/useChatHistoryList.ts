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

import { computed, ref, type Ref } from "vue";

import type { ChatHistoryEntry } from "@/ts/interfaces/chat";

export interface ChatHistoryListDeps {
  loadHistoryFromDb: () => Promise<ChatHistoryEntry[]>;
  deleteChatById: (chatId: number) => Promise<boolean>;
  clearAllHistory: () => Promise<boolean>;
  updateChatTitle: (chatId: number, newTitle: string) => Promise<boolean>;
  currentChatId: Ref<number | null>;
  displayedTitle: Ref<string>;
  aiGeneratedTitle: Ref<string | null>;
  addNewChat: () => void;
}

/**
 * The saved-chat list and the three dialogs that mutate it (rename, delete one,
 * clear all). Storage and the new-chat reset are injected; this owns only the
 * list, its search term, and the dialog visibility around them.
 */
export function useChatHistoryList(deps: ChatHistoryListDeps) {
  const showHistory = ref(false);
  // `model` is stored on persisted entries but missing from the shared interface
  const chatHistory = ref<(ChatHistoryEntry & { model?: string })[]>([]);
  const historySearchTerm = ref("");

  // Edit title state
  const showEditTitleDialog = ref(false);
  const editingTitle = ref("");

  // Clear all confirmation state
  const showClearAllConfirmDialog = ref(false);

  // Delete individual chat confirmation state
  const showDeleteChatConfirmDialog = ref(false);
  const chatToDelete = ref<number | null>(null);

  const filteredChatHistory = computed(() => {
    if (!historySearchTerm.value) {
      return chatHistory.value;
    }
    const searchTerm = historySearchTerm.value.toLowerCase();
    return chatHistory.value.filter((chat) => chat.title.toLowerCase().includes(searchTerm));
  });

  const loadHistory = async () => {
    try {
      // Load history using the composable (automatically prunes to 100 items)
      const history = await deps.loadHistoryFromDb();
      chatHistory.value = history;
      return chatHistory.value;
    } catch (error) {
      console.error("Error loading chat history:", error);
      return [];
    }
  };

  const openHistory = async () => {
    showHistory.value = true;
    await loadHistory();
  };

  const openEditTitleDialog = () => {
    editingTitle.value = deps.displayedTitle.value || "";
    showEditTitleDialog.value = true;
  };

  const saveEditedTitle = async () => {
    if (!deps.currentChatId.value || !editingTitle.value.trim()) {
      showEditTitleDialog.value = false;
      return;
    }

    try {
      // Update title using the composable
      const success = await deps.updateChatTitle(
        deps.currentChatId.value,
        editingTitle.value.trim(),
      );

      if (success) {
        // Update the displayed title
        deps.displayedTitle.value = editingTitle.value.trim();
        deps.aiGeneratedTitle.value = editingTitle.value.trim();

        // Reload history to reflect changes
        loadHistory();
      }
    } catch (error) {
      console.error("Error updating chat title:", error);
    } finally {
      showEditTitleDialog.value = false;
    }
  };

  const deleteChat = (chatId: number) => {
    chatToDelete.value = chatId;
    showDeleteChatConfirmDialog.value = true;
  };

  const confirmDeleteChat = async () => {
    if (!chatToDelete.value) return;

    try {
      // Delete chat using the composable
      const success = await deps.deleteChatById(chatToDelete.value);

      if (success) {
        // If the deleted chat is the current one, reset to new chat
        if (deps.currentChatId.value === chatToDelete.value) {
          deps.addNewChat();
        }

        // Reload history to reflect changes
        loadHistory();
      }
    } catch (error) {
      console.error("Error deleting chat:", error);
    } finally {
      // Reset state
      chatToDelete.value = null;
      showDeleteChatConfirmDialog.value = false;
    }
  };

  const clearAllConversations = () => {
    showClearAllConfirmDialog.value = true;
  };

  const confirmClearAllConversations = async () => {
    try {
      // Clear all history using the composable
      const success = await deps.clearAllHistory();

      if (success) {
        // Reset to new chat
        deps.addNewChat();

        // Clear the chat history array
        chatHistory.value = [];
      }
    } catch (error) {
      console.error("Error clearing all conversations:", error);
    } finally {
      showClearAllConfirmDialog.value = false;
    }
  };

  return {
    showHistory,
    chatHistory,
    historySearchTerm,
    filteredChatHistory,
    loadHistory,
    openHistory,
    showEditTitleDialog,
    editingTitle,
    openEditTitleDialog,
    saveEditedTitle,
    showDeleteChatConfirmDialog,
    chatToDelete,
    deleteChat,
    confirmDeleteChat,
    showClearAllConfirmDialog,
    clearAllConversations,
    confirmClearAllConversations,
  };
}
