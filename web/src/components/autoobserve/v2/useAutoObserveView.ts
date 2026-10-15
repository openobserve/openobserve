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
import { useRoute, useRouter } from "vue-router";

export type AutoObserveView = "standard" | "nerd";

const STORAGE_KEY = "autoobserve.view";

const isView = (value: unknown): value is AutoObserveView =>
  value === "standard" || value === "nerd";

const readStored = (): AutoObserveView | null => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isView(value) ? value : null;
  } catch {
    return null;
  }
};

export interface SetViewOptions {
  push?: boolean;
  remember?: boolean;
  query?: Record<string, string | undefined>;
}

// Shared across the wrapper and every switch, so a choice made with no URL change still re-renders.
const remembered = ref<AutoObserveView | null>(readStored());

export const useAutoObserveView = () => {
  const route = useRoute();
  const router = useRouter();

  // The URL wins over the remembered choice so a shared link opens the view it names.
  const view = computed<AutoObserveView>(() => {
    const fromUrl = route.query.view;
    if (isView(fromUrl)) return fromUrl;
    return remembered.value ?? "standard";
  });

  // The view flips only after the URL settles, so the view that mounts already sees its query.
  // Deep links push without remembering, so browser Back returns to Standard and later visits stay there.
  const setView = async (next: AutoObserveView, options: SetViewOptions = {}) => {
    const remember = options.remember ?? true;
    if (remember) {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Blocked storage: the URL still carries the choice.
      }
    }
    const target = {
      query: {
        ...route.query,
        view: next === "nerd" ? next : undefined,
        tab: undefined,
        issue: undefined,
        drawer: undefined,
        problem: undefined,
        filter: undefined,
        all: undefined,
        page: undefined,
        focus: undefined,
        change: undefined,
        ...options.query,
      },
    };
    await (options.push ? router.push(target) : router.replace(target));
    if (remember) remembered.value = next;
  };

  return { view, setView };
};
