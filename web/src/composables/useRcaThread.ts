// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { onScopeDispose, ref, watch, type Ref } from "vue";
import { isAxiosError } from "axios";
import incidentsService, { type RcaThread } from "@/services/incidents";

/** How often the thread of a live run is re-read (02 TH32; the chat panel's `RUNNING_TURN_POLL_MS`). */
export const RCA_THREAD_POLL_MS = 4_000;

/**
 * - `idle`: no run to read.
 * - `loading`: the first read of this run is in flight.
 * - `ready`: `thread` holds the latest projection.
 * - `expired`: 410 `transcript_expired`, the transcript of this run is no longer stored.
 * - `incomplete`: 410 `transcript_incomplete`, the stored transcript of a finished run has a gap.
 * - `unavailable`: the thread could not be read (503 or a network error); a live run keeps polling.
 * - `unsupported`: 403, the build or the user cannot read threads.
 * - `missing`: 404, the run is not one of this incident's.
 */
export type RcaThreadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "expired"
  | "incomplete"
  | "unavailable"
  | "unsupported"
  | "missing";

/** `error_code` of an error body, if the server sent one. */
const errorCode = (error: unknown): string | null => {
  const body: unknown = isAxiosError(error) ? error.response?.data : null;
  return body &&
    typeof body === "object" &&
    "error_code" in body &&
    typeof body.error_code === "string"
    ? body.error_code
    : null;
};

/**
 * The investigation thread of one RCA run (02 TH32).
 *
 * The first read happens when the run id is set. While `live` is true the thread
 * is re-read every 4 s with `known_version`; a `not_modified` answer changes
 * nothing. When `live` turns false the poll stops after one final read. A new
 * run id (the live run, or a run the user picked) starts over.
 */
export function useRcaThread(
  orgRef: Ref<string>,
  incidentIdRef: Ref<string | null>,
  runIdRef: Ref<string | null>,
  liveRef: Ref<boolean>,
) {
  const thread = ref<RcaThread | null>(null);
  const status = ref<RcaThreadStatus>("idle");

  let knownVersion: string | undefined;
  // Bumped when the run changes or the owner unmounts: older answers are dropped.
  let generation = 0;
  // Each read takes the next number; an answer older than the last applied one is dropped.
  let readSeq = 0;
  let appliedSeq = 0;
  // A 404/403/410 ends the reads of this run.
  let halted = false;
  let timer: number | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const read = async () => {
    const org = orgRef.value;
    const incidentId = incidentIdRef.value;
    const runId = runIdRef.value;
    if (!incidentId || !runId || halted) return;
    const gen = generation;
    const seq = ++readSeq;
    try {
      const response = await incidentsService.getRcaThread(org, incidentId, runId, knownVersion);
      if (gen !== generation || seq < appliedSeq) return;
      appliedSeq = seq;
      const data = response.data;
      if (data.not_modified) {
        if (thread.value) status.value = "ready";
        return;
      }
      knownVersion = data.state_version;
      thread.value = data;
      status.value = "ready";
    } catch (error) {
      if (gen !== generation || seq < appliedSeq) return;
      appliedSeq = seq;
      const code = isAxiosError(error) ? error.response?.status : undefined;
      if (code === 410 || code === 403 || code === 404) {
        halted = true;
        clearTimer();
        thread.value = null;
        status.value =
          code === 410
            ? errorCode(error) === "transcript_incomplete"
              ? "incomplete"
              : "expired"
            : code === 403
              ? "unsupported"
              : "missing";
        return;
      }
      console.error("Failed to load the RCA thread:", error);
      // Keep the last good thread; a live run retries on the next tick.
      if (!thread.value) status.value = "unavailable";
    }
  };

  const schedule = () => {
    clearTimer();
    if (!liveRef.value || halted) return;
    const gen = generation;
    timer = window.setTimeout(async () => {
      timer = null;
      await read();
      if (gen === generation) schedule();
    }, RCA_THREAD_POLL_MS);
  };

  watch(
    [orgRef, incidentIdRef, runIdRef, liveRef] as const,
    ([org, incidentId, runId, live], previous) => {
      const sameRun =
        previous !== undefined &&
        previous[0] === org &&
        previous[1] === incidentId &&
        previous[2] === runId;

      if (!sameRun) {
        generation++;
        clearTimer();
        knownVersion = undefined;
        halted = false;
        appliedSeq = readSeq;
        thread.value = null;
        status.value = incidentId && runId ? "loading" : "idle";
        if (!incidentId || !runId) return;
        const gen = generation;
        void read().then(() => {
          if (gen === generation) schedule();
        });
        return;
      }

      if (live === previous[3]) return;
      if (live) {
        schedule();
      } else {
        // The run reached a terminal state: one final read, then no more (TH32).
        clearTimer();
        void read();
      }
    },
    { immediate: true },
  );

  onScopeDispose(() => {
    generation++;
    clearTimer();
  });

  /** Re-reads a thread whose read failed (`unavailable`); a live run retries on its own. */
  const retry = async () => {
    if (status.value !== "unavailable") return;
    status.value = "loading";
    await read();
  };

  return { thread, status, retry };
}

export default useRcaThread;
