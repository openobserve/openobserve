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

import { settingQuery } from "@/services/settings.queries";
import { settingKeys } from "@/services/settings.querykeys";
import { queryClient, setPersistedQueryData } from "@/composables/query/queryClient";
import { fetchInto } from "@/composables/query/fetchInto";
import { ref, type Ref } from "vue";
import settings from "@/services/settings";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { TranslateFn, I18nText } from "@/types/i18n";

export interface FavoriteDashboard {
  dashboardId: string;
  folderId: string;
  label: I18nText;
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

  /**
   * Cached read — this runs on nearly every Dashboards mount, and the result
   * survives a reload so the favourites rail paints immediately. `force` is for
   * the rare caller that must see the server's copy.
   */
  const load = async (org: string, userId: string, force = false) => {
    if (!org || !userId) return;
    const apply = (val: unknown) => {
      favorites.value = Array.isArray(val) ? val.filter((f: any) => f && f.dashboardId) : [];
    };
    try {
      if (force) {
        isLoading.value = true;
        const options = settingQuery(org, SETTING_KEY, userId);
        await queryClient.invalidateQueries({
          queryKey: options.queryKey,
          exact: true,
          refetchType: "none",
        });
        apply(await queryClient.fetchQuery(options));
        return;
      }
      // Stale-while-revalidate: the favourites rail keeps its rows while the
      // setting revalidates.
      await fetchInto(settingQuery(org, SETTING_KEY, userId), { apply, loading: isLoading });
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
    t: TranslateFn,
  ) => {
    if (!org || !userId) return; // never hit the API with an undefined segment
    const prev = favorites.value;
    favorites.value = isFavorite(d.dashboardId)
      ? prev.filter((f) => f.dashboardId !== d.dashboardId)
      : [...prev, d]; // optimistic
    try {
      await settings.setUserSetting(org, userId, SETTING_KEY, favorites.value, SETTING_CATEGORY);
      setPersistedQueryData(settingKeys.one(org, SETTING_KEY, userId), favorites.value);
    } catch (e: any) {
      favorites.value = prev; // revert
      toast({
        variant: "error",
        message:
          e?.response?.status === 403
            ? t("toastMessages.composables.noPermissionToChangeFavorites")
            : t("toastMessages.composables.couldNotUpdateFavoriteDashboards"),
      });
    }
  };

  // Drop favorites pointing at dashboards that no longer exist (deleted from
  // their folder). Without this the Favorites view keeps rendering a ghost row
  // from the stored label, and acting on it hits the API with a dead id.
  const removeFavorites = async (org: string, userId: string, dashboardIds: string[]) => {
    if (!org || !userId || !dashboardIds.length) return;
    const ids = new Set(dashboardIds);
    const prev = favorites.value;
    const next = prev.filter((f) => !ids.has(f.dashboardId));
    if (next.length === prev.length) return; // none of them were favorited
    favorites.value = next;
    try {
      await settings.setUserSetting(org, userId, SETTING_KEY, favorites.value, SETTING_CATEGORY);
      setPersistedQueryData(settingKeys.one(org, SETTING_KEY, userId), favorites.value);
    } catch {
      // The cached copy is now behind the screen; drop it so the next load
      // reconciles from the server.
      queryClient.invalidateQueries({ queryKey: settingKeys.all(org) });
      // Best-effort cleanup that trails a successful delete — leave the local
      // list pruned so the row disappears now, and let the next load() reconcile
      // rather than resurrecting a row for a dashboard that is already gone.
    }
  };

  return {
    favorites,
    isLoading,
    isFavorite,
    load,
    toggleFavorite,
    removeFavorites,
  };
}
