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

import { ref, watch, type Ref, type WatchSource } from "vue";

/** Epoch-ms of the moment `loading` last settled, for ORefreshButton's `lastRunAt` on views whose reads expose only a busy flag. */
export function useLoadedAt(loading: WatchSource<boolean>): Ref<number | null> {
  const loadedAt = ref<number | null>(null);
  watch(
    loading,
    (busy) => {
      if (!busy) loadedAt.value = Date.now();
    },
    { immediate: true },
  );
  return loadedAt;
}
