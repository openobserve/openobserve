<template>
  <form class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:bg-card-bg tw:border tw:border-dialog-header-border tw:rounded-md" @submit.prevent="save">
    <div class="tw:flex tw:items-center tw:gap-2.5 tw:min-h-12 tw:px-3.5 tw:py-2 tw:border-b tw:border-dialog-header-border tw:shrink-0">
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="arrow-back-ios-new"
        data-test="provider-form-back-btn"
        :title="t('onlineEvals.provider.backTo')"
        @click="$emit('cancel')"
      />
      <div class="tw:m-0 tw:text-[17px] tw:font-semibold tw:text-text-primary tw:tracking-[0.005em] tw:whitespace-nowrap">
        {{
          mode === "create"
            ? t("onlineEvals.provider.createTitle")
            : t("onlineEvals.provider.editTitle")
        }}
      </div>
      <span class="tw:text-text-secondary tw:text-xs tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:min-w-0">{{ t("onlineEvals.provider.subtitle") }}</span>
      <div class="tw:flex-1 tw:min-w-2" />
      <button
        type="button"
        class="provider-form__close tw:inline-flex tw:items-center tw:justify-center tw:w-7 tw:h-7 tw:p-0 tw:text-text-secondary tw:bg-transparent tw:border-0 tw:rounded-md tw:cursor-pointer tw:transition-[background,color] tw:duration-150 tw:hover:bg-[color-mix(in_srgb,var(--color-text-primary)_6%,transparent)] tw:hover:text-[var(--color-primary-600,#3F7994)]"
        :aria-label="t('onlineEvals.buttons.cancel')"
        data-test="provider-form-close-btn"
        @click="$emit('cancel')"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="tw:flex-1 tw:min-h-0 tw:overflow-auto tw:px-6 tw:py-4.5 [&_textarea]:tw:max-h-[220px] [&_textarea]:tw:overflow-y-auto [&_textarea]:tw:font-mono">
      <section class="tw:mb-6">
        <div class="tw:flex tw:items-center tw:gap-2.5 tw:pb-2.5 tw:border-b tw:border-dialog-header-border tw:mb-3">
          <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-[22px] tw:h-[22px] tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-text-secondary tw:font-bold tw:text-[11px] tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace]">01</span>
          <div class="tw:m-0 tw:text-sm tw:font-semibold tw:text-(--color-text-primary)">{{ t("onlineEvals.provider.sectionTitle") }}</div>
        </div>

        <div class="provider-field-row tw:grid tw:grid-cols-2 tw:gap-[14px]">
          <div class="tw:mb-3">
            <div class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.provider.nameLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-0.5">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="tw:ml-1.5 tw:text-text-secondary" />
            </div>
            <OInput
              v-model.trim="form.name"
              :placeholder="t('onlineEvals.provider.namePlaceholder')"
              size="sm"
              :disabled="mode === 'edit'"
              data-test="provider-form-name-input"
            />
            <div v-if="mode === 'edit'" class="tw:text-[11.5px] tw:text-text-secondary tw:mt-1">
              {{ t("onlineEvals.provider.cannotRename") }}
            </div>
          </div>

          <div class="tw:mb-3">
            <div class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.provider.typeLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-0.5">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="tw:ml-1.5 tw:text-text-secondary" />
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

        <div class="tw:mb-3">
          <div class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">{{ t("onlineEvals.provider.endpointLabel") }}</div>
          <OInput
            v-model.trim="form.endpoint"
            :placeholder="endpointPlaceholder"
            size="sm"
            data-test="provider-form-endpoint-input"
          />
        </div>

        <div class="provider-field-row tw:grid tw:grid-cols-2 tw:gap-[14px]">
          <div class="tw:mb-3">
            <div class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.provider.defaultModelLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-0.5">*</span>
            </div>
            <OInput
              v-model.trim="form.defaultModel"
              :placeholder="t('onlineEvals.provider.defaultModelPlaceholder')"
              size="sm"
              data-test="provider-form-default-model-input"
            />
          </div>

          <div class="tw:mb-3">
            <div class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">{{ t("onlineEvals.provider.availableModelsLabel") }}</div>
            <OInput
              v-model.trim="form.availableModels"
              :placeholder="t('onlineEvals.provider.availableModelsPlaceholder')"
              size="sm"
              data-test="provider-form-available-models-input"
            />
            <div class="tw:text-[11.5px] tw:text-text-secondary tw:mt-1">{{ t("onlineEvals.provider.availableModelsHelp") }}</div>
          </div>
        </div>

      </section>

      <section class="tw:mb-6">
        <div class="tw:flex tw:items-center tw:gap-2.5 tw:pb-2.5 tw:border-b tw:border-dialog-header-border tw:mb-3">
          <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-[22px] tw:h-[22px] tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-text-secondary tw:font-bold tw:text-[11px] tw:font-[ui-monospace,SFMono-Regular,Menlo,monospace]">02</span>
          <div class="tw:m-0 tw:text-sm tw:font-semibold tw:text-(--color-text-primary)">{{ t("onlineEvals.provider.authSection") }}</div>
        </div>

        <div v-if="mode === 'edit'" class="provider-callout tw:flex tw:gap-2 tw:items-start tw:px-3 tw:py-2 tw:mb-3 tw:bg-[color-mix(in_srgb,var(--o2-status-info-text)_12%,transparent)] tw:border tw:border-[color-mix(in_srgb,var(--o2-status-info-text)_30%,transparent)] tw:rounded-md tw:text-[11.5px] tw:text-(--color-text-primary) tw:leading-[1.4]">
          <OIcon name="lock" size="xs" class="tw:shrink-0 tw:mt-px tw:text-[var(--o2-status-info-text)]" />
          <span>{{ t("onlineEvals.provider.authEditNote") }}</span>
        </div>

        <div class="tw:mb-3">
          <div class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
            {{ t("onlineEvals.provider.apiKeyLabel") }}
            <span v-if="mode === 'create'" class="tw:text-(--o2-status-error-text) tw:ml-0.5">*</span>
          </div>
          <OInput
            v-model.trim="form.apiKey"
            type="password"
            size="sm"
            :placeholder="t('onlineEvals.provider.apiKeyPlaceholder')"
            data-test="provider-form-api-key-input"
          />
          <div class="tw:text-[11.5px] tw:text-text-secondary tw:mt-1">{{ t("onlineEvals.provider.apiKeyHelp") }}</div>
        </div>
      </section>
    </div>

    <footer class="tw:sticky tw:bottom-0 tw:flex tw:items-center tw:justify-end tw:gap-2 tw:px-5.5 tw:py-3 tw:border-t tw:border-dialog-header-border tw:bg-card-bg tw:shrink-0 tw:z-1">
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
