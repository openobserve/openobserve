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

import type { AiUsage } from "@/services/billings";
import type { PaidOverageStatus } from "@/services/paidOverage";
import type { I18nKey } from "@/types/i18n";
import { formatCount, uiIntlLocale } from "@/utils/formatters";

export type BillingMode = "free" | "consent_required" | "pay_as_you_go" | "exhausted" | "unknown";

const MODES: ReadonlySet<string> = new Set([
  "free",
  "consent_required",
  "pay_as_you_go",
  "exhausted",
]);

/** An org's display name from the org list; the id only when the list does not have it. */
export function orgNameOf(list: unknown, id: string, fallback?: string): string {
  if (Array.isArray(list)) {
    const match = list.find(
      (entry) =>
        !!entry &&
        typeof entry === "object" &&
        (entry as { identifier?: unknown }).identifier === id,
    ) as { name?: unknown; label?: unknown } | undefined;
    const name = match?.name ?? match?.label;
    if (typeof name === "string" && name) return name;
  }
  return fallback || id;
}

export function modeOf(usage: Pick<AiUsage, "mode"> | null | undefined): BillingMode {
  return usage && MODES.has(usage.mode) ? (usage.mode as BillingMode) : "unknown";
}

/** RFC 3339 or epoch to the org's calendar day; empty when the server sent nothing usable. */
export function dayOf(value: unknown): string {
  const ms =
    typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Intl.DateTimeFormat(uiIntlLocale(), { dateStyle: "medium" }).format(new Date(ms));
}

/** The one explanatory line under the meter, chosen by mode and, when exhausted, by what would unblock it. */
export function modeLineKey(
  mode: BillingMode,
  options: {
    resets: boolean;
    payer: boolean;
    billing?: PaidOverageStatus["billing_status"];
    isAdmin: boolean;
  },
): I18nKey | null {
  if (mode === "free")
    return options.resets
      ? "assistant.billing.mode.freeResets"
      : "assistant.billing.mode.freeNoRenew";
  if (mode === "consent_required") return "assistant.billing.mode.consentRequired";
  if (mode === "pay_as_you_go")
    return options.payer ? "paidUsage.payerBillingCycle" : "paidUsage.organizationBillingCycle";
  if (mode === "exhausted")
    return options.billing === "additional_credits_required"
      ? exhaustedContractKey(options.isAdmin)
      : "assistant.billing.mode.exhaustedSubscribe";
  return null;
}

/** The contract-exhausted line, worded for who can act on it. */
export function exhaustedContractKey(isAdmin: boolean): I18nKey {
  return isAdmin
    ? "assistant.billing.mode.exhaustedContract"
    : "assistant.billing.mode.exhaustedContractMember";
}

/** The used-credits sentence both billing pages show, so Plans and Usage never word the same numbers differently. */
export function creditsLineOf(usage: Pick<AiUsage, "credits_used" | "credits_limit" | "mode">): {
  key: I18nKey;
  params: Record<string, string>;
} {
  const used = usage.credits_used ?? 0;
  const limit = usage.credits_limit ?? 0;
  // Pay-as-you-go past the included pool is normal use, so it reads as included plus billed, never "1200 / 1000".
  if (modeOf(usage) === "pay_as_you_go" && used > limit)
    return {
      key: "assistant.billing.usedBilled",
      params: { limit: formatCount(limit), billed: formatCount(used - limit) },
    };
  return {
    key: "assistant.billing.usedOf",
    params: { used: formatCount(used), limit: formatCount(limit) },
  };
}
