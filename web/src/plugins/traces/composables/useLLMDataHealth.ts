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
import {
  getDataHealth,
  type DataHealthParams,
  type DataHealthResponse,
} from "@/services/gen-ai-data-health.service";

/**
 * AI data health for LLM Insights: one request per scope + window, shared by
 * the health strip and the Total Cost tile (which reads the unpriced check).
 * A response that lands after a newer request started is dropped.
 */
export function useLLMDataHealth() {
  const health = ref<DataHealthResponse | null>(null);
  const loading = ref(false);
  const error = ref(false);
  let seq = 0;

  async function fetchHealth(orgId: string, params: DataHealthParams): Promise<void> {
    if (!orgId || !params.stream_name || !params.start_time || !params.end_time) return;
    const mine = ++seq;
    loading.value = true;
    error.value = false;
    try {
      const res = await getDataHealth(orgId, params);
      if (mine !== seq) return;
      health.value = res.data;
    } catch (e) {
      if (mine !== seq) return;
      console.error("LLM data health fetch error:", e);
      health.value = null;
      error.value = true;
    } finally {
      if (mine === seq) loading.value = false;
    }
  }

  function reset() {
    seq++;
    health.value = null;
    loading.value = false;
    error.value = false;
  }

  return { health, loading, error, fetchHealth, reset };
}
