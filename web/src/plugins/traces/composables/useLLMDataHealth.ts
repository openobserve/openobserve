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
import { isAxiosError } from "axios";
import {
  getDataHealth,
  type DataHealthCheckId,
  type DataHealthParams,
  type DataHealthResponse,
} from "@/services/gen-ai-data-health.service";
import type { TimeWindow } from "../llmDataTrust.utils";

export type DataHealthSamples = Partial<Record<DataHealthCheckId, string[]>>;

/** What a response describes: org, scope and window, but not `refresh`. */
function scopeKey(orgId: string, p: DataHealthParams): string {
  return JSON.stringify([
    orgId,
    p.stream_name,
    p.agent,
    p.agent_id,
    p.env,
    p.version,
    p.start_time,
    p.end_time,
  ]);
}

/** Sample trace ids per check, as the server returned them. */
function samplesOf(res: DataHealthResponse): DataHealthSamples {
  return Object.fromEntries(res.checks.map((c) => [c.id, c.samples ?? []]));
}

/** Samples cost a query per failing check, so they load on demand unless a load sets `include_samples`. */
export function useLLMDataHealth() {
  const health = ref<DataHealthResponse | null>(null);
  /** The window `health` was checked over, so links can open the same window. */
  const checkedWindow = ref<TimeWindow | null>(null);
  const loading = ref(false);
  const error = ref(false);
  /** The last load failed with 404: the server predates the data health endpoint. */
  const unsupported = ref(false);
  /** Samples per check for the last fetched scope + window; null until requested. */
  const samples = ref<DataHealthSamples | null>(null);
  const samplesLoading = ref(false);
  let seq = 0;
  let samplesSeq = 0;
  let last: { orgId: string; params: DataHealthParams } | null = null;
  let lastKey = "";

  function clearSamples() {
    samplesSeq++;
    samples.value = null;
    samplesLoading.value = false;
  }

  async function fetchHealth(orgId: string, params: DataHealthParams): Promise<void> {
    if (!orgId || !params.stream_name || !params.start_time || !params.end_time) {
      reset();
      return;
    }
    const key = scopeKey(orgId, params);
    if (key !== lastKey) {
      // Another scope's answer must not show while this one loads.
      health.value = null;
      checkedWindow.value = null;
      lastKey = key;
    }
    const mine = ++seq;
    const withSamples = !!params.include_samples;
    last = { orgId, params: { ...params, include_samples: false } };
    clearSamples();
    loading.value = true;
    error.value = false;
    unsupported.value = false;
    try {
      const res = await getDataHealth(orgId, { ...last.params, include_samples: withSamples });
      if (mine !== seq) return;
      health.value = res.data;
      checkedWindow.value = { start: params.start_time, end: params.end_time };
      if (withSamples) samples.value = samplesOf(res.data);
    } catch (e) {
      if (mine !== seq) return;
      console.error("LLM data health fetch error:", e);
      health.value = null;
      checkedWindow.value = null;
      error.value = true;
      unsupported.value = isAxiosError(e) && e.response?.status === 404;
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
      samples.value = samplesOf(res.data);
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
    lastKey = "";
    clearSamples();
    health.value = null;
    checkedWindow.value = null;
    loading.value = false;
    error.value = false;
    unsupported.value = false;
  }

  return {
    health,
    checkedWindow,
    loading,
    error,
    unsupported,
    samples,
    samplesLoading,
    fetchHealth,
    fetchSamples,
    reset,
  };
}
