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
  type DataHealthCheckId,
  type DataHealthParams,
  type DataHealthResponse,
} from "@/services/gen-ai-data-health.service";

export type DataHealthSamples = Partial<Record<DataHealthCheckId, string[]>>;

/**
 * AI data health for LLM Insights: one request per scope + window, shared by
 * the health strip and the Total Cost tile (which reads the unpriced check).
 * Sample trace ids cost a window-wide query per failing check, so they are
 * fetched only on demand (the Review checks drawer) for the last scope + window.
 * A response that lands after a newer request started is dropped.
 */
export function useLLMDataHealth() {
  const health = ref<DataHealthResponse | null>(null);
  const loading = ref(false);
  const error = ref(false);
  /** Samples per check for the last fetched scope + window; null until requested. */
  const samples = ref<DataHealthSamples | null>(null);
  const samplesLoading = ref(false);
  let seq = 0;
  let samplesSeq = 0;
  let last: { orgId: string; params: DataHealthParams } | null = null;

  function clearSamples() {
    samplesSeq++;
    samples.value = null;
    samplesLoading.value = false;
  }

  async function fetchHealth(orgId: string, params: DataHealthParams): Promise<void> {
    if (!orgId || !params.stream_name || !params.start_time || !params.end_time) return;
    const mine = ++seq;
    last = { orgId, params: { ...params, include_samples: false } };
    clearSamples();
    loading.value = true;
    error.value = false;
    try {
      const res = await getDataHealth(orgId, last.params);
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

  /** Sample trace ids for the last scope + window; a no-op once loaded or loading. */
  async function fetchSamples(): Promise<void> {
    if (!last || samples.value !== null || samplesLoading.value) return;
    const { orgId, params } = last;
    const mine = ++samplesSeq;
    samplesLoading.value = true;
    try {
      const res = await getDataHealth(orgId, { ...params, include_samples: true });
      if (mine !== samplesSeq) return;
      samples.value = Object.fromEntries(res.data.checks.map((c) => [c.id, c.samples ?? []]));
    } catch (e) {
      if (mine !== samplesSeq) return;
      console.error("LLM data health samples fetch error:", e);
      samples.value = {};
    } finally {
      if (mine === samplesSeq) samplesLoading.value = false;
    }
  }

  function reset() {
    seq++;
    last = null;
    clearSamples();
    health.value = null;
    loading.value = false;
    error.value = false;
  }

  return { health, loading, error, samples, samplesLoading, fetchHealth, fetchSamples, reset };
}
