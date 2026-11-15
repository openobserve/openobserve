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

import { onScopeDispose, reactive, watch } from "vue";
import { useRouter, type LocationQuery, type LocationQueryValue, type Router } from "vue-router";
import store from "@/stores";

export interface ListViewSort {
  sortBy: string;
  sortOrder: "asc" | "desc";
}

/** State field → URL parameter, written as `v.<param>` so it never collides with a page's own query. */
export type ListViewUrlParams<T> = Partial<Record<keyof T & string, string>>;

type QueryValue = LocationQueryValue | LocationQueryValue[] | undefined;

/** The URL names of the fields most lists keep, so a link reads the same on every list. */
export const LIST_URL_PARAMS = {
  filterQuery: "q",
  currentPage: "page",
  pageSize: "size",
  sortBy: "sort",
  sortOrder: "order",
} as const;

const URL_PREFIX = "v.";
// Coalesces a burst of field changes into one replace, after any replace the page itself started.
const URL_SYNC_DELAY = 100;

const views = reactive<Record<string, Record<string, unknown>>>({});

const viewKey = (key: string) => `${store.state.selectedOrganization?.identifier ?? ""}:${key}`;

// Module-level on purpose: list pages are destroyed on navigation, so the state must outlive the component; every caller shares one object.
/** With `url`, the listed fields also live in the URL: a link or a refresh restores them, and the URL follows every change. */
export function useListViewState<T extends Record<string, unknown>>(
  key: string,
  defaults: T,
  options: { url?: ListViewUrlParams<T> } = {},
): T {
  const k = viewKey(key);
  if (!views[k]) views[k] = {};
  const existing = views[k];
  for (const field of Object.keys(defaults)) {
    if (!(field in existing)) existing[field] = defaults[field];
  }
  const state = existing as T;
  if (options.url) syncWithUrl(state, defaults, options.url);
  return state;
}

export function resetListViewState(key?: string): void {
  if (key) {
    delete views[viewKey(key)];
    return;
  }
  Object.keys(views).forEach((k) => delete views[k]);
}

// A param missing from the URL keeps the remembered value, so a rail click back to the list still shows it;
// Back and Forward restore an entry exactly, so after them a missing param means the default.
function syncWithUrl<T extends Record<string, unknown>>(
  state: T,
  defaults: T,
  params: ListViewUrlParams<T>,
): void {
  const router: Router | undefined = useRouter();
  if (!router?.currentRoute) return;
  const route = router.currentRoute;
  const ownRoute = route.value.name;
  if (!ownRoute) return;
  const fields = (Object.entries(params) as [keyof T & string, string][]).filter(
    ([field]) => field in defaults,
  );

  const readUrl = (query: LocationQuery, missingIsDefault = false) => {
    for (const [field, param] of fields) {
      const raw = query[URL_PREFIX + param];
      const fallback = defaults[field];
      const value =
        raw === undefined && missingIsDefault
          ? Array.isArray(fallback)
            ? [...fallback]
            : fallback
          : parseParam(raw, fallback);
      if (value !== undefined && JSON.stringify(value) !== JSON.stringify(state[field])) {
        (state as Record<string, unknown>)[field] = value;
      }
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const writeUrl = () => {
    timer = undefined;
    if (route.value.name !== ownRoute) return;
    const query: LocationQuery = { ...route.value.query };
    for (const [field, param] of fields) {
      const value = serializeParam(state[field], defaults[field]);
      if (value === undefined) delete query[URL_PREFIX + param];
      else query[URL_PREFIX + param] = value;
    }
    if (sameQuery(query, route.value.query)) return;
    Promise.resolve(router.replace({ query })).catch(() => {});
  };
  const scheduleWrite = () => {
    clearTimeout(timer);
    timer = setTimeout(writeUrl, URL_SYNC_DELAY);
  };

  // The history listener runs in the same tick as the router's own, before that navigation ends;
  // afterEach then hands the answer to the query watcher below.
  let popped = false;
  let restoring = false;
  const removeHistoryListener = router.options?.history?.listen?.(() => (popped = true));
  const removeAfterEach = router.afterEach?.(() => {
    restoring = popped;
    popped = false;
  });

  readUrl(route.value.query);
  scheduleWrite();
  watch(() => fields.map(([field]) => state[field]), scheduleWrite, { deep: true });
  watch(
    () => route.value.query,
    (query) => {
      if (route.value.name !== ownRoute) return;
      readUrl(query, restoring);
      scheduleWrite();
    },
  );
  onScopeDispose(() => {
    clearTimeout(timer);
    removeHistoryListener?.();
    removeAfterEach?.();
  });
}

function parseParam(raw: QueryValue, fallback: unknown): unknown {
  const values = (Array.isArray(raw) ? raw : [raw]).filter(
    (v): v is string => typeof v === "string",
  );
  if (Array.isArray(fallback)) return raw === undefined ? undefined : values;
  const value = values[0];
  if (value === undefined) return undefined;
  if (typeof fallback === "boolean") return value === "true";
  if (typeof fallback !== "number") return value;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function serializeParam(value: unknown, fallback: unknown): string | string[] | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (JSON.stringify(value) === JSON.stringify(fallback)) return undefined;
  return Array.isArray(value) ? value.map(String) : String(value);
}

// vue-router reads a one-item array back as a plain string, so both spellings are one value.
function sameQuery(a: LocationQuery, b: LocationQuery): boolean {
  const canonical = (v: QueryValue) =>
    JSON.stringify(Array.isArray(v) && v.length === 1 ? v[0] : v);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => canonical(a[key]) === canonical(b[key]));
}
