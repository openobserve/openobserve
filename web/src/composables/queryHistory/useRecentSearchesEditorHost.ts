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

import { computed, provide, ref, type ComputedRef, type InjectionKey, type Ref } from "vue";
import type { HistorySource } from "@/services/query_history";
import {
  recentQueryList,
  recentsOpenAfterEdit,
  routeEditorKeyToRecents,
  type RecentsKeyTarget,
} from "@/utils/queryHistory/recentSearches";
import { useRecentSearches, useRecentSearchesList } from "./useRecentSearches";

/** What a nested query editor reports to the page that owns the recent searches. */
export interface RecentSearchesEditorHost {
  /** Recent queries the editor offers as clock rows. */
  queries: ComputedRef<string[]>;
  onFocus: (anchor: HTMLElement | null) => void;
  /** Whether the editor text is blank after the edit and was blank before it. */
  onEdit: (isBlank: boolean, wasBlank: boolean) => void;
  /** Bound in the capture phase: the editor's Escape binding stops the event, and that binding must still run. */
  onKeydown: (event: KeyboardEvent) => void;
}

export const RECENT_SEARCHES_EDITOR_HOST: InjectionKey<RecentSearchesEditorHost> = Symbol(
  "recentSearchesEditorHost",
);

/** Provides recents to an editor several components down (Metrics' PanelEditor) and drives its focus dropdown. */
export const useRecentSearchesEditorHost = (
  source: HistorySource,
  options: {
    /** True when focusing should open the dropdown, e.g. every visible query is empty. */
    opensOnFocus: () => boolean;
    /** Keeps only the queries one editor can take, e.g. no multi-query rows. */
    acceptsQuery?: (query: string) => boolean;
    /** Whether the editor counts as empty when its text is blank or not; defaults to the text alone. */
    emptyWith?: (isBlank: boolean) => boolean;
  },
) => {
  const { enabled } = useRecentSearches();
  const open = ref(false);
  const anchor = ref<HTMLElement | null>(null);
  const dropdownRef: Ref<RecentsKeyTarget | null> = ref(null);
  const listActive = ref(false);
  const list = useRecentSearchesList(source, listActive);
  const accepts = options.acceptsQuery ?? (() => true);
  const emptyWith = options.emptyWith ?? ((isBlank: boolean) => isBlank);

  const queries = computed(() =>
    enabled.value ? recentQueryList(list.data.value ?? []).filter(accepts) : [],
  );

  const host: RecentSearchesEditorHost = {
    queries,
    onFocus: (box) => {
      if (!enabled.value) return;
      anchor.value = box;
      listActive.value = true;
      if (options.opensOnFocus()) open.value = true;
    },
    onEdit: (isBlank, wasBlank) => {
      const isEmpty = enabled.value && emptyWith(isBlank);
      open.value = recentsOpenAfterEdit(open.value, emptyWith(wasBlank), isEmpty);
    },
    onKeydown: (event) => {
      if (!open.value) return;
      routeEditorKeyToRecents(event, dropdownRef.value, () => (open.value = false));
    },
  };
  provide(RECENT_SEARCHES_EDITOR_HOST, host);

  return { open, anchor, dropdownRef, queries };
};
