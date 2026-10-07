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

const KEY_PREFIX = "o2.aiChat.selected.";

// One restore per user+org per page load, so a later "new chat" is never undone by it.
const restored = new Set<string>();

const storage = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/** Remember the open chat of this user+org for the tab, so a reload reopens it; `null` forgets it. */
export function rememberChatSelection(userOrgKey: string, chatId: number | null): void {
  try {
    const store = storage();
    if (!store) return;
    if (chatId === null) store.removeItem(KEY_PREFIX + userOrgKey);
    else store.setItem(KEY_PREFIX + userOrgKey, String(chatId));
  } catch {
    // Storage may be full or blocked; the selection then simply does not survive a reload.
  }
}

/** The chat this tab had open for the user+org before a reload, once per page load. */
export function recallChatSelection(userOrgKey: string): number | null {
  if (restored.has(userOrgKey)) return null;
  restored.add(userOrgKey);
  try {
    const value = storage()?.getItem(KEY_PREFIX + userOrgKey);
    const id = value ? Number(value) : NaN;
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}
