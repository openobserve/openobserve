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

import type { CreditRefusalContext } from "@/composables/assistant";
import type { I18nKey } from "@/types/i18n";

/** One refusal's line and its one action; `params` are raw values the caller formats. */
export interface CreditsRefusalCopy {
  titleKey: I18nKey;
  bodyKey: I18nKey;
  params: { org: string; payer?: string; date?: string };
  action: "manage_usage" | "view_plans" | "copy_request" | "ask_admin";
  /** The org whose admins an Ask an admin request reaches. */
  payer?: string;
}

const CREDIT_CODES: ReadonlySet<string> = new Set(["credits_exhausted", "subscription_required"]);

/** A credits or subscription 402, the refusal the transcript explains as credits. */
export function isCreditsRefusal(code: string | undefined): boolean {
  return !!code && CREDIT_CODES.has(code);
}

/** The role and billing split of a 402; `null` for every other code. */
export function creditsRefusal(
  code: string | undefined,
  role: "admin" | "member",
  org: string,
  ctx: CreditRefusalContext,
  day: (ts: number) => string,
): CreditsRefusalCopy | null {
  if (!isCreditsRefusal(code)) return null;
  const { payer } = ctx;
  const params = { org, payer, date: ctx.resetsAt === undefined ? undefined : day(ctx.resetsAt) };
  const titleKey: I18nKey = payer
    ? "assistant.error.credits_exhausted.titlePayer"
    : "assistant.error.credits_exhausted.title";
  if (!(ctx.canManage ?? role === "admin"))
    return payer
      ? {
          titleKey,
          bodyKey: "assistant.error.credits_exhausted.bodyPayerMember",
          params,
          action: "ask_admin",
          payer,
        }
      : {
          titleKey,
          bodyKey: "assistant.error.credits_exhausted.bodyMember",
          params,
          action: "ask_admin",
        };
  // The server's code wins: a cached overage read can predate a lapsed subscription.
  if (code === "subscription_required" || (!payer && ctx.billingStatus === "subscription_required"))
    return {
      titleKey: payer ? titleKey : "assistant.error.subscription_required.title",
      bodyKey: "assistant.error.subscription_required.body",
      params,
      action: "view_plans",
    };
  if (!payer && ctx.billingStatus === "additional_credits_required")
    return {
      titleKey,
      bodyKey: "assistant.error.credits_exhausted.bodyContract",
      params,
      action: "copy_request",
    };
  return {
    titleKey,
    bodyKey: params.date
      ? "assistant.error.credits_exhausted.bodyResets"
      : "assistant.error.credits_exhausted.body",
    params,
    action: "manage_usage",
  };
}
