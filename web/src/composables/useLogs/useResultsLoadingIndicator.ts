//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import {
  computed,
  onScopeDispose,
  readonly,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
  type WatchSource,
} from "vue";
import { getUnitValue } from "@/utils/dashboard/convertDataIntoUnitValue";

export const RESULTS_LOADER_DELAY_MS = 300;
// Search responses carry scan_size in MiB (format_to_mb on the server); partition totals (original_size) are raw bytes.
export const MIB_IN_BYTES = 1024 * 1024;

interface ResultsLoadingState {
  loading: boolean;
  data: { queryResults?: { scan_size?: number } | null };
}

/** Converts a search response scan_size (MiB) to bytes; anything non-positive or non-numeric is 0. */
export const scanSizeMibToBytes = (mib: unknown): number => {
  const value = Number(mib);
  return Number.isFinite(value) && value > 0 ? value * MIB_IN_BYTES : 0;
};

/** Formats a MiB scan_size with the shared byte formatter, or null when nothing was scanned. */
export const formatScannedSize = (mib: unknown): string | null => {
  const bytes = scanSizeMibToBytes(mib);
  if (bytes === 0) return null;
  const { value, unit } = getUnitValue(bytes, "bytes", "");
  return `${value} ${unit}`;
};

/** Follows `source`, but turns on only after it has stayed true for `delayMs`; it turns off at once. */
export function useDelayedFlag(
  source: WatchSource<boolean>,
  delayMs = RESULTS_LOADER_DELAY_MS,
): Readonly<Ref<boolean>> {
  const shown = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    source,
    (on) => {
      clearTimeout(timer);
      if (!on) {
        shown.value = false;
        return;
      }
      timer = setTimeout(() => {
        shown.value = true;
      }, delayMs);
    },
    { immediate: true },
  );
  onScopeDispose(() => clearTimeout(timer));
  return readonly(shown);
}

/** The delayed results loader for `busy`, plus the size scanned so far by a fresh run (null while paging). */
export function useResultsLoadingIndicator(
  searchObj: ResultsLoadingState,
  busy: WatchSource<boolean> = () => !!searchObj.loading,
): {
  showLoader: Readonly<Ref<boolean>>;
  scannedSize: ComputedRef<string | null>;
} {
  const showLoader = useDelayedFlag(busy);
  const runStartResults = shallowRef<unknown>(undefined);
  watch(
    () => searchObj.loading,
    (on) => {
      if (on) runStartResults.value = searchObj.data.queryResults;
    },
    { immediate: true },
  );
  // A fresh run replaces queryResults while paging mutates it in place, so an unchanged object still holds the last run's size.
  const scannedSize = computed(() => {
    if (!showLoader.value) return null;
    const results = searchObj.data.queryResults;
    if (!results || results === runStartResults.value) return null;
    return formatScannedSize(results.scan_size);
  });
  return { showLoader, scannedSize };
}
