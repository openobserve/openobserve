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

import { ref, type Ref } from "vue";
import settings from "@/services/settings";
import { toast } from "@/lib/feedback/Toast/useToast";

export interface FavoriteDashboard {
  dashboardId: string;
  folderId: string;
  label: string;
}

// Reserved pseudo-folder id for the folder-rail "Favorites" entry. Real folder
// ids are generated identifiers, so the dunder name cannot collide.
export const FAVORITES_FOLDER_ID = "__favorites__";

const SETTING_KEY = "favorite_dashboards";
const SETTING_CATEGORY = "ui";

// Module-level shared reactive state — one source for all consumers, mirroring
// useHomeDashboard. Favorites are per-user (user-scoped setting), unlike the
// org-scoped home pin.
const favorites: Ref<FavoriteDashboard[]> = ref([]);
const isLoading = ref(false);

export function useFavoriteDashboards() {
  const isFavorite = (dashboardId: string) =>
    favorites.value.some((f) => f.dashboardId === dashboardId);

  const load = async (org: string, userId: string) => {
    if (!org || !userId) return;
    isLoading.value = true;
    try {
      const res = await settings.getSetting(org, SETTING_KEY, userId);
      const val = res?.data?.setting_value;
      favorites.value = Array.isArray(val)
        ? val.filter((f: any) => f && f.dashboardId)
        : [];
    } catch {
      // Missing setting / 404 → no favorites yet for this user.
      favorites.value = [];
    } finally {
      isLoading.value = false;
    }
  };

  const toggleFavorite = async (
    org: string,
    userId: string,
    d: FavoriteDashboard,
  ) => {
    if (!org || !userId) return; // never hit the API with an undefined segment
    const prev = favorites.value;
    favorites.value = isFavorite(d.dashboardId)
      ? prev.filter((f) => f.dashboardId !== d.dashboardId)
      : [...prev, d]; // optimistic
    try {
      await settings.setUserSetting(
        org,
        userId,
        SETTING_KEY,
        favorites.value,
        SETTING_CATEGORY,
      );
    } catch (e: any) {
      favorites.value = prev; // revert
      toast({
        variant: "error",
        message:
          e?.response?.status === 403
            ? "You don't have permission to change favorites"
            : "Couldn't update favorite dashboards",
      });
    }
  };

  return {
    favorites,
    isLoading,
    isFavorite,
    load,
    toggleFavorite,
  };
}
