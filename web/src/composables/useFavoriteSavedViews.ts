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

import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { viewTypeOf } from "@/services/saved_views";

// One key for every org and view type, so favourites saved before view types existed still load.
const STORAGE_KEY = "savedViews";
const MAX_FAVORITES = 10;

export type FavoriteViewType = "logs" | "traces";

export interface FavoriteSavedView {
  view_id: string;
  view_name: string;
  org_id?: string;
  view_type?: string | null;
  [key: string]: unknown;
}

const readStore = (): Record<string, FavoriteSavedView> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeStore = (value: Record<string, FavoriteSavedView>) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A full or blocked localStorage must not fail the caller; the in-memory favourites still update.
  }
};

/** Favourite saved views of one view type in the current org, persisted in localStorage. */
export function useFavoriteSavedViews(viewType: FavoriteViewType) {
  const store = useStore();
  const { t } = useI18nTyped();
  const stored = ref<Record<string, FavoriteSavedView>>(readStore());

  const isOwnFavorite = (view: FavoriteSavedView) =>
    view?.org_id === store.state.selectedOrganization?.identifier && viewTypeOf(view) === viewType;

  const favoriteViews = computed(() => Object.values(stored.value).filter(isOwnFavorite));
  const favoriteIds = computed(() => favoriteViews.value.map((view) => view.view_id));

  const removeFavorite = (viewId: string) => {
    const next = readStore();
    delete next[viewId];
    writeStore(next);
    stored.value = next;
  };

  const toggleFavorite = (row: FavoriteSavedView, isFavorite: boolean) => {
    if (isFavorite) {
      removeFavorite(row.view_id);
      toast({ message: t("logs.searchBar.viewRemovedFavorites"), variant: "success" });
      return;
    }
    const next = readStore();
    stored.value = next;
    if (favoriteIds.value.length >= MAX_FAVORITES) {
      toast({ message: t("logs.searchBar.maxViewsLimit"), variant: "warning" });
      return;
    }
    next[row.view_id] = JSON.parse(JSON.stringify(row));
    writeStore(next);
    stored.value = { ...next };
    toast({ message: t("logs.searchBar.viewAddedFavorites"), variant: "success" });
  };

  /** Drops this org's and view type's favourites missing from a complete, successfully fetched list. */
  const pruneFavorites = (liveIds: string[]) => {
    const live = new Set(liveIds);
    const next = readStore();
    const stale = Object.keys(next).filter(
      (key) => isOwnFavorite(next[key]) && !live.has(next[key].view_id),
    );
    if (!stale.length) return;
    stale.forEach((key) => delete next[key]);
    writeStore(next);
    stored.value = next;
  };

  return { favoriteIds, favoriteViews, toggleFavorite, removeFavorite, pruneFavorites };
}
