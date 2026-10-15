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

import { readonly, ref, type Ref } from "vue";
import { useStore, type Store } from "vuex";
import searchService from "@/services/search";
import { b64EncodeUnicode } from "@/utils/formatters";
import { assertJoinFree, type SampleRatio } from "@/utils/rum/productAnalyticsQueries";

export type PanelStatus = "idle" | "loading" | "aborted" | "ok" | "error" | "forbidden";
export interface PanelState<T> {
  status: PanelStatus;
  rows: T[];
  error: { status?: number; code?: number; message: string } | null;
  partial: string | null;
  key: string | null;
  sampled: SampleRatio;
}
export interface SearchSpec {
  sql: string;
  startUs: number;
  endUs: number;
  limit: number;
  sampled: SampleRatio;
}
interface SearchError {
  code?: string;
  name?: string;
  message?: string;
  response?: {
    status?: number;
    data?: { code?: number; message?: string; error?: string; error_detail?: string };
  };
}
interface SearchResponse {
  data?: { hits?: unknown[]; is_partial?: boolean; function_error?: string };
}
interface Entry {
  spec: SearchSpec;
  org: string;
  key: string;
  token: number;
  controller: AbortController | null;
}

// Four matches the server's per-user work-group slots, the same cap the error-issue trends use.
const DEFAULT_CONCURRENCY = 4;

const emptyPanel = <T>(): PanelState<T> => ({
  status: "idle",
  rows: [],
  error: null,
  partial: null,
  key: null,
  sampled: 1,
});

const isAbort = (e: SearchError): boolean =>
  e?.code === "ERR_CANCELED" || e?.name === "CanceledError" || e?.name === "AbortError";

const guardEnabled = (): boolean => import.meta.env.DEV || import.meta.env.MODE === "test";

export interface AnalyticsStoreState {
  selectedOrganization?: { identifier?: string };
  zoConfig?: { sql_base64_enabled?: boolean };
}
type AppStore = Store<AnalyticsStoreState>;

export default function useAnalyticsSearch(
  maxConcurrent: number = DEFAULT_CONCURRENCY,
  storeGetter?: () => AppStore | undefined,
) {
  const own = storeGetter ? undefined : useStore<AnalyticsStoreState>();
  const appStore = (): AppStore => (storeGetter?.() ?? own) as AppStore;
  const panels = new Map<string, Ref<PanelState<unknown>>>();
  const entries = new Map<string, Entry>();
  const queue: (() => void)[] = [];
  const active = ref(0);
  let tokens = 0;

  const panel = <T>(id: string): Ref<PanelState<T>> => {
    if (!panels.has(id)) panels.set(id, ref(emptyPanel<unknown>()) as Ref<PanelState<unknown>>);
    return panels.get(id) as Ref<PanelState<T>>;
  };

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active.value < maxConcurrent) {
        active.value++;
        resolve();
      } else {
        queue.push(() => {
          active.value++;
          resolve();
        });
      }
    });

  const release = () => {
    active.value--;
    queue.shift()?.();
  };

  const buildBody = (spec: SearchSpec) => {
    const req: { query: Record<string, unknown>; encoding?: string } = {
      query: {
        sql: spec.sql,
        start_time: spec.startUs,
        end_time: spec.endUs,
        from: 0,
        size: spec.limit,
      },
    };
    if (appStore()?.state.zoConfig?.sql_base64_enabled) {
      req.encoding = "base64";
      req.query.sql = b64EncodeUnicode(spec.sql);
    }
    return req;
  };

  const settle = <T>(id: string, token: number, patch: Partial<PanelState<T>>): PanelState<T> => {
    const p = panel<T>(id);
    if (entries.get(id)?.token === token) p.value = { ...p.value, ...patch };
    return p.value;
  };

  const execute = async <T>(id: string, entry: Entry): Promise<PanelState<T>> => {
    await acquire();
    if (entries.get(id)?.token !== entry.token || entry.controller?.signal.aborted) {
      release();
      return panel<T>(id).value;
    }
    try {
      const res = (await searchService.search(
        {
          org_identifier: entry.org,
          query: buildBody(entry.spec),
          page_type: "logs",
          signal: entry.controller?.signal,
        },
        "RUM",
      )) as SearchResponse;
      const data = res?.data ?? {};
      const partial = data.function_error || (data.is_partial ? "partial" : null);
      return settle<T>(id, entry.token, {
        status: "ok",
        rows: (data.hits ?? []) as T[],
        error: null,
        partial: partial || null,
      });
    } catch (err) {
      const e = err as SearchError;
      if (isAbort(e) || entry.controller?.signal.aborted) {
        return settle<T>(id, entry.token, { status: "aborted" });
      }
      const status = e.response?.status;
      const code = e.response?.data?.code;
      const message = e.response?.data?.message || e.response?.data?.error || e.message || "";
      return settle<T>(id, entry.token, {
        status: status === 403 ? "forbidden" : "error",
        error: { status, ...(typeof code === "number" ? { code } : {}), message },
      });
    } finally {
      release();
    }
  };

  const run = async <T>(id: string, spec: SearchSpec, key: string): Promise<PanelState<T>> => {
    if (guardEnabled()) assertJoinFree(spec.sql);
    entries.get(id)?.controller?.abort();
    // Bound at enqueue: a search queued behind the cap must not run against an org switched to meanwhile.
    const org = appStore()?.state.selectedOrganization?.identifier ?? "";
    const entry: Entry = { spec, org, key, token: ++tokens, controller: new AbortController() };
    entries.set(id, entry);
    const p = panel<T>(id);
    p.value = {
      ...p.value,
      status: "loading",
      error: null,
      partial: null,
      key,
      sampled: spec.sampled,
    };
    return execute<T>(id, entry);
  };

  const retry = async (id: string): Promise<void> => {
    const entry = entries.get(id);
    if (entry) await run(id, entry.spec, entry.key);
  };

  const abortAll = () => {
    for (const [id, entry] of entries) {
      const p = panel(id);
      if (p.value.status !== "loading") continue;
      entry.controller?.abort();
      p.value = { ...p.value, status: "aborted" };
    }
  };

  // Dropping the entry is what stops a run already in flight from settling onto the held panel.
  const hold = (id: string, status: "idle" | "loading") => {
    entries.get(id)?.controller?.abort();
    entries.delete(id);
    panel(id).value = { ...emptyPanel(), status };
  };

  const rerunAborted = async (): Promise<void> => {
    const ids = [...entries.keys()].filter((id) => panel(id).value.status === "aborted");
    await Promise.all(ids.map((id) => retry(id)));
  };

  return { panel, run, retry, hold, abortAll, rerunAborted, active: readonly(active) };
}
