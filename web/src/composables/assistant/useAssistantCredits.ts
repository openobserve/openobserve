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

import { useQueries } from "@tanstack/vue-query";
import { computed, onScopeDispose, ref, watch } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import type { AssistantUsage } from "@/services/assistant";
import { assistantUsageQuery } from "@/services/assistant.queries";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { PaidOverageStatus } from "@/services/paidOverage";
import { paidOverageQuery } from "@/services/paidOverage.queries";

export const CREDIT_NOTICE_PREFIX = "o2.assistant.creditNotice:";

export type CreditThreshold = 70 | 90;

/** The refusal's role and billing inputs; every field is absent until the overage read lands. */
export interface CreditRefusalContext {
  canManage?: boolean;
  billingStatus?: PaidOverageStatus["billing_status"];
  payer?: string;
  resetsAt?: number;
}

/** The two reads behind every credit surface, independent so one failing never hides the other. */
export function useAssistantCredits(
  org: () => string,
  enabled: () => boolean,
  isAdmin: () => boolean,
) {
  // The runtime's client, so a host mounted without the plugin reads the same cache.
  const results = useQueries(
    {
      queries: () => [
        { ...assistantUsageQuery(org()), enabled: enabled() && !!org() },
        { ...paidOverageQuery(org(), "ai_credits"), enabled: enabled() && !!org() },
      ],
    },
    queryClient,
  );
  const usageResult = computed(() => results.value[0]);
  const overageResult = computed(() => results.value[1]);
  const usage = computed<AssistantUsage | null>(() => usageResult.value?.data ?? null);
  const overage = computed<PaidOverageStatus | null>(() => overageResult.value?.data ?? null);
  const status = computed<"loading" | "ready" | "partial" | "error">(() => {
    if (usageResult.value?.isPending && usageResult.value.fetchStatus !== "idle") return "loading";
    if (usage.value) return "ready";
    return overage.value ? "partial" : "error";
  });
  // Until the overage read lands (or when it fails) the role decides, as the refusal does.
  const canManage = computed(() =>
    overage.value ? overage.value.organization.can_manage === true : isAdmin(),
  );
  const refusal = computed<CreditRefusalContext>(() => ({
    canManage: overage.value?.organization.can_manage,
    billingStatus: overage.value?.billing_status,
    payer: overage.value?.payer?.org_id || undefined,
    resetsAt: usage.value?.resetsAt,
  }));
  return {
    usage,
    overage,
    status,
    canManage,
    refusal,
    retry() {
      void usageResult.value?.refetch();
      void overageResult.value?.refetch();
    },
  };
}

/** The 70 % and 90 % notice: `free` only, once per user+org, credit period and threshold, the first dismiss in any tab winning. */
export function useCreditNotice(
  userOrgKey: () => string | null,
  usage: () => AssistantUsage | null,
  visible: () => boolean,
) {
  const version = ref(0);
  const closedHere = new Set<string>();
  // A notice reopened with the panel is the same impression, not a new one.
  const reported = new Set<string>();
  const keyOf = (threshold: CreditThreshold) => {
    const key = userOrgKey();
    const resetsAt = usage()?.resetsAt;
    const period = resetsAt === undefined ? "" : `${resetsAt}:`;
    return key ? `${CREDIT_NOTICE_PREFIX}${key}:${period}${threshold}` : null;
  };
  const seen = (threshold: CreditThreshold): boolean => {
    void version.value;
    const key = keyOf(threshold);
    if (!key || closedHere.has(key)) return true;
    try {
      return window.localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  };
  const crossed = computed<CreditThreshold | null>(() => {
    const value = usage();
    if (value?.mode !== "free" || value.credits_limit <= 0) return null;
    const ratio = value.credits_used / value.credits_limit;
    return ratio >= 0.9 ? 90 : ratio >= 0.7 ? 70 : null;
  });
  const threshold = computed(() => {
    const value = crossed.value;
    return value && visible() && !seen(value) ? value : null;
  });

  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(CREDIT_NOTICE_PREFIX)) version.value += 1;
  };
  window.addEventListener("storage", onStorage);
  onScopeDispose(() => window.removeEventListener("storage", onStorage));

  const track = (value: CreditThreshold, action: "shown" | "dismiss" | "manage" | "ask_admin") =>
    trackAssistant("ai_credit_notice", {
      threshold: value,
      mode: "free",
      action,
      had_prior_warning: value === 90 && seen(70),
    });
  watch(
    threshold,
    (value) => {
      const key = value ? keyOf(value) : null;
      if (!value || !key || reported.has(key)) return;
      reported.add(key);
      track(value, "shown");
    },
    { immediate: true },
  );

  return {
    threshold,
    dismiss() {
      const value = threshold.value;
      const key = value ? keyOf(value) : null;
      if (!value || !key) return;
      track(value, "dismiss");
      closedHere.add(key);
      try {
        // Read before write, so a dismiss in another tab keeps its own time.
        if (window.localStorage.getItem(key) === null)
          window.localStorage.setItem(key, String(Date.now()));
      } catch {
        // Private mode: the notice still closes for this page.
      }
      version.value += 1;
    },
    noteAction(action: "manage" | "ask_admin") {
      if (threshold.value) track(threshold.value, action);
    },
  };
}
