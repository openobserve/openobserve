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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
};

/** Favourite saved views of one view type in the current org, persisted in localStorage. */
export function useFavoriteSavedViews(viewType: FavoriteViewType) {
  const store = useStore();
  const { t } = useI18nTyped();
  const stored = ref<Record<string, FavoriteSavedView>>(readStore());

  const favoriteViews = computed(() => {
    const orgId = store.state.selectedOrganization?.identifier;
    return Object.values(stored.value).filter(
      (view) => view?.org_id === orgId && viewTypeOf(view) === viewType,
    );
  });
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

  return { favoriteIds, favoriteViews, toggleFavorite, removeFavorite };
}
