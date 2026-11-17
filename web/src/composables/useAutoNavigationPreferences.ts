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

import { computed, ref, watch, type Ref } from "vue";

const AUTO_NAV_KEY_PREFIX = "ai-chat-auto-navigation";

// One map per user+org scope, shared by the composer's toggle and the turn engine; `version` makes reads reactive.
const cache = new Map<string, Record<string, boolean>>();
const version = ref(0);
// The choice made before a chat exists; the chat that appears next inherits it, then this goes back to on.
const pending = ref(true);

// Chat ids are per user and org, so another scope's map would apply to unrelated chats.
function prefsOf(scope: string): Record<string, boolean> {
  const cached = cache.get(scope);
  if (cached) return cached;
  let prefs: Record<string, boolean> = {};
  try {
    localStorage.removeItem(AUTO_NAV_KEY_PREFIX);
    const stored = localStorage.getItem(`${AUTO_NAV_KEY_PREFIX}:${scope}`);
    if (stored) prefs = JSON.parse(stored);
  } catch (error) {
    console.error("Error loading auto navigation preferences:", error);
  }
  cache.set(scope, prefs);
  return prefs;
}

/** A chat's Auto Navigation preference; on unless the user turned it off for that chat. */
export function isAutoNavigationEnabled(scope: string | null, chatId: string | null): boolean {
  void version.value;
  if (!scope || !chatId) return true;
  return prefsOf(scope)[chatId] ?? true;
}

export function setAutoNavigation(
  scope: string | null,
  chatId: string | null,
  value: boolean,
): void {
  if (!scope || !chatId) return;
  const prefs = prefsOf(scope);
  prefs[chatId] = value;
  version.value += 1;
  try {
    localStorage.setItem(`${AUTO_NAV_KEY_PREFIX}:${scope}`, JSON.stringify(prefs));
  } catch (error) {
    console.error("Error saving auto navigation preferences:", error);
  }
}

/** Per-chat auto-navigation preference, stored per user and org under `scopeKey`. */
export function useAutoNavigationPreferences(
  currentChatId: Ref<string | null>,
  scopeKey: Ref<string | null>,
) {
  // Immediate, because the chat Ask opens mounts its composer with the id already set.
  const inherit = (id: string | null) => {
    if (!id || !scopeKey.value) return;
    if (!pending.value && prefsOf(scopeKey.value)[id] === undefined) {
      setAutoNavigation(scopeKey.value, id, false);
    }
    pending.value = true;
  };
  watch(currentChatId, inherit, { flush: "sync", immediate: true });
  const autoNavigationEnabled = computed({
    get: () =>
      currentChatId.value
        ? isAutoNavigationEnabled(scopeKey.value, currentChatId.value)
        : pending.value,
    set: (value: boolean) => {
      if (currentChatId.value) setAutoNavigation(scopeKey.value, currentChatId.value, value);
      else pending.value = value;
    },
  });
  return { isAutoNavigationEnabled: autoNavigationEnabled };
}
