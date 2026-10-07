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

import { raw, type I18nText, type TranslateFn } from "@/types/i18n";

/** Whether a response body is the AI-credits 402, whose `remedy` says what unblocks it. */
export const isAiCreditsExhausted = (body: any): boolean =>
  body?.error_type === "ai_credits_exhausted";

/** The remedy line for an AI-credits 402; retry and unknown remedies keep the server's wording. */
export function aiCreditsRemedy(body: any, t: TranslateFn): I18nText | undefined {
  if (body?.remedy === "subscribe") {
    return body.payer_org_id
      ? t("billing.aiPayerSubscribeMessage", { payer: body.payer_org_id })
      : t("billing.aiExhaustedMessage");
  }
  if (body?.remedy === "contact_account_manager") return t("billing.aiContractExhaustedMessage");
  return body?.message ? raw(body.message) : undefined;
}

/** One-line notice for surfaces with room for a single message, such as a toast. */
export function aiCreditsNotice(body: any, t: TranslateFn): I18nText {
  const remedy = aiCreditsRemedy(body, t);
  return remedy
    ? t("aiAssistant.creditsExhaustedWithRemedy", { remedy })
    : t("aiAssistant.creditsExhausted");
}
