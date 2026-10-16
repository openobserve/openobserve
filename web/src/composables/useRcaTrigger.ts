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

import { getCurrentScope, onScopeDispose } from "vue";
import { isAxiosError } from "axios";
import config from "@/aws-exports";
import incidentsService, { type TriggerRcaResponse } from "@/services/incidents";
import {
  isPaidOverageConsentError,
  usePaidOverageConsent,
} from "@/composables/usePaidOverageConsent";
import { toast } from "@/lib/feedback/Toast/useToast";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

/** Query flags of `POST …/rca`; `guidance` is sent as the JSON body (04 SG33). */
export type RcaTriggerParams = {
  reanalysis?: boolean;
  build_on_previous?: boolean;
  guidance?: string;
};

export interface RcaTriggerOptions {
  /** Aborts the request and any consent prompt it waits on. */
  signal?: AbortSignal;
  /** False once the caller no longer shows this incident; a late result is then dropped. */
  isStillActive?: () => boolean;
  /** Runs before the consent prompt opens: the denied request started nothing on the server. */
  onConsentRequired?: () => void;
}

export type RcaTriggerResult =
  | { status: "started"; runId: string; data: TriggerRcaResponse }
  | { status: "declined" }
  | { status: "unavailable"; message: I18nText };

/**
 * Starts an RCA run and handles the paid-usage consent flow (RR-33).
 *
 * Cloud mounts the consent dialog: a 412 consent error prompts once and retries
 * once on accept. Other builds do not mount the dialog: a 412 returns
 * `unavailable` with the server's message and never waits for a prompt. Every
 * other error is rethrown to the caller.
 */
export function useRcaTrigger() {
  const { t } = useI18nTyped();
  const { promptForConsent } = usePaidOverageConsent();

  // Prompts opened without a caller signal end with the owning component.
  const lifecycle = new AbortController();
  if (getCurrentScope()) onScopeDispose(() => lifecycle.abort());

  const started = (data: TriggerRcaResponse): RcaTriggerResult => ({
    status: "started",
    runId: data.run_id,
    data,
  });

  const requestRca = async (
    org: string,
    incidentId: string,
    params: RcaTriggerParams,
    opts: RcaTriggerOptions = {},
  ): Promise<RcaTriggerResult> => {
    const { signal } = opts;
    try {
      const res = await incidentsService.triggerRca(org, incidentId, params, { signal });
      return started(res.data);
    } catch (error: unknown) {
      const status = isAxiosError(error) ? (error.response?.status ?? 0) : 0;
      const body: unknown = isAxiosError(error) ? error.response?.data : null;

      if (config.isCloud !== "true") {
        if (status !== 412) throw error;
        const serverMessage =
          typeof body === "object" && body !== null && "message" in body ? body.message : null;
        return {
          status: "unavailable",
          message:
            typeof serverMessage === "string" && serverMessage
              ? raw(serverMessage)
              : t("alerts.incidents.aiAnalysis.unavailable"),
        };
      }

      if (!isPaidOverageConsentError(status, body)) throw error;

      opts.onConsentRequired?.();
      const consentSignal = signal ?? lifecycle.signal;
      const accepted = await promptForConsent(org, "ai_credits", body.consent, consentSignal);
      const stillActive = !consentSignal.aborted && (opts.isStillActive?.() ?? true);
      if (!accepted || !stillActive) {
        if (!accepted && stillActive) {
          toast({ variant: "info", message: t("paidUsage.declinedNotice") });
        }
        return { status: "declined" };
      }

      // Exactly one guarded replacement request. A second denial propagates.
      const retry = await incidentsService.triggerRca(org, incidentId, params, { signal });
      return started(retry.data);
    }
  };

  return { requestRca };
}

export default useRcaTrigger;
