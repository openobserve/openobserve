// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { type Ref } from "vue";
import incidentsService, { type RcaRunSummary } from "@/services/incidents";
import { useRcaPolling, type RcaReadStatus } from "@/composables/useRcaPolling";

/** How often the summary of a live run is re-read: the thread's cadence (03 §12, 02 TH32). */
export const RCA_SUMMARY_POLL_MS = 4_000;

/** Terminal read failures stop polling; transient failures can be retried. */
export type RcaSummaryStatus = RcaReadStatus;

/** Versioned verdict/evidence reads share the thread's polling lifecycle. */
export function useRcaSummary(
  orgRef: Ref<string>,
  incidentIdRef: Ref<string | null>,
  runIdRef: Ref<string | null>,
  liveRef: Ref<boolean>,
) {
  const { data: summary, status } = useRcaPolling<RcaRunSummary>(
    orgRef,
    incidentIdRef,
    runIdRef,
    liveRef,
    {
      interval: RCA_SUMMARY_POLL_MS,
      fetch: incidentsService.getRcaSummary,
      version: (data) => data.state_version,
      expired: () => "expired",
      clearOnTerminalError: (data) => data.state === "running" || data.state === "waiting_input",
    },
  );
  return { summary, status };
}

export default useRcaSummary;
