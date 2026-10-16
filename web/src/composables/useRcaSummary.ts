// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { onScopeDispose, ref, watch, type Ref } from "vue";
import { isAxiosError } from "axios";
import incidentsService, { type RcaRunSummary } from "@/services/incidents";

/** How often the summary of a live run is re-read: the thread's cadence (03 §12, 02 TH32). */
export const RCA_SUMMARY_POLL_MS = 4_000;

/**
 * - `idle`: no run to read.
 * - `loading`: the first read of this run is in flight.
 * - `ready`: `summary` holds the latest view (`legacy: true` included, VE42).
 * - `expired`: 410, the transcript of a live run is gone.
 * - `unavailable`: the summary could not be read (503 or a network error); a live run keeps polling.
 * - `unsupported`: 403, the build or the user cannot read summaries.
 * - `missing`: 404, the run is not one of this incident's.
 */
export type RcaSummaryStatus =
  "idle" | "loading" | "ready" | "expired" | "unavailable" | "unsupported" | "missing";

/**
 * The summary view of one RCA run (03 §12): verdict card, timeline, hypotheses,
 * evidence and blind spots.
 *
 * The first read happens when the run id is set. While `live` is true the summary
 * is re-read every 4 s with `known_version`; a `not_modified` answer changes
 * nothing. When `live` turns false the poll stops after one final read (the
 * finalizer has written the record). A new run id starts over.
 */
export function useRcaSummary(
  orgRef: Ref<string>,
  incidentIdRef: Ref<string | null>,
  runIdRef: Ref<string | null>,
  liveRef: Ref<boolean>,
) {
  const summary = ref<RcaRunSummary | null>(null);
  const status = ref<RcaSummaryStatus>("idle");

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
      const response = await incidentsService.getRcaSummary(org, incidentId, runId, knownVersion);
      if (gen !== generation || seq < appliedSeq) return;
      appliedSeq = seq;
      const data = response.data;
      if (data.not_modified) {
        if (summary.value) status.value = "ready";
        return;
      }
      knownVersion = data.state_version;
      summary.value = data;
      status.value = "ready";
    } catch (error) {
      if (gen !== generation || seq < appliedSeq) return;
      appliedSeq = seq;
      const code = isAxiosError(error) ? error.response?.status : undefined;
      if (code === 410 || code === 403 || code === 404) {
        halted = true;
        clearTimer();
        summary.value = null;
        status.value = code === 410 ? "expired" : code === 403 ? "unsupported" : "missing";
        return;
      }
      console.error("Failed to load the RCA summary:", error);
      // The run ended but its final summary could not be read: a live-shaped view
      // would show a finished run as live, so drop it and let the panel fall back
      // to the report; `retry()` reads it again.
      const current = summary.value;
      if (
        !liveRef.value &&
        current &&
        (current.state === "running" || current.state === "waiting_input")
      ) {
        summary.value = null;
        knownVersion = undefined;
      }
      // Otherwise keep the last good summary; a live run retries on the next tick.
      if (!summary.value) status.value = "unavailable";
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
    }, RCA_SUMMARY_POLL_MS);
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
        summary.value = null;
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
        // The run reached a terminal state: one final read, then no more.
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

  /** Re-reads a summary whose read failed (`unavailable`); a live run retries on its own. */
  const retry = async () => {
    if (status.value !== "unavailable") return;
    status.value = "loading";
    await read();
  };

  return { summary, status, retry };
}

export default useRcaSummary;
