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
  <section
    v-if="usageQuery.isPending.value || usage || usageError"
    class="bg-card-glass-bg border-border-default rounded-surface flex flex-col gap-3 border p-4"
    :aria-labelledby="headingId"
    data-test="billing-ai-credits-card"
  >
    <h2 :id="headingId" class="text-text-heading text-base font-medium">
      {{ t("assistant.billing.title") }}
    </h2>
    <div data-test="billing-ai-credits-summary">
      <AssistantCreditMeter
        size="card"
        :usage="usage"
        :overage="overage.data.value ?? null"
        :status="meterStatus"
        :can-manage="canManage"
        :org-name="orgName"
        @retry="retry"
        @manage="focusPaidUsage"
      />
    </div>
    <!-- The paid usage section below states an overage read failure once, with its own Retry. -->
    <div
      v-if="modeLine && !overageError"
      class="flex flex-wrap items-center gap-2"
      data-test="billing-ai-mode-line"
    >
      <p class="text-text-body text-sm">{{ modeLine }}</p>
      <OButton
        v-if="mode === 'consent_required'"
        variant="outline"
        size="sm-action"
        class="max-md:min-h-11"
        data-test="billing-open-paid-usage-settings"
        @click="focusPaidUsage"
        >{{ t("assistant.billing.managePaidUsage") }}</OButton
      >
      <OButton
        v-else-if="
          mode === 'exhausted' && modeLineKeyValue === 'assistant.billing.mode.exhaustedSubscribe'
        "
        variant="outline"
        size="sm-action"
        class="max-md:min-h-11"
        data-test="billing-ai-subscribe"
        @click="emit('subscribe')"
        >{{ t("assistant.billing.subscribe") }}</OButton
      >
    </div>
    <AssistantPaidUsageSettings @change="retry" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, useId } from "vue";

import AssistantCreditMeter from "@/components/ai-assistant/credits/AssistantCreditMeter.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";

import AssistantPaidUsageSettings from "./AssistantPaidUsageSettings.vue";
import { dayOf, modeLineKey, modeOf } from "./assistantBilling";
import { useAssistantCreditMeter } from "./useAssistantCreditMeter";

const emit = defineEmits<{ (e: "subscribe"): void }>();

const { t } = useI18nTyped();
const headingId = useId();

const {
  orgName,
  capability,
  usageQuery,
  overage,
  usage,
  status: meterStatus,
  canManage,
  retry,
} = useAssistantCreditMeter();
const usageError = computed(() => usageQuery.isError.value);
const mode = computed(() => modeOf(usage.value));
const overageError = computed(() => overage.isError.value);
const resetsAt = computed(() => dayOf(usage.value?.resetsAt));
const modeLineKeyValue = computed(() =>
  modeLineKey(mode.value, {
    resets: !!resetsAt.value,
    payer: !!overage.data.value?.payer,
    billing: overage.data.value?.billing_status,
    isAdmin: capability.value.isAdmin,
  }),
);
const modeLine = computed(() =>
  modeLineKeyValue.value ? t(modeLineKeyValue.value, { date: resetsAt.value }) : "",
);

async function focusPaidUsage() {
  await nextTick();
  const target = document.getElementById("paid-usage-settings");
  target?.scrollIntoView({ block: "nearest" });
  target?.focus();
}
</script>
