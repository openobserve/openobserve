<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div
    class="@container flex min-w-0 flex-wrap items-center gap-2"
    role="status"
    :data-state="action"
    data-test="home-credits-line"
  >
    <OText variant="meta" class="text-status-warning-text min-w-0 flex-1">{{ message }}</OText>
    <AssistantCreditManage
      v-if="action === 'manage'"
      :org="org"
      variant="ghost"
      id-prefix="home-credits-line"
    />
    <OButton
      v-else-if="action === 'enable'"
      variant="outline"
      size="sm"
      :loading="prompting"
      data-test="home-credits-line-enable"
      @click="enable"
    >
      {{ t("assistant.consent.enable") }}
    </OButton>
    <AssistantAskAdminPopover
      v-else-if="action === 'ask'"
      kind="credits"
      :org="org"
      :payer="payerOnly"
    >
      <template #trigger>
        <OButton variant="outline" size="sm" data-test="home-credits-line-ask-admin">
          {{ t("assistant.outcome.actions.askAdmin") }}
        </OButton>
      </template>
    </AssistantAskAdminPopover>
  </div>
</template>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, ref } from "vue";
import { useStore } from "vuex";

import AssistantCreditManage from "@/components/ai-assistant/credits/AssistantCreditManage.vue";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import config from "@/aws-exports";
import { queryClient } from "@/composables/query/queryClient";
import { missingOrganizationsOf, usePaidOverageConsent } from "@/composables/usePaidOverageConsent";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { assistantKeys } from "@/services/assistant.querykeys";
import { paidOverageQuery } from "@/services/paidOverage.queries";
import { paidOverageKeys } from "@/services/paidOverage.querykeys";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<{ org: string }>();

const { t } = useI18nTyped();
const vuex = useStore();
const { promptForConsent } = usePaidOverageConsent();
const prompting = ref(false);

const status = useQuery(computed(() => paidOverageQuery(props.org, "ai_credits")));
const missing = computed(() => missingOrganizationsOf(status.data.value));
// The consent dialog is mounted by the layout only where the edition can bill.
const dialogHost = computed(
  () => config.isCloud === "true" || vuex.state.zoConfig?.billing_enabled === true,
);
const payerOnly = computed(() => {
  const current = status.data.value;
  const only = missing.value.length === 1 && current?.payer && missing.value[0] === current.payer;
  return only ? current!.payer!.org_id : undefined;
});

const action = computed<"manage" | "enable" | "ask" | "none">(() => {
  const current = status.data.value;
  if (!current) return "none";
  if (missing.value.length === 0) return current.effective ? "manage" : "none";
  const manageable = missing.value.every((organization) => organization.can_manage);
  return manageable && dialogHost.value ? "enable" : "ask";
});

const message = computed(() => {
  if (action.value === "ask" && payerOnly.value)
    return t("assistant.consent.memberOnlyPayer", { payer: payerOnly.value });
  if (action.value === "ask") return t("assistant.consent.memberOnly", { org: props.org });
  return t("assistant.credits.exhaustedTag");
});

async function enable(): Promise<void> {
  const current = status.data.value;
  if (!current || prompting.value) return;
  prompting.value = true;
  try {
    const accepted = await promptForConsent(props.org, "ai_credits", current);
    if (!accepted) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: paidOverageKeys.all(props.org) }),
      queryClient.invalidateQueries({ queryKey: assistantKeys.capabilities(props.org) }),
    ]);
  } finally {
    prompting.value = false;
  }
}
</script>
