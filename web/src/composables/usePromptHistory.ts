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

import { ref, type Ref } from "vue";

// Not namespaced by organization: prompts recalled in one org show up in another.
const HISTORY_KEY = "ai-chat-query-history";
const MAX_HISTORY_SIZE = 10;

/**
 * Arrow-key recall of previously sent chat prompts, persisted to localStorage.
 * `inputMessage` is the composer model the recalled prompt is written into.
 */
export function usePromptHistory(inputMessage: Ref<string>) {
  const queryHistory = ref<string[]>([]);
  const historyIndex = ref(-1);

  // The composer is a contenteditable div, so a textarea-only check never fires.
  const isOnFirstLine = (el: HTMLTextAreaElement | HTMLElement | null) => {
    if (!el) return false;

    if (el instanceof HTMLTextAreaElement) {
      return !el.value.substring(0, el.selectionStart).includes("\n");
    }

    if (!el.isContentEditable) return false;

    const selection = el.ownerDocument?.defaultView?.getSelection();
    if (!selection || selection.rangeCount === 0) return false;

    const caret = selection.getRangeAt(0);
    if (!el.contains(caret.startContainer)) return false;

    const before = caret.cloneRange();
    before.selectNodeContents(el);
    before.setEnd(caret.startContainer, caret.startOffset);

    // Line breaks render as <br>, which Range.toString() drops, so check the nodes too.
    if (before.cloneContents().querySelector("br")) return false;
    return !before.toString().includes("\n");
  };

  // Navigate through query history
  const navigateHistory = (direction: "up" | "down") => {
    if (queryHistory.value.length === 0) return;

    if (direction === "up") {
      if (historyIndex.value < queryHistory.value.length - 1) {
        historyIndex.value++;
        inputMessage.value = queryHistory.value[historyIndex.value];
      }
    } else if (direction === "down") {
      if (historyIndex.value > 0) {
        historyIndex.value--;
        inputMessage.value = queryHistory.value[historyIndex.value];
      } else if (historyIndex.value === 0) {
        historyIndex.value = -1;
        inputMessage.value = "";
      }
    }
  };

  // Load query history from localStorage
  const loadQueryHistory = () => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        queryHistory.value = JSON.parse(stored);
      }
    } catch (error) {
      console.error("Error loading query history:", error);
      queryHistory.value = [];
    }
  };

  // Save query history to localStorage
  const saveQueryHistory = () => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(queryHistory.value));
    } catch (error) {
      console.error("Error saving query history:", error);
    }
  };

  // Add query to history
  const addToHistory = (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    // Remove if already exists to avoid duplicates
    const existingIndex = queryHistory.value.indexOf(trimmedQuery);
    if (existingIndex > -1) {
      queryHistory.value.splice(existingIndex, 1);
    }

    // Add to beginning of array
    queryHistory.value.unshift(trimmedQuery);

    // Keep only last MAX_HISTORY_SIZE entries
    if (queryHistory.value.length > MAX_HISTORY_SIZE) {
      queryHistory.value = queryHistory.value.slice(0, MAX_HISTORY_SIZE);
    }

    saveQueryHistory();
    historyIndex.value = -1; // Reset index
  };

  return {
    queryHistory,
    historyIndex,
    isOnFirstLine,
    navigateHistory,
    loadQueryHistory,
    addToHistory,
  };
}
