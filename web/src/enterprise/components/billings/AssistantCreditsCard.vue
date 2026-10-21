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
    <OSkeleton
      v-if="usageQuery.isPending.value"
      type="rect"
      class="h-16 w-full"
      data-test="billing-ai-credits-loading"
    />
    <p
      v-else-if="usageError"
      class="text-text-body text-sm"
      data-test="billing-ai-credits-unavailable"
    >
      {{ t("assistant.billing.usageUnavailable") }}
      <OButton
        variant="ghost-primary"
        size="xs"
        data-test="assistant-credit-meter-retry"
        @click="retry"
      >
        {{ t("common.retry") }}
      </OButton>
    </p>
    <div v-else-if="usage" class="flex flex-col gap-2" data-test="billing-ai-credits-summary">
      <OTag type="aiMode" :value="usage.mode" class="self-start" />
      <OProgressBar
        :value="ratio"
        size="sm"
        variant="default"
        :aria-label="t('assistant.billing.title')"
      />
      <p class="text-text-body text-sm" data-test="billing-ai-credits-used">{{ usedLine }}</p>
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
import { useQuery } from "@tanstack/vue-query";
import { computed, nextTick, useId } from "vue";
import { useStore } from "vuex";

import { useAssistantCapability } from "@/composables/assistant";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { assistantUsageQuery } from "@/services/assistant.queries";
import { paidOverageQuery } from "@/services/paidOverage.queries";
import { useI18nTyped } from "@/types/i18n";

import AssistantPaidUsageSettings from "./AssistantPaidUsageSettings.vue";
import { creditsLineOf, dayOf, modeLineKey, modeOf } from "./assistantBilling";

const emit = defineEmits<{ (e: "subscribe"): void }>();

const { t } = useI18nTyped();
const store = useStore();
const headingId = useId();

const org = computed(() => (store.state.selectedOrganization?.identifier as string) ?? "");
const capability = useAssistantCapability();
const usageQuery = useQuery(computed(() => assistantUsageQuery(org.value)));
const overage = useQuery(computed(() => paidOverageQuery(org.value, "ai_credits")));

const usage = computed(() => usageQuery.data.value ?? null);
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

const ratio = computed(() => {
  const limit = usage.value?.credits_limit ?? 0;
  return limit > 0 ? Math.min(1, (usage.value?.credits_used ?? 0) / limit) : 0;
});

const usedLine = computed(() => {
  if (!usage.value) return "";
  const line = creditsLineOf(usage.value);
  return t(line.key, line.params);
});

function retry() {
  void usageQuery.refetch();
}

async function focusPaidUsage() {
  await nextTick();
  const target = document.getElementById("paid-usage-settings");
  target?.scrollIntoView({ block: "nearest" });
  target?.focus();
}
</script>
