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

const AUTO_NAV_KEY = "ai-chat-auto-navigation";

/**
 * Per-chat auto-navigation preference, persisted to localStorage, with a pending
 * value for a new chat that has no id yet.
 */
export function useAutoNavigationPreferences(currentChatId: Ref<number | null>) {
  // Stores chat ID -> boolean mapping for auto navigation preference
  const autoNavigationPreferences = ref<Map<number, boolean>>(new Map());

  // Pending auto navigation preference for new chats (before chat ID is created)
  const pendingAutoNavigation = ref(true);

  const loadAutoNavigationPreferences = () => {
    try {
      const stored = localStorage.getItem(AUTO_NAV_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        autoNavigationPreferences.value = new Map(
          Object.entries(data).map(([k, v]) => [parseInt(k), v as boolean]),
        );
      }
    } catch (error) {
      console.error("Error loading auto navigation preferences:", error);
      autoNavigationPreferences.value = new Map();
    }
  };

  const saveAutoNavigationPreferences = () => {
    try {
      const data = Object.fromEntries(autoNavigationPreferences.value);
      localStorage.setItem(AUTO_NAV_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Error saving auto navigation preferences:", error);
    }
  };

  // Current chat's auto navigation state (defaults to true)
  const isAutoNavigationEnabled = computed({
    get: () => {
      if (!currentChatId.value) return pendingAutoNavigation.value;
      return autoNavigationPreferences.value.get(currentChatId.value) ?? true;
    },
    set: (value: boolean) => {
      if (currentChatId.value) {
        autoNavigationPreferences.value.set(currentChatId.value, value);
        saveAutoNavigationPreferences();
      } else {
        // Store temporarily for new chats
        pendingAutoNavigation.value = value;
      }
    },
  });

  return {
    autoNavigationPreferences,
    pendingAutoNavigation,
    isAutoNavigationEnabled,
    loadAutoNavigationPreferences,
    saveAutoNavigationPreferences,
  };
}
