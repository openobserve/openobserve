<!-- Copyright 2023 OpenObserve Inc.
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
-->

<template>
  <div>
    <div class="q-px-md q-pt-md q-pb-md">
      <div class="text-body1 text-bold">
        {{ t("settings.aiSettingsTitle") }}
      </div>
      <div class="text-caption text-grey-7">
        {{ t("settings.aiEnabledDescription") }}
      </div>
    </div>

    <div class="q-mx-md q-mb-md">
      <q-form @submit.stop="saveAiSettings">
        <!-- AI Enabled (master toggle) -->
        <div class="flex items-center o2-input">
          <q-toggle
            data-test="ai-settings-ai-enabled-toggle"
            v-model="aiEnabled"
            :label="t('settings.aiEnabledLabel')"
            stack-label
            class="q-mt-sm o2-toggle-button-lg tw:mr-2 -tw:ml-4"
            size="lg"
          />
          <q-icon name="info" size="xs" class="q-mt-sm cursor-pointer text-grey-6">
            <q-tooltip max-width="260px">{{ t("settings.aiEnabledDescription") }}</q-tooltip>
          </q-icon>
        </div>

        <!-- Sub-options (indented) -->
        <div class="tw:pl-8">
          <!-- AI Assistant Enabled -->
          <div class="flex items-center o2-input">
            <q-toggle
              data-test="ai-settings-ai-assistant-enabled-toggle"
              v-model="aiAssistantEnabled"
              :label="t('settings.aiAssistantEnabledLabel')"
              :disable="!aiEnabled"
              stack-label
              class="q-mt-sm o2-toggle-button-lg tw:mr-2 -tw:ml-4"
              :class="{ 'ai-sub-feature-disabled': !aiEnabled }"
              size="lg"
            >
              <q-tooltip v-if="!aiEnabled">
                {{ t("settings.aiSubFeatureDisabledTooltip") }}
              </q-tooltip>
            </q-toggle>
            <q-icon name="info" size="xs" class="q-mt-sm cursor-pointer text-grey-6">
              <q-tooltip max-width="260px">{{ t("settings.aiAssistantEnabledDescription") }}</q-tooltip>
            </q-icon>
          </div>

          <!-- AI SRE Enabled -->
          <div class="flex items-center o2-input">
            <q-toggle
              data-test="ai-settings-ai-sre-enabled-toggle"
              v-model="aiSreEnabled"
              :label="t('settings.aiSreEnabledLabel')"
              :disable="!aiEnabled"
              stack-label
              class="q-mt-sm o2-toggle-button-lg tw:mr-2 -tw:ml-4"
              :class="{ 'ai-sub-feature-disabled': !aiEnabled }"
              size="lg"
            >
              <q-tooltip v-if="!aiEnabled">
                {{ t("settings.aiSubFeatureDisabledTooltip") }}
              </q-tooltip>
            </q-toggle>
            <q-icon name="info" size="xs" class="q-mt-sm cursor-pointer text-grey-6">
              <q-tooltip max-width="260px">{{ t("settings.aiSreEnabledDescription") }}</q-tooltip>
            </q-icon>
          </div>

          <!-- AI Evaluation Enabled -->
          <div class="flex items-center o2-input">
            <q-toggle
              data-test="ai-settings-ai-evaluation-enabled-toggle"
              v-model="aiEvaluationEnabled"
              :label="t('settings.aiEvaluationEnabledLabel')"
              :disable="!aiEnabled"
              stack-label
              class="q-mt-sm o2-toggle-button-lg tw:mr-2 -tw:ml-4"
              :class="{ 'ai-sub-feature-disabled': !aiEnabled }"
              size="lg"
            >
              <q-tooltip v-if="!aiEnabled">
                {{ t("settings.aiSubFeatureDisabledTooltip") }}
              </q-tooltip>
            </q-toggle>
            <q-icon name="info" size="xs" class="q-mt-sm cursor-pointer text-grey-6">
              <q-tooltip max-width="260px">{{ t("settings.aiEvaluationEnabledDescription") }}</q-tooltip>
            </q-icon>
          </div>
        </div>

        <div class="flex justify-start q-mt-md">
          <q-btn
            data-test="ai-settings-save-btn"
            :label="t('settings.save')"
            class="o2-primary-button no-border tw:h-[36px]"
            type="submit"
            no-caps
            flat
            :loading="isSaving"
          />
        </div>
      </q-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import organizations from "@/services/organizations";
import { useStore } from "vuex";
import { useQuasar } from "quasar";

const { t } = useI18n();
const store = useStore();
const q = useQuasar();

const aiEnabled = ref<boolean>(
  store.state?.organizationData?.organizationSettings?.ai?.enabled ?? false,
);

const aiAssistantEnabled = ref<boolean>(
  store.state?.organizationData?.organizationSettings?.ai?.assistant_enabled ?? false,
);

const aiSreEnabled = ref<boolean>(
  store.state?.organizationData?.organizationSettings?.ai?.sre_enabled ?? false,
);

const aiEvaluationEnabled = ref<boolean>(
  store.state?.organizationData?.organizationSettings?.ai?.evaluation_enabled ?? false,
);

const isSaving = ref(false);

const saveAiSettings = async () => {
  isSaving.value = true;
  try {
    await organizations.post_organization_settings(
      store.state.selectedOrganization.identifier,
      {
        ai: {
          enabled: aiEnabled.value,
          assistant_enabled: aiAssistantEnabled.value,
          sre_enabled: aiSreEnabled.value,
          evaluation_enabled: aiEvaluationEnabled.value,
        },
      },
    );

    store.dispatch("setOrganizationSettings", {
      ...store.state.organizationData.organizationSettings,
      ai: {
        enabled: aiEnabled.value,
        assistant_enabled: aiAssistantEnabled.value,
        sre_enabled: aiSreEnabled.value,
        evaluation_enabled: aiEvaluationEnabled.value,
      },
    });

    q.notify({
      message: t("settings.organizationSettingsUpdated"),
      color: "positive",
      position: "bottom",
      timeout: 3000,
    });
  } catch (e: any) {
    q.notify({
      message: e?.message || t("settings.somethingWentWrong"),
      color: "negative",
      position: "bottom",
      timeout: 3000,
    });
  } finally {
    isSaving.value = false;
  }
};
</script>

<style scoped>
:deep(.ai-sub-feature-disabled),
:deep(.ai-sub-feature-disabled *) {
  cursor: default !important;
}
</style>
