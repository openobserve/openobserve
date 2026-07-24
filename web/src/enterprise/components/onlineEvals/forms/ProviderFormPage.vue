<template>
  <OForm
    class="flex flex-col flex-1 min-h-0 bg-card-bg"
    :form="form"
    v-slot="{ isSubmitting }"
  >
    <OPageLayout
      :subtitle="t('onlineEvals.provider.subtitle')"
      :back="{
        label: t('onlineEvals.provider.backTo'),
        onClick: () => $emit('cancel'),
        dataTest: 'provider-form-back-btn',
      }"
      scroll
    >
      <template #title>
        <span data-test="provider-form-title">
          {{ mode === "create" ? t("onlineEvals.provider.createTitle") : t("onlineEvals.provider.editTitle") }}
        </span>
      </template>
    <div class="py-4.5 [&_textarea]:max-h-55 [&_textarea]:overflow-y-auto [&_textarea]:font-mono">
      <section class="mb-6">
        <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
          <span class="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-2xs font-mono">01</span>
          <div class="m-0 text-sm font-semibold text-text-heading">{{ t("onlineEvals.provider.sectionTitle") }}</div>
        </div>

        <div class="grid grid-cols-2 max-[56.25rem]:grid-cols-1 gap-3.5">
          <div class="mb-3">
            <div class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.provider.nameLabel") }}
              <span class="text-status-error-text ml-0.5">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-text-secondary" />
            </div>
            <OFormInput
              name="name"
              :placeholder="t('onlineEvals.provider.namePlaceholder')"
              size="sm"
              :disabled="mode === 'edit'"
              data-test="provider-form-name-input"
            />
            <div v-if="mode === 'edit'" class="text-2xs text-text-secondary mt-1">
              {{ t("onlineEvals.provider.cannotRename") }}
            </div>
          </div>

          <div class="mb-3">
            <div class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.provider.typeLabel") }}
              <span class="text-status-error-text ml-0.5">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-text-secondary" />
            </div>
            <OFormSelect
              name="providerType"
              :options="providerTypeOptions"
              size="md"
              :disabled="mode === 'edit'"
              data-test="provider-form-type-select"
            />
          </div>
        </div>

        <div class="mb-3">
          <div class="flex items-center text-xs font-semibold text-text-heading mb-1">{{ t("onlineEvals.provider.endpointLabel") }}</div>
          <OFormInput
            name="endpoint"
            :placeholder="endpointPlaceholder"
            size="sm"
            data-test="provider-form-endpoint-input"
          />
        </div>

        <div class="grid grid-cols-2 max-[56.25rem]:grid-cols-1 gap-3.5">
          <div class="mb-3">
            <div class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.provider.defaultModelLabel") }}
              <span class="text-status-error-text ml-0.5">*</span>
            </div>
            <OFormInput
              name="defaultModel"
              :placeholder="t('onlineEvals.provider.defaultModelPlaceholder')"
              size="sm"
              data-test="provider-form-default-model-input"
            />
          </div>

          <div class="mb-3">
            <div class="flex items-center text-xs font-semibold text-text-heading mb-1">{{ t("onlineEvals.provider.availableModelsLabel") }}</div>
            <OFormInput
              name="availableModels"
              :placeholder="t('onlineEvals.provider.availableModelsPlaceholder')"
              size="sm"
              data-test="provider-form-available-models-input"
            />
            <div class="text-2xs text-text-secondary mt-1">{{ t("onlineEvals.provider.availableModelsHelp") }}</div>
          </div>
        </div>

      </section>

      <section class="mb-6">
        <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
          <span class="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-2xs font-mono">02</span>
          <div class="m-0 text-sm font-semibold text-text-heading">{{ t("onlineEvals.provider.authSection") }}</div>
        </div>

        <div v-if="mode === 'edit'" class="provider-callout flex gap-2 items-start px-3 py-2 mb-3 bg-[color-mix(in_srgb,var(--color-status-info-text)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-status-info-text)_30%,transparent)] rounded-default text-2xs text-text-secondary leading-[1.4]">
          <OIcon name="lock" size="xs" class="shrink-0 mt-px text-status-info-text" />
          <span>{{ t("onlineEvals.provider.authEditNote") }}</span>
        </div>

        <div class="mb-3">
          <div class="flex items-center text-xs font-semibold text-text-heading mb-1">
            {{ t("onlineEvals.provider.apiKeyLabel") }}
            <span v-if="mode === 'create'" class="text-status-error-text ml-0.5">*</span>
          </div>
          <OFormInput
            name="apiKey"
            type="password"
            size="sm"
            :placeholder="t('onlineEvals.provider.apiKeyPlaceholder')"
            data-test="provider-form-api-key-input"
          />
          <div class="text-2xs text-text-secondary mt-1">{{ t("onlineEvals.provider.apiKeyHelp") }}</div>
        </div>
      </section>
    </div>

    <footer class="sticky bottom-0 flex items-center justify-end gap-2 px-5.5 py-3 border-t border-dialog-header-border bg-card-bg shrink-0 z-1">
      <OButton
        data-test="provider-form-cancel-btn"
        type="button"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="$emit('cancel')"
      >
        {{ t("onlineEvals.buttons.cancel") }}
      </OButton>
      <OButton
        data-test="provider-form-save-btn"
        type="submit"
        variant="primary"
        size="sm-action"
        :loading="isSubmitting"
      >
        {{ t("onlineEvals.buttons.save") }}
      </OButton>
    </footer>
    </OPageLayout>
  </OForm>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, { type Provider } from "@/services/online-evals.service";
import {
  availableModelsOf,
  defaultModelOf,
  providerTypeOf,
} from "../utils/evalEntity";
import { showError, splitCsv } from "../utils/evalFormat";
import {
  makeProviderFormSchema,
  type ProviderForm,
} from "./ProviderFormPage.schema";

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

// Co-located Zod schema (factory keeps messages i18n-driven). apiKey is optional
// in both modes.
const providerFormSchema = makeProviderFormSchema(t);

// Headless OForm instance (matches ScorerFormPage): created here so the endpoint
// placeholder can read the selected providerType reactively via form.useStore.
// DYNAMIC (edit-prefill) defaults seed the form once at mount: blank for create,
// the existing record for edit (auth is write-only → apiKey always seeds blank).
const form = useOForm<ProviderForm>({
  defaultValues: initForm(props.row),
  schema: providerFormSchema,
  onSubmit: save,
});
const formValues = form.useStore((s: any) => s.values as ProviderForm);

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
    DEFAULT_ENDPOINTS[formValues.value.providerType] ||
    t("onlineEvals.provider.endpointPlaceholder"),
);

function initForm(row: Provider | null): ProviderForm {
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

// @submit handler — OForm only calls this once the whole schema passes, so the
// schema (not a manual guard) gates the save. `value` carries the RAW field
// values (the schema validates but does not transform), so trim/split here.
// OForm awaits this promise → the Save button spinner spans the whole save
// (no manual `isSaving` ref).
async function save(value: ProviderForm) {
  if (!props.orgId) return;
  try {
    const payload = {
      name: value.name.trim(),
      providerType: value.providerType,
      endpoint: value.endpoint.trim() || null,
      defaultModel: value.defaultModel.trim(),
      availableModels: splitCsv(value.availableModels),
      // Backend expects an authConfig object; the form only collects an
      // API key, which is the only auth secret the supported providers
      // need today. Wrap it as { api_key: <value> }. Trim it — a pasted key
      // with trailing whitespace/newline must not be sent verbatim.
      authConfig: { api_key: value.apiKey.trim() },
      // `isDefault` is not surfaced in the form. Always send false;
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
  }
}
</script>
