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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { reactive } from "vue";

const { toastMock, storeState } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  storeState: { selectedOrganization: { identifier: "org-a" } },
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({ state: storeState }),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: toastMock,
}));

import { useFavoriteSavedViews } from "@/composables/useFavoriteSavedViews";

const view = (id: string, org = "org-a", type?: string) => ({
  view_id: id,
  view_name: `view ${id}`,
  org_id: org,
  ...(type ? { view_type: type } : {}),
});

const stored = () => JSON.parse(localStorage.getItem("savedViews") || "{}");

describe("useFavoriteSavedViews", () => {
  beforeEach(() => {
    localStorage.clear();
    toastMock.mockClear();
    storeState.selectedOrganization = reactive({ identifier: "org-a" });
  });

  it("reads the existing { [view_id]: row } storage shape", () => {
    localStorage.setItem("savedViews", JSON.stringify({ l1: view("l1"), l2: view("l2") }));

    const { favoriteIds, favoriteViews } = useFavoriteSavedViews("logs");

    expect(favoriteIds.value).toEqual(["l1", "l2"]);
    expect(favoriteViews.value).toEqual([view("l1"), view("l2")]);
  });

  it("filters by the current org and by view type, rows without a type being logs", () => {
    localStorage.setItem(
      "savedViews",
      JSON.stringify({
        l1: view("l1"),
        l2: view("l2", "org-b"),
        t1: view("t1", "org-a", "traces"),
        l3: view("l3", "org-a", "logs"),
      }),
    );

    expect(useFavoriteSavedViews("logs").favoriteIds.value).toEqual(["l1", "l3"]);
    expect(useFavoriteSavedViews("traces").favoriteIds.value).toEqual(["t1"]);
  });

  it("ignores unreadable storage", () => {
    localStorage.setItem("savedViews", "not json");
    expect(useFavoriteSavedViews("logs").favoriteIds.value).toEqual([]);
  });

  it("adds a favourite, keeps other entries and toasts", () => {
    localStorage.setItem("savedViews", JSON.stringify({ x1: view("x1", "org-b") }));
    const { favoriteIds, toggleFavorite } = useFavoriteSavedViews("traces");

    toggleFavorite(view("t1", "org-a", "traces"), false);

    expect(favoriteIds.value).toEqual(["t1"]);
    expect(Object.keys(stored())).toEqual(["x1", "t1"]);
    expect(toastMock).toHaveBeenCalledWith({
      message: "logs.searchBar.viewAddedFavorites",
      variant: "success",
    });
  });

  it("removes a favourite when it is already one", () => {
    localStorage.setItem("savedViews", JSON.stringify({ l1: view("l1"), l2: view("l2") }));
    const { favoriteIds, toggleFavorite } = useFavoriteSavedViews("logs");

    toggleFavorite(view("l1"), true);

    expect(favoriteIds.value).toEqual(["l2"]);
    expect(Object.keys(stored())).toEqual(["l2"]);
    expect(toastMock).toHaveBeenCalledWith({
      message: "logs.searchBar.viewRemovedFavorites",
      variant: "success",
    });
  });

  it("caps favourites at 10 per org and view type", () => {
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) entries[`l${i}`] = view(`l${i}`);
    entries.b1 = view("b1", "org-b");
    localStorage.setItem("savedViews", JSON.stringify(entries));

    const logs = useFavoriteSavedViews("logs");
    logs.toggleFavorite(view("l10"), false);
    expect(logs.favoriteIds.value).toHaveLength(10);
    expect(stored().l10).toBeUndefined();
    expect(toastMock).toHaveBeenCalledWith({
      message: "logs.searchBar.maxViewsLimit",
      variant: "warning",
    });

    const traces = useFavoriteSavedViews("traces");
    traces.toggleFavorite(view("t1", "org-a", "traces"), false);
    expect(traces.favoriteIds.value).toEqual(["t1"]);
  });

  it("counts favourites written by another instance before applying the cap", () => {
    const first = useFavoriteSavedViews("logs");
    const second = useFavoriteSavedViews("logs");
    for (let i = 0; i < 10; i++) first.toggleFavorite(view(`l${i}`), false);

    second.toggleFavorite(view("l10"), false);

    expect(stored().l10).toBeUndefined();
  });

  it("removeFavorite drops the entry silently", () => {
    localStorage.setItem("savedViews", JSON.stringify({ t1: view("t1", "org-a", "traces") }));
    const { favoriteIds, removeFavorite } = useFavoriteSavedViews("traces");

    removeFavorite("t1");

    expect(favoriteIds.value).toEqual([]);
    expect(stored()).toEqual({});
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("follows an org switch", () => {
    localStorage.setItem("savedViews", JSON.stringify({ l1: view("l1"), l2: view("l2", "org-b") }));
    const { favoriteIds } = useFavoriteSavedViews("logs");
    expect(favoriteIds.value).toEqual(["l1"]);

    storeState.selectedOrganization.identifier = "org-b";

    expect(favoriteIds.value).toEqual(["l2"]);
  });

  it("prunes only this org's and view type's favourites missing from the live list", () => {
    localStorage.setItem(
      "savedViews",
      JSON.stringify({
        t1: view("t1", "org-a", "traces"),
        t2: view("t2", "org-a", "traces"),
        tb: view("tb", "org-b", "traces"),
        l1: view("l1"),
      }),
    );
    const { favoriteIds, pruneFavorites } = useFavoriteSavedViews("traces");

    pruneFavorites(["t1"]);

    expect(favoriteIds.value).toEqual(["t1"]);
    expect(Object.keys(stored())).toEqual(["t1", "tb", "l1"]);
  });

  it("re-reads storage before pruning and skips the write when nothing is stale", () => {
    const { favoriteIds, pruneFavorites } = useFavoriteSavedViews("logs");
    localStorage.setItem("savedViews", JSON.stringify({ l1: view("l1"), l2: view("l2") }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    pruneFavorites(["l1", "l2"]);
    expect(setItem).not.toHaveBeenCalled();

    pruneFavorites(["l2"]);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(favoriteIds.value).toEqual(["l2"]);
    setItem.mockRestore();
  });

  it("frees the cap once deleted favourites are pruned", () => {
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) entries[`l${i}`] = view(`l${i}`);
    localStorage.setItem("savedViews", JSON.stringify(entries));
    const logs = useFavoriteSavedViews("logs");

    logs.pruneFavorites(["l0", "l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"]);
    logs.toggleFavorite(view("l10"), false);

    expect(stored().l9).toBeUndefined();
    expect(stored().l10).toEqual(view("l10"));
    expect(logs.favoriteIds.value).toHaveLength(10);
  });

  it("keeps working in memory when localStorage rejects the write", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const { favoriteIds, toggleFavorite, removeFavorite, pruneFavorites } =
      useFavoriteSavedViews("logs");

    expect(() => toggleFavorite(view("l1"), false)).not.toThrow();
    expect(favoriteIds.value).toEqual(["l1"]);
    expect(() => removeFavorite("l1")).not.toThrow();
    expect(() => pruneFavorites([])).not.toThrow();
    setItem.mockRestore();
  });
});
