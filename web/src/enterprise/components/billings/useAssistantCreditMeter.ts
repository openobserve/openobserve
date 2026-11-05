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

import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import { useStore } from "vuex";

import type { AssistantCreditMeterProps } from "@/components/ai-assistant/credits/AssistantCreditMeter.vue";
import { useAssistantCapability } from "@/composables/assistant";
import { assistantUsageQuery } from "@/services/assistant.queries";
import { paidOverageQuery } from "@/services/paidOverage.queries";

/** The credit meter's inputs from the shared usage and paid-usage reads, so every billing page shows the same state. */
export function useAssistantCreditMeter() {
  const store = useStore();
  const org = computed(() => (store.state.selectedOrganization?.identifier as string) ?? "");
  const orgName = computed(() => (store.state.selectedOrganization?.label as string) || org.value);
  const capability = useAssistantCapability();
  const usageQuery = useQuery(computed(() => assistantUsageQuery(org.value)));
  const overage = useQuery(computed(() => paidOverageQuery(org.value, "ai_credits")));
  const usage = computed(() => usageQuery.data.value ?? null);
  const status = computed<AssistantCreditMeterProps["status"]>(() => {
    if (usageQuery.isPending.value) return "loading";
    if (usage.value) return "ready";
    return overage.data.value ? "partial" : "error";
  });
  // Until the overage read lands the role decides, as the refusal does.
  const canManage = computed(
    () => overage.data.value?.organization.can_manage ?? capability.value.isAdmin === true,
  );
  return {
    org,
    orgName,
    capability,
    usageQuery,
    overage,
    usage,
    status,
    canManage,
    retry: () => void usageQuery.refetch(),
  };
}
