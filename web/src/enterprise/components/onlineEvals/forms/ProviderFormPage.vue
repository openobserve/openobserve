<template>
  <form class="flex flex-col flex-1 min-h-0 bg-card-bg" @submit.prevent="save">
    <AppPageHeader
      :subtitle="t('onlineEvals.provider.subtitle')"
      :back="{
        label: t('onlineEvals.provider.backTo'),
        onClick: () => $emit('cancel'),
        dataTest: 'provider-form-back-btn',
      }"
      class="px-3 border-b border-border-default"
      style="flex-shrink: 0"
    >
      <template #title>
        <span data-test="provider-form-title">
          {{ mode === "create" ? t("onlineEvals.provider.createTitle") : t("onlineEvals.provider.editTitle") }}
        </span>
      </template>
    </AppPageHeader>

    <div class="flex-1 min-h-0 overflow-auto px-6 py-4.5 [&_textarea]:max-h-[220px] [&_textarea]:overflow-y-auto [&_textarea]:font-mono">
      <section class="mb-6">
        <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
          <span class="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-[11px] font-[ui-monospace,SFMono-Regular,Menlo,monospace]">01</span>
          <div class="m-0 text-sm font-semibold text-(--color-text-primary)">{{ t("onlineEvals.provider.sectionTitle") }}</div>
        </div>

        <div class="provider-field-row grid grid-cols-2 gap-[14px]">
          <div class="mb-3">
            <div class="flex items-center text-xs font-semibold text-(--color-text-primary) mb-1">
              {{ t("onlineEvals.provider.nameLabel") }}
              <span class="text-(--color-status-error-text) ml-0.5">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-text-secondary" />
            </div>
            <OInput
              v-model.trim="form.name"
              :placeholder="t('onlineEvals.provider.namePlaceholder')"
              size="sm"
              :disabled="mode === 'edit'"
              data-test="provider-form-name-input"
            />
            <div v-if="mode === 'edit'" class="text-[11.5px] text-text-secondary mt-1">
              {{ t("onlineEvals.provider.cannotRename") }}
            </div>
          </div>

          <div class="mb-3">
            <div class="flex items-center text-xs font-semibold text-(--color-text-primary) mb-1">
              {{ t("onlineEvals.provider.typeLabel") }}
              <span class="text-(--color-status-error-text) ml-0.5">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-text-secondary" />
            </div>
            <OSelect
              v-model="form.providerType"
              :options="providerTypeOptions"
              size="md"
              :disabled="mode === 'edit'"
              data-test="provider-form-type-select"
            />
          </div>
        </div>

        <div class="mb-3">
          <div class="flex items-center text-xs font-semibold text-(--color-text-primary) mb-1">{{ t("onlineEvals.provider.endpointLabel") }}</div>
          <OInput
            v-model.trim="form.endpoint"
            :placeholder="endpointPlaceholder"
            size="sm"
            data-test="provider-form-endpoint-input"
          />
        </div>

        <div class="provider-field-row grid grid-cols-2 gap-[14px]">
          <div class="mb-3">
            <div class="flex items-center text-xs font-semibold text-(--color-text-primary) mb-1">
              {{ t("onlineEvals.provider.defaultModelLabel") }}
              <span class="text-(--color-status-error-text) ml-0.5">*</span>
            </div>
            <OInput
              v-model.trim="form.defaultModel"
              :placeholder="t('onlineEvals.provider.defaultModelPlaceholder')"
              size="sm"
              data-test="provider-form-default-model-input"
            />
          </div>

          <div class="mb-3">
            <div class="flex items-center text-xs font-semibold text-(--color-text-primary) mb-1">{{ t("onlineEvals.provider.availableModelsLabel") }}</div>
            <OInput
              v-model.trim="form.availableModels"
              :placeholder="t('onlineEvals.provider.availableModelsPlaceholder')"
              size="sm"
              data-test="provider-form-available-models-input"
            />
            <div class="text-[11.5px] text-text-secondary mt-1">{{ t("onlineEvals.provider.availableModelsHelp") }}</div>
          </div>
        </div>

      </section>

      <section class="mb-6">
        <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
          <span class="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-[11px] font-[ui-monospace,SFMono-Regular,Menlo,monospace]">02</span>
          <div class="m-0 text-sm font-semibold text-(--color-text-primary)">{{ t("onlineEvals.provider.authSection") }}</div>
        </div>

        <div v-if="mode === 'edit'" class="provider-callout flex gap-2 items-start px-3 py-2 mb-3 bg-[color-mix(in_srgb,var(--o2-status-info-text)_12%,transparent)] border border-[color-mix(in_srgb,var(--o2-status-info-text)_30%,transparent)] rounded-md text-[11.5px] text-(--color-text-primary) leading-[1.4]">
          <OIcon name="lock" size="xs" class="shrink-0 mt-px text-[var(--o2-status-info-text)]" />
          <span>{{ t("onlineEvals.provider.authEditNote") }}</span>
        </div>

        <div class="mb-3">
          <div class="flex items-center text-xs font-semibold text-(--color-text-primary) mb-1">
            {{ t("onlineEvals.provider.apiKeyLabel") }}
            <span v-if="mode === 'create'" class="text-(--color-status-error-text) ml-0.5">*</span>
          </div>
          <OInput
            v-model.trim="form.apiKey"
            type="password"
            size="sm"
            :placeholder="t('onlineEvals.provider.apiKeyPlaceholder')"
            data-test="provider-form-api-key-input"
          />
          <div class="text-[11.5px] text-text-secondary mt-1">{{ t("onlineEvals.provider.apiKeyHelp") }}</div>
        </div>
      </section>
    </div>

    <footer class="sticky bottom-0 flex items-center justify-end gap-2 px-5.5 py-3 border-t border-dialog-header-border bg-card-bg shrink-0 z-1">
      <OButton
        data-test="provider-form-cancel-btn"
        type="button"
        variant="outline"
        size="sm-action"
        @click="$emit('cancel')"
      >
        {{ t("onlineEvals.buttons.cancel") }}
      </OButton>
      <OButton
        data-test="provider-form-save-btn"
        type="submit"
        variant="primary"
        size="sm-action"
        :loading="isSaving"
      >
        {{ mode === "create" ? t("onlineEvals.buttons.create") : t("onlineEvals.buttons.save") }}
      </OButton>
    </footer>
  </form>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, { type Provider } from "@/services/online-evals.service";
import {
  availableModelsOf,
  booleanOf,
  defaultModelOf,
  providerTypeOf,
} from "../utils/evalEntity";
import { showError, splitCsv } from "../utils/evalFormat";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: Provider | null;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18n();
const form = ref(initForm(props.row));
const isSaving = ref(false);

const providerTypeOptions = computed(() => [
  { label: "OpenAI", value: "openai" },
  { label: "DeepSeek", value: "deepseek" },
  { label: "Anthropic", value: "anthropic" },
  { label: "Azure OpenAI", value: "azure_openai" },
  { label: "Ollama", value: "ollama" },
  { label: "vLLM", value: "vllm" },
  { label: "OpenAI-compatible", value: "openai_compatible" },
  { label: "Other", value: "other" },
]);

// Default API endpoint for each provider type, shown as a placeholder to hint
// the expected URL. Providers without a canonical public endpoint (self-hosted
// or generic) fall back to the static i18n placeholder.
const DEFAULT_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  azure_openai: "https://{resource}.openai.azure.com/openai/deployments/{deployment}",
  ollama: "http://localhost:11434/v1",
  vllm: "http://localhost:8000/v1",
};

const endpointPlaceholder = computed(
  () =>
    DEFAULT_ENDPOINTS[form.value.providerType] ||
    t("onlineEvals.provider.endpointPlaceholder"),
);

function initForm(row: Provider | null) {
  if (!row) {
    return {
      name: "",
      providerType: "openai",
      endpoint: "",
      defaultModel: "",
      availableModels: "",
      apiKey: "",
    };
  }
  return {
    name: row.name,
    providerType: providerTypeOf(row) || "openai",
    endpoint: row.endpoint || "",
    defaultModel: defaultModelOf(row),
    availableModels: availableModelsOf(row).join(", "),
    // Auth is write-only — never seed the existing secret. The user
    // leaves the field blank to keep the stored value, or enters a new
    // one to rotate it.
    apiKey: "",
  };
}

async function save() {
  if (!props.orgId) return;
  isSaving.value = true;
  try {
    const payload = {
      name: form.value.name,
      providerType: form.value.providerType,
      endpoint: form.value.endpoint || null,
      defaultModel: form.value.defaultModel,
      availableModels: splitCsv(form.value.availableModels),
      // Backend expects an authConfig object; the form only collects an
      // API key, which is the only auth secret the supported providers
      // need today. Wrap it as { api_key: <value> }.
      authConfig: { api_key: form.value.apiKey },
      // `isDefault` is no longer surfaced in the form. Always send false;
      // backend defaults to non-default and the user manages default-ness
      // (if ever needed) outside this create/edit flow.
      isDefault: false,
    };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.providers.update(props.orgId, props.row.id, payload);
    } else {
      await onlineEvalsService.providers.create(props.orgId, payload);
    }
    toast({
      variant: "success",
      message: t("onlineEvals.saved", { label: t("onlineEvals.singular.providers") }),
    });
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.provider.saveError"));
  } finally {
    isSaving.value = false;
  }
}
</script>

<style>
@media (max-width: 900px) {
  .provider-field-row {
    grid-template-columns: 1fr;
  }
}
</style>
