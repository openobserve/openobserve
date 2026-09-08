<template>
  <OForm class="bg-card-bg flex min-h-0 flex-1 flex-col" :form="form" v-slot="{ isSubmitting }">
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
          {{
            mode === "create"
              ? t("onlineEvals.provider.createTitle")
              : t("onlineEvals.provider.editTitle")
          }}
        </span>
      </template>
      <div class="provider-form__main flex min-h-0 flex-col gap-2 p-2">
        <!-- Provider details -->
        <section
          class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
          data-test="provider-form-identity-section"
        >
          <div class="border-border-default flex items-center border-b px-3 py-2.5">
            <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
            <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">{{
              t("onlineEvals.provider.sectionTitle")
            }}</span>
          </div>
          <div class="flex flex-col gap-3 px-4 py-3.5">
            <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <div>
                <OFormInput
                  name="name"
                  :label="t('onlineEvals.provider.nameLabel')"
                  :placeholder="raw('Production OpenAI')"
                  size="sm"
                  required
                  :disabled="mode === 'edit'"
                  :help-text="mode === 'edit' ? t('onlineEvals.provider.cannotRename') : undefined"
                  data-test="provider-form-name-input"
                />
              </div>

              <div>
                <OFormSelect
                  name="providerType"
                  :label="t('onlineEvals.provider.typeLabel')"
                  :options="providerTypeOptions"
                  size="md"
                  required
                  :disabled="mode === 'edit'"
                  data-test="provider-form-type-select"
                />
              </div>
            </div>

            <div>
              <OFormInput
                name="endpoint"
                :label="t('onlineEvals.provider.endpointLabel')"
                :placeholder="raw(endpointPlaceholder)"
                size="sm"
                data-test="provider-form-endpoint-input"
              />
            </div>

            <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
              <div>
                <OFormInput
                  name="defaultModel"
                  :label="t('onlineEvals.provider.defaultModelLabel')"
                  :placeholder="raw('gpt-4o-mini')"
                  size="sm"
                  required
                  data-test="provider-form-default-model-input"
                />
              </div>

              <div>
                <OFormInput
                  name="availableModels"
                  :label="t('onlineEvals.provider.availableModelsLabel')"
                  :placeholder="raw('gpt-4o-mini, gpt-4.1')"
                  size="sm"
                  :help-text="t('onlineEvals.provider.availableModelsHelp')"
                  data-test="provider-form-available-models-input"
                />
              </div>
            </div>
          </div>
        </section>

        <!-- Authentication -->
        <section
          class="card-container rounded-default border-border-default bg-surface-base shrink-0 overflow-hidden border"
          data-test="provider-form-auth-section"
        >
          <div class="border-border-default flex items-center border-b px-3 py-2.5">
            <div class="rounded-default bg-theme-accent me-2 h-4 w-0.75 shrink-0" />
            <span class="text-compact text-text-heading font-semibold tracking-[0.01em]">{{
              t("onlineEvals.provider.authSection")
            }}</span>
          </div>
          <div class="flex flex-col gap-3 px-4 py-3.5">
            <div
              v-if="mode === 'edit'"
              class="rounded-default text-2xs text-text-secondary border-status-info-text/30 bg-status-info-text/12 flex items-start gap-2 border px-3 py-2 leading-[1.4]"
            >
              <OIcon name="lock" size="xs" class="text-status-info-text mt-px shrink-0" />
              <span>{{ t("onlineEvals.provider.authEditNote") }}</span>
            </div>

            <div>
              <OFormInput
                name="apiKey"
                type="password"
                :label="t('onlineEvals.provider.apiKeyLabel')"
                :required="mode === 'create' && apiKeyRequired"
                size="sm"
                :placeholder="t('onlineEvals.provider.apiKeyPlaceholder')"
                :help-text="t('onlineEvals.provider.apiKeyHelp')"
                data-test="provider-form-api-key-input"
              />
            </div>
          </div>
        </section>
      </div>

      <footer
        class="border-border-default bg-surface-base sticky bottom-0 z-1 flex shrink-0 items-center justify-end gap-2 border-t px-5.5 py-3"
      >
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
import { raw, useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, { type Provider } from "@/services/online-evals.service";
import { availableModelsOf, defaultModelOf, providerTypeOf } from "../utils/evalEntity";
import { showError, splitCsv } from "../utils/evalFormat";
import { makeProviderFormSchema, type ProviderForm } from "./ProviderFormPage.schema";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: Provider | null;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
}>();

const { t } = useI18nTyped();

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
const apiKeyRequired = computed(() =>
  ["openai", "deepseek", "anthropic"].includes(formValues.value.providerType),
);

const providerTypeOptions = computed(() => [
  { label: raw("OpenAI"), value: "openai" },
  { label: raw("DeepSeek"), value: "deepseek" },
  { label: raw("Anthropic"), value: "anthropic" },
  { label: raw("Azure OpenAI"), value: "azure_openai" },
  { label: raw("Ollama"), value: "ollama" },
  { label: raw("vLLM"), value: "vllm" },
  { label: raw("OpenAI-compatible"), value: "openai_compatible" },
  { label: t("ingestion.otherLabel"), value: "other" },
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
