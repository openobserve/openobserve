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

import { onScopeDispose, ref, watch, type Ref } from "vue";
import { isAxiosError } from "axios";
import incidentsService, {
  type RcaRunState,
  type RcaSteerRequest,
  type RcaSteering,
} from "@/services/incidents";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { formatTimestampInTimezone } from "@/utils/date";
import { isClosedRunRefusal } from "@/utils/incidents/rcaSteering";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

/** How often the steering view of a live run is re-read (04 H8; the thread's poll). */
export const RCA_STEERING_POLL_MS = 4_000;

export type RcaSteerSendResult =
  | { ok: true; runState: RcaRunState }
  | {
      ok: false;
      /** `error_code` of the answer, e.g. `run_closing`; null for a network error. */
      code: string | null;
      message: I18nText;
    };

/** The JSON error body of the steer route (04 §9.1). */
const errorBody = (error: unknown): Record<string, unknown> | null => {
  const body: unknown = isAxiosError(error) ? error.response?.data : null;
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
};

const errorCode = (body: Record<string, unknown> | null): string | null => {
  if (typeof body?.error_code === "string") return body.error_code;
  return typeof body?.code === "string" ? body.code : null;
};

/**
 * The steering rows, the open question and `can_steer` of one RCA run
 * (04 §9.2, SG22, SG37), plus `send` for the steer box and the hypothesis
 * actions (§9.1).
 *
 * The first read happens when the run id is set. While `live` is true the view
 * is re-read every 4 s; a successful send re-reads it at once. When `live`
 * turns false the poll stops after one final read. A 403 or 404 ends the reads
 * of the run and leaves no view, so the steer box stays hidden.
 */
export function useRcaSteering(
  orgRef: Ref<string>,
  incidentIdRef: Ref<string | null>,
  runIdRef: Ref<string | null>,
  liveRef: Ref<boolean>,
) {
  const { t } = useI18nTyped();
  const timezone = useViewerTimezone();

  const steering = ref<RcaSteering | null>(null);
  const sending = ref(false);

  // Bumped when the run changes or the owner unmounts: older answers are dropped.
  let generation = 0;
  let readSeq = 0;
  let appliedSeq = 0;
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
      const response = await incidentsService.getRcaSteering(org, incidentId, runId);
      if (gen !== generation || seq < appliedSeq) return;
      appliedSeq = seq;
      steering.value = response.data;
    } catch (error) {
      if (gen !== generation || seq < appliedSeq) return;
      appliedSeq = seq;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 403 || status === 404) {
        halted = true;
        clearTimer();
        steering.value = null;
        return;
      }
      // Keep the last good view; a live run retries on the next tick.
      console.error("Failed to load the RCA steering view:", error);
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
    }, RCA_STEERING_POLL_MS);
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
        halted = false;
        appliedSeq = readSeq;
        steering.value = null;
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

  /** Re-reads the view now, then keeps the 4 s rhythm while live. */
  const refresh = async () => {
    const gen = generation;
    clearTimer();
    await read();
    if (gen === generation) schedule();
  };

  /** The message for a refused send (04 §9.1). */
  const sendErrorMessage = (error: unknown): { code: string | null; message: I18nText } => {
    const status = isAxiosError(error) ? (error.response?.status ?? 0) : 0;
    const body = errorBody(error);
    const code = errorCode(body);
    switch (code) {
      case "run_not_steerable":
        return { code, message: t("alerts.incidents.rcaSteer.error.runNotSteerable") };
      case "run_closing":
        return { code, message: t("alerts.incidents.rcaSteer.error.runClosing") };
      case "duplicate_action":
        return { code, message: t("alerts.incidents.rcaSteer.error.duplicateAction") };
      case "invalid_text":
        return { code, message: t("alerts.incidents.rcaSteer.error.invalidText") };
      case "invalid_action":
        return { code, message: t("alerts.incidents.rcaSteer.error.invalidAction") };
      case "unknown_hypothesis":
        return { code, message: t("alerts.incidents.rcaSteer.error.unknownHypothesis") };
    }
    if (status === 429 || code === "rate_limited") {
      const seconds = Number(body?.retry_after_secs);
      if (Number.isFinite(seconds) && seconds > 0) {
        const at = (Date.now() + seconds * 1_000) * 1_000;
        return {
          code: "rate_limited",
          message: t("alerts.incidents.rcaSteer.error.rateLimitedUntil", {
            time: formatTimestampInTimezone(at, "HH:mm:ss", timezone.value),
          }),
        };
      }
      return { code: "rate_limited", message: t("alerts.incidents.rcaSteer.error.rateLimited") };
    }
    if (status === 403) {
      return { code, message: t("alerts.incidents.rcaSteer.error.forbidden") };
    }
    const serverMessage = typeof body?.message === "string" ? body.message : "";
    return {
      code,
      message: serverMessage ? raw(serverMessage) : t("alerts.incidents.rcaSteer.error.generic"),
    };
  };

  /** Sends one message or hypothesis action to the run, then re-reads the view. */
  const send = async (request: RcaSteerRequest): Promise<RcaSteerSendResult> => {
    const org = orgRef.value;
    const incidentId = incidentIdRef.value;
    const runId = runIdRef.value;
    if (!incidentId || !runId) {
      return { ok: false, code: null, message: t("alerts.incidents.rcaSteer.error.generic") };
    }
    sending.value = true;
    try {
      const response = await incidentsService.steerRca(org, incidentId, runId, request);
      void refresh();
      return { ok: true, runState: response.data.run_state };
    } catch (error) {
      console.error("Failed to steer the RCA run:", error);
      const refused = sendErrorMessage(error);
      // A refused send can mean the run moved on: re-read it. A closed run is
      // left to the 4 s poll, so the caller handles the refusal first (SG40).
      if (!isClosedRunRefusal(refused.code)) void refresh();
      return { ok: false, ...refused };
    } finally {
      sending.value = false;
    }
  };

  return { steering, sending, refresh, send };
}

export default useRcaSteering;
