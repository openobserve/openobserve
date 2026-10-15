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

import { onBeforeUnmount, ref, shallowRef } from "vue";
import alertCalibration, {
  errorMessage,
  isAbort,
  type DigestSearchRange,
} from "@/services/alert_calibration";
import { useOrgId } from "@/composables/query";
import { isNotYetWritten, SEARCH_SIZE } from "./digests";

/** Digests are log searches, which are never cached, so each view reads them directly and aborts on leave. */
export function useDigestSearch() {
  const orgId = useOrgId();
  const controllers = new Set<AbortController>();

  onBeforeUnmount(() => {
    controllers.forEach((c) => c.abort());
    controllers.clear();
  });

  async function search<T>(sql: string, range: DigestSearchRange): Promise<T[]> {
    const controller = new AbortController();
    controllers.add(controller);
    try {
      return await alertCalibration.searchDigests<T>(
        orgId.value,
        sql,
        range,
        SEARCH_SIZE,
        controller.signal,
      );
    } catch (error) {
      if (isNotYetWritten(error)) return [];
      throw error;
    } finally {
      controllers.delete(controller);
    }
  }

  return { search, orgId };
}

/** One read at a time per view: a newer request supersedes the one in flight. */
export function useLatestRead<T>(read: () => Promise<T>) {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  let generation = 0;

  async function load() {
    const mine = ++generation;
    loading.value = true;
    error.value = null;
    try {
      const result = await read();
      if (mine === generation) data.value = result;
    } catch (e) {
      if (mine !== generation || isAbort(e)) return;
      error.value = errorMessage(e) || String(e);
    } finally {
      if (mine === generation) loading.value = false;
    }
  }

  return { data, loading, error, load };
}
