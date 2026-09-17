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
import { nextTick, ref } from "vue";

import { useAutoNavigationPreferences } from "@/composables/useAutoNavigationPreferences";

const LEGACY_KEY = "ai-chat-auto-navigation";
const KEY = `${LEGACY_KEY}:scope-a`;
const scope = (value: string | null = "scope-a") => ref<string | null>(value);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useAutoNavigationPreferences", () => {
  describe("user and org scope", () => {
    it("persists under the scoped key and never under the old unscoped key", () => {
      const p = useAutoNavigationPreferences(ref<number | null>(4), scope("user-a"));
      p.isAutoNavigationEnabled.value = false;
      expect(localStorage.getItem(`${LEGACY_KEY}:user-a`)).toBe('{"4":false}');
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it("does not apply one user's choice to another user's chat with the same id", async () => {
      localStorage.setItem(`${LEGACY_KEY}:user-a`, '{"7":false}');
      const key = scope("user-a");
      const p = useAutoNavigationPreferences(ref<number | null>(7), key);
      p.loadAutoNavigationPreferences();
      expect(p.isAutoNavigationEnabled.value).toBe(false);

      key.value = "user-b";
      await nextTick();
      expect(p.autoNavigationPreferences.value.size).toBe(0);
      expect(p.isAutoNavigationEnabled.value).toBe(true);
    });

    it("neither reads nor writes storage while the scope hash is unresolved", () => {
      localStorage.setItem(LEGACY_KEY, '{"2":false}');
      const p = useAutoNavigationPreferences(ref<number | null>(2), scope(null));
      p.loadAutoNavigationPreferences();
      expect(p.isAutoNavigationEnabled.value).toBe(true);
      p.isAutoNavigationEnabled.value = false;
      expect(Object.keys(localStorage).filter((k) => k.startsWith(`${LEGACY_KEY}:`))).toEqual([]);
    });

    it("drops the old unscoped map on load", () => {
      localStorage.setItem(LEGACY_KEY, '{"1":false}');
      const p = useAutoNavigationPreferences(ref<number | null>(1), scope("user-a"));
      p.loadAutoNavigationPreferences();
      expect(p.isAutoNavigationEnabled.value).toBe(true);
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });
  });

  it("follows the pending value while the chat has no id, without persisting", () => {
    const chatId = ref<number | null>(null);
    const p = useAutoNavigationPreferences(chatId, scope());
    expect(p.isAutoNavigationEnabled.value).toBe(true);
    p.isAutoNavigationEnabled.value = false;
    expect(p.pendingAutoNavigation.value).toBe(false);
    expect(p.autoNavigationPreferences.value.size).toBe(0);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("treats chat id 0 as no chat", () => {
    const p = useAutoNavigationPreferences(ref<number | null>(0), scope());
    p.pendingAutoNavigation.value = false;
    expect(p.isAutoNavigationEnabled.value).toBe(false);
  });

  it("defaults a known chat to on regardless of the pending value, and persists writes", () => {
    const chatId = ref<number | null>(3);
    const p = useAutoNavigationPreferences(chatId, scope());
    p.pendingAutoNavigation.value = false;
    expect(p.isAutoNavigationEnabled.value).toBe(true);
    p.isAutoNavigationEnabled.value = false;
    expect(p.pendingAutoNavigation.value).toBe(false);
    expect(localStorage.getItem(KEY)).toBe('{"3":false}');
  });

  it("re-reads the shared chat id ref and a Map replaced by load", () => {
    const chatId = ref<number | null>(null);
    const p = useAutoNavigationPreferences(chatId, scope());
    localStorage.setItem(KEY, '{"9":false}');
    p.loadAutoNavigationPreferences();
    chatId.value = 9;
    expect(p.isAutoNavigationEnabled.value).toBe(false);
    expect([...p.autoNavigationPreferences.value.keys()]).toEqual([9]);
  });

  it("persists a direct Map write through the returned save", () => {
    const p = useAutoNavigationPreferences(ref<number | null>(null), scope());
    p.autoNavigationPreferences.value.set(42, false);
    p.saveAutoNavigationPreferences();
    expect(localStorage.getItem(KEY)).toBe('{"42":false}');
  });

  it("logs and resets on a corrupt store, logs on a refused write", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const p = useAutoNavigationPreferences(ref<number | null>(1), scope());
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
