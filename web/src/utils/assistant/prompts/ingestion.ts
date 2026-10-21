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

import type { FirstEventDiagnosis } from "@/composables/firstEvent/useFirstEventWatch";
import type { RejectionReason } from "@/services/ingestion";
import i18n from "@/locales";
import { gt, type I18nKey, type I18nText, type TranslateFn } from "@/types/i18n";

import { ident } from "./ident";
import { redactText } from "./redact";

/** Kept free of the assistant runtime: the legacy ingestion page imports it through `firstEventAskAi.ts`. */
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

/** The en-US catalogue whatever the UI language: door prompts are English model input. */
export const englishT: TranslateFn = ((key: string, params: Record<string, unknown> = {}) => {
  // Read from the catalogue itself: a third string argument to `t` is a default message, not a locale.
  const message = key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      i18n.global.getLocaleMessage("en-us"),
    );
  if (typeof message !== "string") return key;
  return message.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ""));
}) as unknown as TranslateFn;

/** "Still stuck?": the guide prompt in English; the title stays in the UI language. */
export function buildIngestionPrompt(
  ctx: AskAiContext,
  t: TranslateFn = gt,
): { text: string; chips: []; title: I18nText } {
  return {
    text: redactText(askAiQuery(plainContext(ctx), englishT)),
    chips: [],
    title: t("assistant.entry.title.setUpIngestion"),
  };
}

// Guide names are catalogue copy with spaces; every other value reaches the text only as an identifier.
function plainContext(ctx: AskAiContext): AskAiContext {
  const unknown = "unknown";
  return {
    guideName: ident(ctx.guideName.replace(/ /g, "_")) ? ctx.guideName : "",
    org: ident(ctx.org) ?? unknown,
    endpoint: ident(ctx.endpoint) ?? unknown,
    diagnosis: {
      ...ctx.diagnosis,
      rejections: ctx.diagnosis.rejections.map((rejection) => ({
        ...rejection,
        status: Number(rejection.status) || 0,
        path: ident(rejection.path) ?? unknown,
      })),
    },
  };
}
