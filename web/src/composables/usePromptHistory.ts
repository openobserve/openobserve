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

import { ref, watch, type Ref } from "vue";

const HISTORY_KEY_PREFIX = "ai-chat-query-history";
const MAX_HISTORY_SIZE = 10;

/**
 * Arrow-key recall of sent prompts, stored per user and org under `scopeKey`, which is null until its hash resolves.
 */
export function usePromptHistory(inputMessage: Ref<string>, scopeKey: Ref<string | null>) {
  const queryHistory = ref<string[]>([]);
  const historyIndex = ref(-1);

  const storageKey = () => (scopeKey.value ? `${HISTORY_KEY_PREFIX}:${scopeKey.value}` : null);

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

  // Always clears first, so a previous user's or org's prompts never survive a scope change.
  const loadQueryHistory = () => {
    queryHistory.value = [];
    historyIndex.value = -1;
    const key = storageKey();
    if (!key) return;
    try {
      // The old unscoped key cannot be attributed to any user, so it is dropped rather than migrated.
      localStorage.removeItem(HISTORY_KEY_PREFIX);
      const stored = localStorage.getItem(key);
      if (stored) {
        queryHistory.value = JSON.parse(stored);
      }
    } catch (error) {
      console.error("Error loading query history:", error);
      queryHistory.value = [];
    }
  };

  const saveQueryHistory = () => {
    const key = storageKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(queryHistory.value));
    } catch (error) {
      console.error("Error saving query history:", error);
    }
  };

  watch(scopeKey, loadQueryHistory);

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
