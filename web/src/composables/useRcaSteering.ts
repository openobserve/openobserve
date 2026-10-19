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

import { ref, type Ref } from "vue";
import { isAxiosError } from "axios";
import incidentsService, { type RcaSteerRequest } from "@/services/incidents";
import { useViewerTimezone } from "@/composables/downtimes/useViewerTimezone";
import { formatTimestampInTimezone } from "@/utils/date";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

export type RcaSteerSendResult =
  | { ok: true }
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

/** `send` for the steer box and hypothesis actions (04 §9.1); the stream shows the row (05 LU18). */
export function useRcaSteering(
  orgRef: Ref<string>,
  incidentIdRef: Ref<string | null>,
  runIdRef: Ref<string | null>,
) {
  const { t } = useI18nTyped();
  const timezone = useViewerTimezone();

  const sending = ref(false);

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

  /** Sends one message or hypothesis action to the run. */
  const send = async (request: RcaSteerRequest): Promise<RcaSteerSendResult> => {
    const org = orgRef.value;
    const incidentId = incidentIdRef.value;
    const runId = runIdRef.value;
    if (!incidentId || !runId) {
      return { ok: false, code: null, message: t("alerts.incidents.rcaSteer.error.generic") };
    }
    sending.value = true;
    try {
      await incidentsService.steerRca(org, incidentId, runId, request);
      return { ok: true };
    } catch (error) {
      console.error("Failed to steer the RCA run:", error);
      return { ok: false, ...sendErrorMessage(error) };
    } finally {
      sending.value = false;
    }
  };

  return { sending, send };
}

export default useRcaSteering;
