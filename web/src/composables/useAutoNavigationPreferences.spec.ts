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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { useAutoNavigationPreferences } from "@/composables/useAutoNavigationPreferences";

const KEY = "ai-chat-auto-navigation";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useAutoNavigationPreferences", () => {
  it("follows the pending value while the chat has no id, without persisting", () => {
    const chatId = ref<number | null>(null);
    const p = useAutoNavigationPreferences(chatId);
    expect(p.isAutoNavigationEnabled.value).toBe(true);
    p.isAutoNavigationEnabled.value = false;
    expect(p.pendingAutoNavigation.value).toBe(false);
    expect(p.autoNavigationPreferences.value.size).toBe(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("treats chat id 0 as no chat", () => {
    const p = useAutoNavigationPreferences(ref<number | null>(0));
    p.pendingAutoNavigation.value = false;
    expect(p.isAutoNavigationEnabled.value).toBe(false);
  });

  it("defaults a known chat to on regardless of the pending value, and persists writes", () => {
    const chatId = ref<number | null>(3);
    const p = useAutoNavigationPreferences(chatId);
    p.pendingAutoNavigation.value = false;
    expect(p.isAutoNavigationEnabled.value).toBe(true);
    p.isAutoNavigationEnabled.value = false;
    expect(p.pendingAutoNavigation.value).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('{"3":false}');
  });

  it("re-reads the shared chat id ref and a Map replaced by load", () => {
    const chatId = ref<number | null>(null);
    const p = useAutoNavigationPreferences(chatId);
    localStorage.setItem(KEY, '{"9":false}');
    p.loadAutoNavigationPreferences();
    chatId.value = 9;
    expect(p.isAutoNavigationEnabled.value).toBe(false);
    expect([...p.autoNavigationPreferences.value.keys()]).toEqual([9]);
  });

  it("persists a direct Map write through the returned save", () => {
    const p = useAutoNavigationPreferences(ref<number | null>(null));
    p.autoNavigationPreferences.value.set(42, false);
    p.saveAutoNavigationPreferences();
    expect(localStorage.getItem(KEY)).toBe('{"42":false}');
  });

  it("logs and resets on a corrupt store, logs on a refused write", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = useAutoNavigationPreferences(ref<number | null>(1));
    p.autoNavigationPreferences.value.set(1, false);
    localStorage.setItem(KEY, "{x");
    p.loadAutoNavigationPreferences();
    expect(p.autoNavigationPreferences.value.size).toBe(0);
    expect(err).toHaveBeenCalledWith(
      "Error loading auto navigation preferences:",
      expect.anything(),
    );

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    p.isAutoNavigationEnabled.value = false;
    expect(err).toHaveBeenCalledWith(
      "Error saving auto navigation preferences:",
      expect.anything(),
    );
    expect(p.isAutoNavigationEnabled.value).toBe(false);
  });
});
