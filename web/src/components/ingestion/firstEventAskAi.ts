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
import type { InjectionKey } from "vue";
import type { TranslateFn, I18nKey } from "@/types/i18n";
import type { RejectionReason } from "@/services/ingestion";
import type { FirstEventDiagnosis } from "@/composables/firstEvent/useFirstEventWatch";

/** Provided by the Ingestion page; opens the AI chat prefilled with the query and does not send it. */
export const FIRST_EVENT_ASK_AI: InjectionKey<(query: string) => void> = Symbol("firstEventAskAi");

export const REJECTION_REASON_KEYS: Record<RejectionReason, I18nKey> = {
  invalid_credentials: "ingestion.firstEvent.reasonInvalidCredentials",
  malformed_body: "ingestion.firstEvent.reasonMalformedBody",
  batch_too_large: "ingestion.firstEvent.reasonBatchTooLarge",
  rate_or_quota: "ingestion.firstEvent.reasonRateOrQuota",
};

export interface AskAiContext {
  guideName: string;
  diagnosis: FirstEventDiagnosis;
  org: string;
  endpoint: string;
}

/** The prompt names the guide, the diagnosis, the org id and the endpoint; it never carries a token. */
export function askAiQuery(ctx: AskAiContext, t: TranslateFn): string {
  const newest = ctx.diagnosis.rejections[0];
  let details: string;
  if (ctx.diagnosis.form === "rejected" && newest) {
    details = t("ingestion.firstEvent.askAiRejected", {
      status: newest.status,
      reason: t(REJECTION_REASON_KEYS[newest.reason] ?? "ingestion.firstEvent.reasonMalformedBody"),
      path: newest.path,
    });
  } else if (ctx.diagnosis.form === "no-requests") {
    details = t("ingestion.firstEvent.askAiNoRequests");
  } else {
    details = t("ingestion.firstEvent.askAiUnavailable");
  }
  return t("ingestion.firstEvent.askAiPrompt", {
    guide: ctx.guideName || t("ingestion.firstEvent.thisGuide"),
    details,
    org: ctx.org,
    endpoint: ctx.endpoint,
  });
}
