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
import store from "@/stores";
import {
  ORG_LIST_FULL_PAGE_SIZE,
  __resetOrgSwitcherPrefsForTest,
  flushPendingLanding,
  noteLanding,
  orgSwitcherStorageKey,
  prune,
  readPrefs,
  recordVisit,
  useOrgSwitcherPrefs,
} from "@/composables/useOrgSwitcherPrefs";

const EMAIL = "User@Example.com ";
const KEY = "o2:org-switcher:v1:user@example.com";

const signIn = (email: string | undefined) => store.commit("setUserInfo", email ? { email } : {});
const stored = (key = KEY) => JSON.parse(localStorage.getItem(key) ?? "null");
const seed = (value: unknown, key = KEY) => localStorage.setItem(key, JSON.stringify(value));
const ids = (n: number, prefix = "o") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe("useOrgSwitcherPrefs", () => {
  beforeEach(() => {
    localStorage.clear();
    signIn(EMAIL);
    __resetOrgSwitcherPrefsForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    signIn(undefined);
  });

  describe("storage key", () => {
    it("A1 is the trimmed lower-case email, null when the email is empty", () => {
      expect(orgSwitcherStorageKey(EMAIL)).toBe(KEY);
      expect(orgSwitcherStorageKey("  ")).toBeNull();
      expect(orgSwitcherStorageKey(undefined)).toBeNull();
    });

    it("A1 neither reads nor writes while the email is empty", () => {
      signIn(undefined);
      const getItem = vi.spyOn(Storage.prototype, "getItem");
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      __resetOrgSwitcherPrefsForTest();
      const prefs = useOrgSwitcherPrefs();
      expect(prefs.toggleFavorite("acme")).toBe(false);
      recordVisit("acme");
      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
      expect(prefs.favorites.value).toEqual([]);
      expect(prefs.canStore.value).toBe(false);
    });

    it("A2 reloads state when the email changes", () => {
      seed({ v: 1, favorites: ["a"], recents: [] });
      seed({ v: 1, favorites: ["b"], recents: ["c"] }, "o2:org-switcher:v1:other@example.com");
      __resetOrgSwitcherPrefsForTest();
      const prefs = useOrgSwitcherPrefs();
      expect(prefs.favorites.value).toEqual(["a"]);
      signIn("other@example.com");
      expect(prefs.favorites.value).toEqual(["b"]);
      expect(prefs.recents.value).toEqual(["c"]);
    });
  });

  describe("reading", () => {
    it.each([
      ["bad JSON", "{not json"],
      ["unknown version", JSON.stringify({ v: 2, favorites: ["a"], recents: [] })],
      ["wrong shape", JSON.stringify({ v: 1, favorites: "a", recents: [] })],
      ["non-string ids", JSON.stringify({ v: 1, favorites: [1], recents: [] })],
      ["an array", JSON.stringify([])],
    ])("A3 %s gives empty prefs and leaves storage untouched", (_label, raw) => {
      localStorage.setItem(KEY, raw);
      __resetOrgSwitcherPrefsForTest();
      expect(useOrgSwitcherPrefs().favorites.value).toEqual([]);
      expect(localStorage.getItem(KEY)).toBe(raw);
    });

    it("A4 dedupes and clamps to 10 favorites and 10 recents", () => {
      seed({ v: 1, favorites: ["a", "a", ...ids(12)], recents: ["r", "r", ...ids(12, "r")] });
      const prefs = readPrefs(KEY);
      expect(prefs.favorites).toHaveLength(10);
      expect(prefs.favorites.slice(0, 2)).toEqual(["a", "o0"]);
      expect(prefs.recents).toHaveLength(10);
      expect(prefs.recents.slice(0, 2)).toEqual(["r", "r0"]);
    });
  });

  describe("writing", () => {
    it("A5 keeps the change in memory when setItem throws", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      const prefs = useOrgSwitcherPrefs();
      expect(() => prefs.toggleFavorite("acme")).not.toThrow();
      expect(prefs.isFavorite("acme")).toBe(true);
    });

    it("A6 appends and removes favorites; the 11th add is refused", () => {
      const prefs = useOrgSwitcherPrefs();
      expect(prefs.toggleFavorite("b")).toBe(true);
      expect(prefs.toggleFavorite("a")).toBe(true);
      expect(stored().favorites).toEqual(["b", "a"]);
      expect(prefs.toggleFavorite("b")).toBe(true);
      expect(prefs.favorites.value).toEqual(["a"]);

      for (const id of ids(9)) prefs.toggleFavorite(id);
      expect(prefs.canAddFavorite.value).toBe(false);
      expect(prefs.toggleFavorite("eleventh")).toBe(false);
      expect(prefs.favorites.value).toHaveLength(10);
      expect(stored().favorites).not.toContain("eleventh");
    });

    it("A7 recordVisit pushes to the front, dedupes and keeps 10", () => {
      for (const id of ids(11)) recordVisit(id);
      recordVisit("o5");
      const { recents } = useOrgSwitcherPrefs();
      expect(recents.value).toHaveLength(10);
      expect(recents.value[0]).toBe("o5");
      expect(recents.value.filter((id) => id === "o5")).toHaveLength(1);
      expect(recents.value).not.toContain("o0");
      expect(stored().recents).toEqual(recents.value);
    });
  });

  describe("cross-tab", () => {
    const fire = (key: string | null, storageArea: Storage = localStorage) =>
      window.dispatchEvent(new StorageEvent("storage", { key, storageArea }));

    it("A8 reloads on a storage event for the current key, resets on a clear, ignores others", () => {
      const prefs = useOrgSwitcherPrefs();
      seed({ v: 1, favorites: ["x"], recents: [] });
      fire("unrelated");
      expect(prefs.favorites.value).toEqual([]);

      fire(KEY);
      expect(prefs.favorites.value).toEqual(["x"]);

      localStorage.clear();
      fire(null);
      expect(prefs.favorites.value).toEqual([]);
    });

    it("A8 ignores a sessionStorage clear, so the next write keeps the saved favorites", () => {
      seed({ v: 1, favorites: ["x"], recents: [] });
      __resetOrgSwitcherPrefsForTest();
      const prefs = useOrgSwitcherPrefs();
      fire(null, sessionStorage);
      fire(KEY, sessionStorage);
      expect(prefs.favorites.value).toEqual(["x"]);
      recordVisit("acme");
      expect(stored()).toEqual({ v: 1, favorites: ["x"], recents: ["acme"] });
    });
  });

  describe("prune", () => {
    beforeEach(() => {
      seed({ v: 1, favorites: ["keep", "gone"], recents: ["gone", "keep"] });
      __resetOrgSwitcherPrefsForTest();
    });

    it("A9 skips an empty list and a list that may be capped", () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      prune([]);
      prune(Array.from({ length: ORG_LIST_FULL_PAGE_SIZE }, (_, i) => `id${i}`));
      expect(setItem).not.toHaveBeenCalled();
      expect(useOrgSwitcherPrefs().favorites.value).toEqual(["keep", "gone"]);
    });

    it("A9 removes ids missing from a complete list, and writes only on change", () => {
      prune(["keep", "other"]);
      expect(stored()).toEqual({ v: 1, favorites: ["keep"], recents: ["keep"] });
      const setItem = vi.spyOn(Storage.prototype, "setItem");
      prune(["keep"]);
      expect(setItem).not.toHaveBeenCalled();
    });
  });

  describe("landings", () => {
    it("A10 holds a landing until the org list loads, then records it once", () => {
      noteLanding("acme", []);
      expect(useOrgSwitcherPrefs().recents.value).toEqual([]);
      flushPendingLanding(["acme", "other"]);
      expect(useOrgSwitcherPrefs().recents.value).toEqual(["acme"]);
      recordVisit("other");
      flushPendingLanding(["acme", "other"]);
      expect(useOrgSwitcherPrefs().recents.value).toEqual(["other", "acme"]);
    });

    it("A10 never records an identifier the org list does not have", () => {
      noteLanding("ghost", ["acme"]);
      noteLanding("ghost", []);
      flushPendingLanding(["acme"]);
      expect(useOrgSwitcherPrefs().recents.value).toEqual([]);
    });

    it("C3 an empty list leaves the held landing for the next load", () => {
      noteLanding("acme", []);
      flushPendingLanding([]);
      flushPendingLanding(["acme"]);
      expect(useOrgSwitcherPrefs().recents.value).toEqual(["acme"]);
    });
  });
});
