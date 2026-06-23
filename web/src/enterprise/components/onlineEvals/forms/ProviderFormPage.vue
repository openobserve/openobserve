<template>
  <form class="provider-form" @submit.prevent="save">
    <div class="provider-form__top">
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="arrow-back-ios-new"
        data-test="provider-form-back-btn"
        :title="t('onlineEvals.provider.backTo')"
        @click="$emit('cancel')"
      />
      <h1 class="provider-form__title">
        {{
          mode === "create"
            ? t("onlineEvals.provider.createTitle")
            : t("onlineEvals.provider.editTitle")
        }}
      </h1>
      <span class="provider-form__subtitle">{{ t("onlineEvals.provider.subtitle") }}</span>
      <div class="provider-form__top-spacer" />
      <button
        type="button"
        class="provider-form__close"
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

    <div class="provider-form__body">
      <section class="provider-section">
        <div class="provider-section__head">
          <span class="provider-section__num">01</span>
          <h3 class="provider-section__title">{{ t("onlineEvals.provider.sectionTitle") }}</h3>
        </div>

        <div class="provider-field-row">
          <div class="provider-field">
            <label class="provider-field__label">
              {{ t("onlineEvals.provider.nameLabel") }}
              <span class="provider-field__req">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="provider-field__lock" />
            </label>
            <OInput
              v-model.trim="form.name"
              :placeholder="t('onlineEvals.provider.namePlaceholder')"
              size="sm"
              :disabled="mode === 'edit'"
              data-test="provider-form-name-input"
            />
            <div v-if="mode === 'edit'" class="provider-field__help">
              {{ t("onlineEvals.provider.cannotRename") }}
            </div>
          </div>

          <div class="provider-field">
            <label class="provider-field__label">
              {{ t("onlineEvals.provider.typeLabel") }}
              <span class="provider-field__req">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="provider-field__lock" />
            </label>
            <OSelect
              v-model="form.providerType"
              :options="providerTypeOptions"
              size="md"
              :disabled="mode === 'edit'"
              data-test="provider-form-type-select"
            />
          </div>
        </div>

        <div class="provider-field">
          <label class="provider-field__label">{{ t("onlineEvals.provider.endpointLabel") }}</label>
          <OInput
            v-model.trim="form.endpoint"
            :placeholder="t('onlineEvals.provider.endpointPlaceholder')"
            size="sm"
            data-test="provider-form-endpoint-input"
          />
        </div>

        <div class="provider-field-row">
          <div class="provider-field">
            <label class="provider-field__label">
              {{ t("onlineEvals.provider.defaultModelLabel") }}
              <span class="provider-field__req">*</span>
            </label>
            <OInput
              v-model.trim="form.defaultModel"
              :placeholder="t('onlineEvals.provider.defaultModelPlaceholder')"
              size="sm"
              data-test="provider-form-default-model-input"
            />
          </div>

          <div class="provider-field">
            <label class="provider-field__label">{{ t("onlineEvals.provider.availableModelsLabel") }}</label>
            <OInput
              v-model.trim="form.availableModels"
              :placeholder="t('onlineEvals.provider.availableModelsPlaceholder')"
              size="sm"
              data-test="provider-form-available-models-input"
            />
            <div class="provider-field__help">{{ t("onlineEvals.provider.availableModelsHelp") }}</div>
          </div>
        </div>

      </section>

      <section class="provider-section">
        <div class="provider-section__head">
          <span class="provider-section__num">02</span>
          <h3 class="provider-section__title">{{ t("onlineEvals.provider.authSection") }}</h3>
        </div>

        <div v-if="mode === 'edit'" class="provider-callout">
          <OIcon name="lock" size="xs" />
          <span>{{ t("onlineEvals.provider.authEditNote") }}</span>
        </div>

        <div class="provider-field">
          <label class="provider-field__label">
            {{ t("onlineEvals.provider.apiKeyLabel") }}
            <span v-if="mode === 'create'" class="provider-field__req">*</span>
          </label>
          <OInput
            v-model.trim="form.apiKey"
            type="password"
            size="sm"
            :placeholder="t('onlineEvals.provider.apiKeyPlaceholder')"
            data-test="provider-form-api-key-input"
          />
          <div class="provider-field__help">{{ t("onlineEvals.provider.apiKeyHelp") }}</div>
        </div>
      </section>
    </div>

    <footer class="provider-form__foot">
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
  { label: "Anthropic", value: "anthropic" },
  { label: "Azure OpenAI", value: "azure_openai" },
  { label: "Ollama", value: "ollama" },
  { label: "vLLM", value: "vllm" },
  { label: "OpenAI-compatible", value: "openai_compatible" },
  { label: "Other", value: "other" },
]);

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

<style lang="scss" scoped>
.provider-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  background: var(--color-card-bg);
  border: 1px solid var(--color-dialog-header-border, var(--o2-border));
  border-radius: 6px;
}

.provider-form__top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  flex-shrink: 0;
}

.provider-form__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  letter-spacing: 0.005em;
  white-space: nowrap;
}

.provider-form__subtitle {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.provider-form__top-spacer {
  flex: 1;
  min-width: 8px;
}

.provider-form__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.provider-form__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  color: var(--color-primary-600, #3F7994);
}

.provider-form__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 24px 24px;
}

.provider-form__foot {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 22px;
  border-top: 1px solid var(--color-dialog-header-border, var(--o2-border));
  background: var(--color-card-bg);
  flex-shrink: 0;
  z-index: 1;
}

.provider-form__body :deep(textarea) {
  max-height: 220px;
  overflow-y: auto;
}

.provider-section {
  margin-bottom: 24px;
}

.provider-section__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  margin-bottom: 12px;
}

.provider-section__num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-weight: 700;
  font-size: 11px;
}

.provider-section__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.provider-field {
  margin-bottom: 12px;
}

.provider-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.provider-field__label {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  margin-bottom: 4px;
}

.provider-field__req {
  color: var(--o2-status-error-text);
  margin-left: 2px;
}

.provider-field__lock {
  margin-left: 6px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.provider-field__help {
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-top: 4px;
}

.provider-callout {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: color-mix(in srgb, var(--o2-status-info-text) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--o2-status-info-text) 30%, transparent);
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--color-text-primary, currentColor);
  line-height: 1.4;
}

.provider-callout > :first-child {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--o2-status-info-text);
}

@media (max-width: 900px) {
  .provider-field-row {
    grid-template-columns: 1fr;
  }
}
</style>
