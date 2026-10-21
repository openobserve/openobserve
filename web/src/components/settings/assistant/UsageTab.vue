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
  <div class="flex flex-col gap-4" data-test="settings-assistant-usage-tab">
    <OCard
      v-if="page.isCloud.value"
      variant="outlined"
      class="flex flex-col gap-4 p-4"
      data-test="settings-assistant-usage-card"
    >
      <AssistantCreditMeter
        size="card"
        :usage="credits.usage.value"
        :overage="credits.overage.value"
        :status="credits.status.value"
        :can-manage="credits.canManage.value"
        :org-name="page.orgName.value"
        @retry="credits.retry()"
      />
      <p
        v-if="modeLine"
        class="text-text-body text-sm"
        data-test="settings-assistant-usage-mode-line"
      >
        {{ modeLine }}
      </p>
      <div class="flex flex-col gap-2">
        <span class="text-text-secondary text-xs">{{ t("assistant.settings.usage.period") }}</span>
        <OStatStrip :items="stats" data-test="settings-assistant-usage-stats" />
      </div>
      <div v-if="page.isAdmin.value" class="flex flex-wrap gap-2 max-md:flex-col">
        <OButton
          variant="outline"
          size="sm-action"
          class="max-md:min-h-11 max-md:w-full"
          data-test="settings-assistant-usage-manage-paid"
          @click="go('plans')"
          >{{ t("assistant.settings.usage.managePaid") }}</OButton
        >
        <OButton
          v-if="page.isMetaOrg.value"
          variant="outline"
          size="sm-action"
          class="max-md:min-h-11 max-md:w-full"
          data-test="settings-assistant-usage-allowance"
          @click="go('orgnizationManagement')"
          >{{ t("assistant.settings.usage.allowance") }}</OButton
        >
      </div>
    </OCard>
    <p v-else class="text-text-body text-sm" data-test="settings-assistant-usage-not-metered">
      {{ t("assistant.settings.usage.notMetered") }}
    </p>
    <OCard
      variant="outlined"
      class="flex flex-col gap-3 p-4"
      data-test="settings-assistant-caps-card"
    >
      <h2 class="text-text-heading text-base font-semibold">
        {{ t("assistant.settings.usage.caps") }}
      </h2>
      <div class="flex flex-col gap-2">
        <AssistantEnvValue
          v-for="cap in CAPS"
          :key="cap.envName"
          :label="t(cap.labelKey)"
          :value="null"
          :env-name="cap.envName"
        />
      </div>
      <p class="text-text-secondary text-sm">{{ t("assistant.settings.usage.capsLine") }}</p>
    </OCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";

import AssistantCreditMeter from "@/components/ai-assistant/credits/AssistantCreditMeter.vue";
import { useAssistantCredits } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";

import AssistantEnvValue from "./AssistantEnvValue.vue";
import { useAssistantSettingsPage } from "./useAssistantSettingsPage";

// No server version reports these yet, so every row reads "not reported" rather than a guess.
const CAPS: { envName: string; labelKey: I18nKey }[] = [
  {
    envName: "O2_AI_CHAT_MAX_ACTIVE_TURNS_PER_USER",
    labelKey: "assistant.settings.usage.perMember",
  },
  { envName: "O2_AI_CHAT_MAX_ACTIVE_TURNS_PER_ORG", labelKey: "assistant.settings.usage.perOrg" },
  { envName: "O2_AI_CHAT_MAX_ACTIVE_TURNS_PER_NODE", labelKey: "assistant.settings.usage.perNode" },
  { envName: "O2_AI_CHAT_MAX_TURN_SECS", labelKey: "assistant.settings.usage.longest" },
];

const STATS: { key: string; labelKey: I18nKey }[] = [
  { key: "turns", labelKey: "assistant.settings.usage.turns" },
  { key: "answered", labelKey: "assistant.settings.usage.answered" },
  { key: "stopped", labelKey: "assistant.settings.usage.stopped" },
  { key: "failed", labelKey: "assistant.settings.usage.failed" },
];

const { t } = useI18nTyped();
const router = useRouter();
const page = useAssistantSettingsPage();
const credits = useAssistantCredits(
  () => page.org.value,
  () => page.isCloud.value,
  () => page.isAdmin.value,
);

const stats = computed<StatItem[]>(() =>
  STATS.map((s) => ({
    key: s.key,
    label: t(s.labelKey),
    value: "—",
    dataTest: `settings-assistant-usage-${s.key}`,
  })),
);

const modeLine = computed<I18nText | null>(() => {
  const mode = page.capability.value.creditMode;
  if (mode === "exhausted")
    return t("assistant.settings.usage.exhaustedLine", { org: raw(page.orgName.value) });
  if (mode === "consent_required") return t("assistant.settings.usage.consentLine");
  return null;
});

function go(name: string) {
  void router.push({ name, query: { org_identifier: page.org.value } });
}

function refresh() {
  if (page.isCloud.value) credits.retry();
  return Promise.resolve();
}

defineExpose({ refresh });
</script>
