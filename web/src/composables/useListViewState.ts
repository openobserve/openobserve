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

import { reactive } from "vue";
import store from "@/stores";

export interface ListViewSort {
  sortBy: string;
  sortOrder: "asc" | "desc";
}

const views = reactive<Record<string, Record<string, unknown>>>({});

const viewKey = (key: string) => `${store.state.selectedOrganization?.identifier ?? ""}:${key}`;

// Module-level on purpose: list pages are destroyed on navigation, so the state must outlive the component; every caller shares one object.
export function useListViewState<T extends Record<string, unknown>>(key: string, defaults: T): T {
  const k = viewKey(key);
  if (!views[k]) views[k] = {};
  const existing = views[k];
  for (const field of Object.keys(defaults)) {
    if (!(field in existing)) existing[field] = defaults[field];
  }
  return existing as T;
}

export function resetListViewState(key?: string): void {
  if (key) {
    delete views[viewKey(key)];
    return;
  }
  Object.keys(views).forEach((k) => delete views[k]);
}
