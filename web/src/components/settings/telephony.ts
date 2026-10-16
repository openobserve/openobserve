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

import type { TelephonyReason, TelephonyRefusalBody, TelephonyView } from "@/ts/interfaces/oncall";
import type { I18nText, TranslateFn } from "@/types/i18n";
import { raw } from "@/types/i18n";

export const PROVIDER = raw("Twilio");
export const SID_PREFIX = raw("AC");
export const FROM_EXAMPLE = raw("+18335550100");
const MASTER_KEY_VARIABLE = raw("O2_MASTER_ENCRYPTION_KEY");

/** What the Telephony page body shows. */
export type TelephonyPageState =
  "loading" | "forbidden" | "failed" | "empty" | "deployment" | "connected";

const TELEPHONY_REASONS: ReadonlySet<string> = new Set<TelephonyReason>([
  "bad_provider",
  "bad_sid",
  "bad_from_number",
  "token_required",
  "no_master_key",
  "account_rejected",
  "unreadable",
]);

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } } | null)?.response?.status;
}

/** Whether a failed call was a 403, the only signal the page has that the caller may not change Settings. [pure] */
export function isForbidden(err: unknown): boolean {
  return statusOf(err) === 403;
}

/** The refusal body of a failed telephony call, or null when it carries no known reason. [pure] */
export function telephonyRefusalOf(err: unknown): TelephonyRefusalBody | null {
  const data = (err as { response?: { data?: Partial<TelephonyRefusalBody> } } | null)?.response
    ?.data;
  return typeof data?.reason === "string" && TELEPHONY_REASONS.has(data.reason)
    ? (data as TelephonyRefusalBody)
    : null;
}

/** The translated sentence for a refusal reason. [pure] */
export function telephonyRefusalText(t: TranslateFn, reason: TelephonyReason): I18nText {
  switch (reason) {
    case "bad_provider":
      return t("telephony.refusal.badProvider", { provider: PROVIDER });
    case "bad_sid":
      return t("telephony.refusal.badSid", { provider: PROVIDER, prefix: SID_PREFIX });
    case "bad_from_number":
      return t("telephony.refusal.badFromNumber", { example: FROM_EXAMPLE });
    case "token_required":
      return t("telephony.refusal.tokenRequired");
    case "no_master_key":
      return t("telephony.refusal.noMasterKey", { variable: MASTER_KEY_VARIABLE });
    case "account_rejected":
      return t("telephony.refusal.accountRejected", { provider: PROVIDER });
    case "unreadable":
      return t("telephony.refusal.unreadable");
  }
}

/** Which body the page shows; data already read outranks a later refetch error, and the org's account outranks the deployment's. [pure] */
export function telephonyPageState(
  view: TelephonyView | null | undefined,
  err: unknown,
): TelephonyPageState {
  if (!view) {
    if (!err) return "loading";
    return isForbidden(err) ? "forbidden" : "failed";
  }
  if (view.org) return "connected";
  return view.deployment_account_present ? "deployment" : "empty";
}

/** An Account SID cut to its first and last four characters, as the connected card shows it. [pure] */
export function shortSid(sid: string): string {
  return sid.length <= 8 ? sid : `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}
