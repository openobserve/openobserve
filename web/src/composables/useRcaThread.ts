// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { type Ref } from "vue";
import { isAxiosError } from "axios";
import incidentsService, { type RcaThread } from "@/services/incidents";
import { useRcaPolling } from "@/composables/useRcaPolling";
import type { RcaReadStatus } from "@/composables/useRcaPolling";

/** How often the thread of a live run is re-read (02 TH32; the chat panel's `RUNNING_TURN_POLL_MS`). */
export const RCA_THREAD_POLL_MS = 4_000;

/** Terminal read failures stop polling; transient failures retain the last good thread. */
export type RcaThreadStatus = RcaReadStatus;

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

/** TH32: versioned reads while live, then one final read on termination. */
export function useRcaThread(
  orgRef: Ref<string>,
  incidentIdRef: Ref<string | null>,
  runIdRef: Ref<string | null>,
  liveRef: Ref<boolean>,
) {
  const {
    data: thread,
    status,
    retry,
  } = useRcaPolling<RcaThread>(orgRef, incidentIdRef, runIdRef, liveRef, {
    interval: RCA_THREAD_POLL_MS,
    fetch: incidentsService.getRcaThread,
    version: (data) => data.state_version,
    expired: (error) => (errorCode(error) === "transcript_incomplete" ? "incomplete" : "expired"),
  });

  return { thread, status, retry };
}

export default useRcaThread;
