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

import { ref } from "vue";
import { useStore } from "vuex";
import savedviewsService from "@/services/saved_views";

interface SavedView {
  view_id: string;
  view_name: string;
  view_data?: any;
  [key: string]: any;
}

interface SavedViewInput {
  view_name: string;
  view_data?: any;
  [key: string]: any;
}

const FAVORITES_KEY = "savedViews";
const MAX_FAVORITES = 10;

// Singleton cache shared across all component instances
let cachedViews: SavedView[] | null = null;
let fetchPromise: Promise<void> | null = null;

const useSavedViews = () => {
  const store = useStore();

  const savedViews = ref<SavedView[]>(cachedViews ?? []);
  const loading = ref(false);

  const getOrgId = (): string => store.state.selectedOrganization.identifier;

  const loadFavorites = (): string[] => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const saveFavorites = (ids: string[]): void => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  };

  const favoriteViews = ref<string[]>(loadFavorites());

  /** Fetches all saved views with in-flight deduplication. */
  const fetchAll = async (): Promise<void> => {
    const orgId = getOrgId();

    if (fetchPromise) return fetchPromise;

    loading.value = true;
    fetchPromise = savedviewsService
      .get(orgId)
      .then((res: any) => {
        cachedViews = res.data.views ?? [];
        savedViews.value = cachedViews;
      })
      .catch((err: any) => {
        console.error("[useSavedViews] fetch error:", err);
      })
      .finally(() => {
        loading.value = false;
        fetchPromise = null;
      });

    return fetchPromise;
  };

  /** Invalidates cache so next fetchAll will re-fetch. */
  const invalidateCache = (): void => {
    cachedViews = null;
  };

  const getById = async (id: string): Promise<SavedView> => {
    const orgId = getOrgId();
    const res = await savedviewsService.getViewDetail(orgId, id);
    return res.data;
  };

  const create = async (view: SavedViewInput): Promise<void> => {
    const orgId = getOrgId();
    await savedviewsService.post(orgId, view);
    invalidateCache();
    await fetchAll();
  };

  const update = async (
    id: string,
    view: SavedViewInput,
  ): Promise<void> => {
    const orgId = getOrgId();
    await savedviewsService.put(orgId, id, view);
    invalidateCache();
    await fetchAll();
  };

  const remove = async (id: string): Promise<void> => {
    const orgId = getOrgId();
    await savedviewsService.delete(orgId, id);
    // Remove from favorites if present
    const faves = loadFavorites().filter((fid) => fid !== id);
    saveFavorites(faves);
    favoriteViews.value = faves;
    invalidateCache();
    await fetchAll();
  };

  const toggleFavorite = (id: string): void => {
    const current = loadFavorites();
    const idx = current.indexOf(id);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      if (current.length >= MAX_FAVORITES) {
        current.shift();
      }
      current.push(id);
    }
    saveFavorites(current);
    favoriteViews.value = current;
  };

  const isFavorite = (id: string): boolean =>
    favoriteViews.value.includes(id);

  const search = (term: string): SavedView[] => {
    if (!term) return savedViews.value;
    const lower = term.toLowerCase();
    return savedViews.value.filter(
      (v) =>
        v.view_name?.toLowerCase().includes(lower) ??
        false,
    );
  };

  return {
    savedViews,
    favoriteViews,
    loading,
    fetchAll,
    getById,
    create,
    update,
    remove,
    toggleFavorite,
    isFavorite,
    search,
    invalidateCache,
  };
};

export default useSavedViews;
