// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { isAxiosError } from "axios";

export type RcaReadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "expired"
  | "incomplete"
  | "unavailable"
  | "unsupported"
  | "missing";

type Unchanged = { not_modified: true; state_version: string };
const changed = <T extends object>(value: T | Unchanged): value is T =>
  !("not_modified" in value && value.not_modified === true);
export function useRcaPolling<T extends object>(
  org: Ref<string>,
  incidentId: Ref<string | null>,
  runId: Ref<string | null>,
  live: Ref<boolean>,
  options: {
    interval: number;
    fetch: (
      org: string,
      incident: string,
      run: string,
      version?: string,
    ) => Promise<{ data: T | Unchanged }>;
    version?: (data: T) => string;
    expired?: (error: unknown) => "expired" | "incomplete";
    clearOnTerminalError?: (data: T) => boolean;
  },
) {
  const data = shallowRef<T | null>(null);
  const status = ref<RcaReadStatus>("idle");
  let version: string | undefined;
  let generation = 0;
  let sequence = 0;
  let applied = 0;
  let halted = false;
  let timer: number | undefined;
  const clear = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const read = async () => {
    if (!incidentId.value || !runId.value || halted) return;
    const gen = generation;
    const seq = ++sequence;
    try {
      const response = await options.fetch(org.value, incidentId.value, runId.value, version);
      if (gen !== generation || seq < applied) return;
      applied = seq;
      if (changed(response.data)) {
        version = options.version?.(response.data);
        data.value = response.data;
      }
      if (data.value) status.value = "ready";
    } catch (error) {
      if (gen !== generation || seq < applied) return;
      applied = seq;
      const code = isAxiosError(error) ? error.response?.status : undefined;
      if (code === 403 || code === 404 || (code === 410 && options.expired)) {
        halted = true;
        clear();
        data.value = null;
        status.value =
          code === 403 ? "unsupported" : code === 404 ? "missing" : options.expired!(error);
        return;
      }
      if (!live.value && data.value && options.clearOnTerminalError?.(data.value)) {
        data.value = null;
        version = undefined;
      }
      if (!data.value) status.value = "unavailable";
    }
  };
  const schedule = () => {
    clear();
    if (!live.value || halted || !incidentId.value || !runId.value) return;
    const gen = generation;
    timer = window.setTimeout(async () => {
      timer = undefined;
      await read();
      if (gen === generation) schedule();
    }, options.interval);
  };
  const refresh = async () => {
    const gen = generation;
    clear();
    await read();
    if (gen === generation) schedule();
  };
  watch(
    [org, incidentId, runId, live] as const,
    (current, previous) => {
      const sameRun = previous && current.slice(0, 3).every((value, i) => value === previous[i]);
      if (!sameRun) {
        generation++;
        clear();
        version = undefined;
        halted = false;
        applied = sequence;
        data.value = null;
        status.value = incidentId.value && runId.value ? "loading" : "idle";
        void refresh();
      } else if (current[3] !== previous[3]) {
        if (live.value) schedule();
        else {
          clear();
          void read();
        }
      }
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    generation++;
    clear();
    halted = true;
  });
  const retry = async () => {
    if (status.value !== "unavailable") return;
    status.value = "loading";
    await refresh();
  };
  return { data, status, refresh, retry };
}
