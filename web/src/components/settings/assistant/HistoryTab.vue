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
  <div class="flex flex-col gap-4" data-test="settings-assistant-history-tab">
    <OCard
      variant="outlined"
      class="flex flex-col gap-3 p-4"
      data-test="settings-assistant-history-card"
      :data-state="persistence ? 'server' : 'browser'"
    >
      <h2 class="text-text-heading text-base font-semibold">
        {{
          persistence
            ? t("assistant.settings.history.serverTitle")
            : t("assistant.settings.history.browserTitle")
        }}
      </h2>
      <p v-if="!persistence" class="text-text-body text-sm">
        {{ t("assistant.settings.history.browserBody") }}
      </p>
      <div class="flex flex-col gap-2">
        <AssistantEnvValue
          :label="t('assistant.settings.history.persistence')"
          :value="raw(String(persistence))"
          env-name="O2_AI_CHAT_PERSISTENCE_ENABLED"
          :help="persistence ? undefined : t('assistant.settings.history.persistenceHelp')"
        />
        <template v-if="persistence">
          <AssistantEnvValue
            :label="t('assistant.settings.history.retention')"
            :value="retention"
            env-name="O2_AI_CHAT_RETENTION_DAYS"
          />
          <AssistantEnvValue
            :label="t('assistant.settings.history.publicLinks')"
            :value="publicLinks"
            env-name="ZO_PUBLIC_AI_CHAT_ENABLED"
          />
        </template>
      </div>
      <p
        v-if="persistence"
        class="text-text-secondary text-sm"
        data-test="settings-assistant-history-delete-line"
      >
        {{ t("assistant.settings.history.deleteLine") }}
      </p>
    </OCard>
    <AssistantImportCard
      v-if="persistence && history.importView.value && !readonly"
      :view="history.importView.value"
      :org="page.org.value"
      :downloading="exporter.busy.value.has('all')"
      @move="history.runImport()"
      @retry="history.runImport()"
      @dismiss="(kind) => history.dismissImport(kind)"
      @download="(sid) => exporter.exportChat(sid, 'json')"
      @download-all="exporter.exportAll('json', { scope: 'browser' })"
    />
  </div>
</template>

<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed, onMounted } from "vue";

import AssistantImportCard from "@/components/ai-assistant/history/AssistantImportCard.vue";
import { useAssistantHistory, useChatExport } from "@/composables/assistant";
import OCard from "@/lib/core/Card/OCard.vue";
import { capabilitiesQuery } from "@/services/assistant.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantEnvValue from "./AssistantEnvValue.vue";
import { useAssistantSettingsPage } from "./useAssistantSettingsPage";

const { t } = useI18nTyped();
const page = useAssistantSettingsPage();
const history = useAssistantHistory();
const exporter = useChatExport();
const readonly = computed(() => page.capability.value.canChat === "no");

// Retention comes from the capability probe, so a refresh re-reads it.
const capabilities = useQuery(
  computed(() => capabilitiesQuery(page.org.value, page.aiEnabled.value)),
);

const persistence = computed(() => page.persistence.value);

// The import offer counts this browser's chats, which nothing has read yet when Settings is the first page.
onMounted(() => history.ensureLoaded());

const retention = computed<I18nText | null>(() => {
  const days = page.capability.value.retentionDays;
  if (days === undefined) return null;
  if (days === 0) return t("assistant.settings.history.retentionForever");
  return t("assistant.settings.history.retentionDays", { days }, days);
});

const publicLinks = computed<I18nText>(() => {
  if (!page.publicLinksAllowed.value) return t("assistant.settings.history.publicLinksOff");
  const days = Math.floor(page.publicMaxExpiryDays.value);
  return t("assistant.settings.history.publicLinksOn", { days }, days);
});

function refresh() {
  return capabilities.refetch();
}

defineExpose({ refresh });
</script>
