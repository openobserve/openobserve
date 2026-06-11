<template>
  <div
    data-test="gen-ai-agent-mapping-settings"
    class="tw:flex tw:flex-col tw:h-full tw:min-h-0"
  >
    <div
      class="tw:flex tw:flex-col tw:gap-1 tw:px-4 tw:py-4 tw:border-b-[1px] tw:border-[var(--color-dialog-header-border,var(--o2-border))]"
    >
      <div class="tw:flex tw:items-start tw:justify-between tw:gap-3">
        <div>
          <div class="tw:text-xl tw:tracking-[0.005em] tw:font-[600]">
            {{ t("settings.genAiAgentMapping.title") }}
          </div>
          <div class="tw:text-sm tw:text-[var(--o2-text-secondary)] tw:mt-1">
            {{ t("settings.genAiAgentMapping.description") }}
          </div>
        </div>
        <div class="tw:flex tw:items-center tw:gap-2 tw:shrink-0">
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
            data-test="gen-ai-agent-mapping-save-btn"
            variant="primary"
            size="sm"
            :loading="saving"
            @click="saveConfig"
          >
            {{ t("common.save") }}
          </OButton>
        </div>
      </div>
    </div>

    <div v-if="loading" class="tw:flex tw:flex-1 tw:items-center tw:justify-center">
      <OSpinner size="md" />
    </div>

    <div v-else class="tw:flex-1 tw:min-h-0 tw:overflow-auto tw:p-4">
      <div
        class="tw:mb-4 tw:rounded-lg tw:border tw:border-solid tw:border-[var(--o2-border)] tw:bg-[var(--o2-card-bg)] tw:p-4"
      >
        <div class="tw:text-sm tw:font-semibold tw:mb-1">
          {{ t("settings.genAiAgentMapping.howItWorksTitle") }}
        </div>
        <div class="tw:text-sm tw:text-[var(--o2-text-secondary)] tw:leading-6">
          {{ t("settings.genAiAgentMapping.howItWorksDescription") }}
        </div>
      </div>

      <div class="tw:grid tw:grid-cols-1 lg:tw:grid-cols-2 tw:gap-4">
        <section class="mapping-card">
          <div class="tw:font-semibold tw:mb-1">
            {{ t("settings.genAiAgentMapping.agentNameFields") }}
          </div>
          <div class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:mb-3">
            {{ t("settings.genAiAgentMapping.agentNameHelp") }}
          </div>
          <textarea
            v-model="agentNameText"
            data-test="gen-ai-agent-name-fields-input"
            class="mapping-textarea"
            spellcheck="false"
            :placeholder="t('settings.genAiAgentMapping.fieldsPlaceholder')"
          />
        </section>

        <section class="mapping-card">
          <div class="tw:font-semibold tw:mb-1">
            {{ t("settings.genAiAgentMapping.agentIdFields") }}
          </div>
          <div class="tw:text-xs tw:text-[var(--o2-text-secondary)] tw:mb-3">
            {{ t("settings.genAiAgentMapping.agentIdHelp") }}
          </div>
          <textarea
            v-model="agentIdText"
            data-test="gen-ai-agent-id-fields-input"
            class="mapping-textarea"
            spellcheck="false"
            :placeholder="t('settings.genAiAgentMapping.fieldsPlaceholder')"
          />
        </section>
      </div>

      <div class="tw:flex tw:items-center tw:justify-between tw:gap-3 tw:mt-4">
        <div class="tw:text-xs tw:text-[var(--o2-text-secondary)]">
          {{ t("settings.genAiAgentMapping.defaultsSource") }}
        </div>
        <OButton
          data-test="gen-ai-agent-mapping-reset-empty-btn"
          variant="outline"
          size="sm"
          @click="resetToEmpty"
        >
          {{ t("settings.genAiAgentMapping.resetToEmpty") }}
        </OButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
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

<style scoped lang="scss">
.mapping-card {
  border: 1px solid var(--o2-border);
  border-radius: 8px;
  background: var(--o2-card-bg);
  padding: 16px;
}

.mapping-textarea {
  width: 100%;
  min-height: 220px;
  resize: vertical;
  border: 1px solid var(--o2-border);
  border-radius: 6px;
  background: var(--o2-input-bg, var(--o2-card-bg));
  color: var(--o2-text-primary);
  font-family: var(--font-mono, monospace);
  font-size: 13px;
  line-height: 20px;
  padding: 10px 12px;
  outline: none;
}

.mapping-textarea:focus {
  border-color: var(--o2-primary);
}
</style>
