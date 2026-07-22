<template>
  <OPageLayout
    data-test="gen-ai-agent-mapping-settings"
    :subtitle="t('settings.genAiAgentMapping.description')"
    icon="smart-toy"
    bleed
  >
    <template #title>
      <span data-test="gen-ai-agent-mapping-page-title">{{
        t("settings.genAiAgentMapping.title")
      }}</span>
    </template>
    <!-- Content helpers (populate / clear the fields) live in the header,
           separate from the primary Save action at the bottom. -->
    <template #actions>
      <OButton
        data-test="gen-ai-agent-mapping-apply-defaults-btn"
        variant="outline"
        size="sm"
        :loading="loadingDefaults"
        @click="applyDefaults"
      >
        {{ t("settings.genAiAgentMapping.applyDefaults") }}
      </OButton>
      <OButton
        data-test="gen-ai-agent-mapping-reset-empty-btn"
        variant="outline"
        size="sm"
        @click="resetToEmpty"
      >
        {{ t("settings.genAiAgentMapping.resetToEmpty") }}
      </OButton>
      <OButton
        data-test="gen-ai-agent-registry-clear-btn"
        variant="outline-destructive"
        size="sm"
        :loading="clearingRegistry"
        :disabled="loading || loadingDefaults || saving"
        @click="openClearRegistryDialog"
      >
        {{ t("settings.genAiAgentMapping.clearRegistry") }}
      </OButton>
    </template>

    <div v-if="loading" class="flex flex-1 items-center justify-center">
      <OSpinner size="md" />
    </div>

    <template v-else>
      <!-- Scrollable form body -->
      <div class="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div class="grid grid-cols-1 gap-5">
          <OTextarea
            v-model="agentNameText"
            :label="t('settings.genAiAgentMapping.agentNameFields')"
            :help-text="t('settings.genAiAgentMapping.agentNameHelp')"
            :placeholder="t('settings.genAiAgentMapping.fieldsPlaceholder')"
            :rows="10"
            spellcheck="false"
            data-test="gen-ai-agent-name-fields-input"
          >
            <template #tooltip>
              <OTooltip :content="t('settings.genAiAgentMapping.agentNameInfo')" />
            </template>
          </OTextarea>
          <OTextarea
            v-model="agentIdText"
            :label="t('settings.genAiAgentMapping.agentIdFields')"
            :help-text="t('settings.genAiAgentMapping.agentIdHelp')"
            :placeholder="t('settings.genAiAgentMapping.fieldsPlaceholder')"
            :rows="10"
            spellcheck="false"
            data-test="gen-ai-agent-id-fields-input"
          >
            <template #tooltip>
              <OTooltip :content="t('settings.genAiAgentMapping.agentIdInfo')" />
            </template>
          </OTextarea>
        </div>
      </div>

      <!-- Sticky footer action bar (mirrors AddAlert): primary Save pinned at
           the bottom-right while the body scrolls. -->
      <div
        class="flex items-center justify-end gap-2 shrink-0 px-4 py-2.5 border-t border-border-default"
      >
        <OButton
          data-test="gen-ai-agent-mapping-save-btn"
          variant="primary"
          size="sm-action"
          :loading="saving"
          @click="saveConfig"
        >
          {{ t("common.save") }}
        </OButton>
      </div>
    </template>

    <ODialog
      v-model:open="clearRegistryDialogOpen"
      data-test="gen-ai-agent-registry-clear-dialog"
      size="sm"
      :title="t('settings.genAiAgentMapping.clearRegistryTitle')"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('settings.genAiAgentMapping.clearRegistryConfirm')"
      primary-button-variant="destructive"
      :primary-button-loading="clearingRegistry"
      @click:secondary="clearRegistryDialogOpen = false"
      @click:primary="clearAgentRegistry"
    >
      <p class="text-sm text-text-body">
        {{ t("settings.genAiAgentMapping.clearRegistryDescription") }}
      </p>
    </ODialog>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import genAiAgentMappingService, {
  fetchDefaultGenAiAgentMapping,
  type GenAiAgentMappingConfig,
} from "@/services/gen-ai-agent-mapping.service";

const { t } = useI18n();
const store = useStore();

const loading = ref(false);
const loadingDefaults = ref(false);
const saving = ref(false);
const clearingRegistry = ref(false);
const clearRegistryDialogOpen = ref(false);
const agentNameText = ref("");
const agentIdText = ref("");

const orgId = computed(() => store.state.selectedOrganization?.identifier);

const fieldsToText = (fields: string[]) => fields.join("\n");
const textToFields = (text: string) =>
  text
    .split("\n")
    .map((field) => field.trim())
    .filter(Boolean);

const setDraft = (config: GenAiAgentMappingConfig) => {
  agentNameText.value = fieldsToText(config.agent_name_fields);
  agentIdText.value = fieldsToText(config.agent_id_fields);
};

const draftConfig = (): GenAiAgentMappingConfig => ({
  agent_name_fields: textToFields(agentNameText.value),
  agent_id_fields: textToFields(agentIdText.value),
});

const loadConfig = async () => {
  if (!orgId.value) return;

  loading.value = true;
  try {
    setDraft(await genAiAgentMappingService.get(orgId.value));
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.message || t("settings.genAiAgentMapping.loadFailed"),
    });
    setDraft(genAiAgentMappingService.emptyConfig());
  } finally {
    loading.value = false;
  }
};

const applyDefaults = async () => {
  loadingDefaults.value = true;
  try {
    setDraft(await fetchDefaultGenAiAgentMapping());
  } catch (error: any) {
    toast({
      variant: "error",
      message: error?.message || t("settings.genAiAgentMapping.defaultsLoadFailed"),
    });
  } finally {
    loadingDefaults.value = false;
  }
};

const resetToEmpty = () => {
  setDraft(genAiAgentMappingService.emptyConfig());
};

const openClearRegistryDialog = () => {
  clearRegistryDialogOpen.value = true;
};

const clearAgentRegistry = async () => {
  if (!orgId.value) {
    clearRegistryDialogOpen.value = false;
    return;
  }

  clearingRegistry.value = true;
  try {
    const result = await genAiAgentMappingService.clearRegistry(orgId.value);
    clearRegistryDialogOpen.value = false;
    toast({
      variant: "success",
      message: t("settings.genAiAgentMapping.clearRegistrySuccess", {
        deletedCount: result.deleted_count,
        bufferCount: result.cleared_buffer_count,
      }),
    });
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        t("settings.genAiAgentMapping.clearRegistryFailed"),
    });
  } finally {
    clearingRegistry.value = false;
  }
};

const saveConfig = async () => {
  if (!orgId.value) return;

  saving.value = true;
  try {
    const saved = await genAiAgentMappingService.save(orgId.value, draftConfig());
    setDraft(saved);
    toast({
      variant: "success",
      message: t("settings.genAiAgentMapping.saved"),
    });
  } catch (error: any) {
    toast({
      variant: "error",
      message:
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        error?.message ||
        t("settings.genAiAgentMapping.saveFailed"),
    });
  } finally {
    saving.value = false;
  }
};

onBeforeMount(loadConfig);
</script>
