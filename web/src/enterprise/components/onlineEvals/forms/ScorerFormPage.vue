<template>
  <form class="scorer-form" @submit.prevent="save">
    <div class="scorer-form__top">
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="arrow-back-ios-new"
        data-test="scorer-form-back-btn"
        :title="t('onlineEvals.scorer.backTo')"
        @click="$emit('cancel')"
      />
      <h1 class="scorer-form__title">{{ titleText }}</h1>
      <span class="scorer-form__subtitle">
        {{
          form.scorerType === "remote"
            ? t("onlineEvals.scorer.subtitleRemote")
            : t("onlineEvals.scorer.subtitleLlm")
        }}
      </span>
      <div class="scorer-form__top-spacer" />
      <span class="scorer-form__badge" :class="`scorer-form__badge--${form.scorerType}`">
        {{
          form.scorerType === "remote"
            ? t("onlineEvals.scorer.badgeRemote")
            : t("onlineEvals.scorer.badgeLlm")
        }}
      </span>
      <button
        type="button"
        class="scorer-form__close"
        :aria-label="t('onlineEvals.buttons.cancel')"
        data-test="scorer-form-close-btn"
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

    <div class="scorer-form__body">
      <div class="scorer-form__main">
        <!-- Section 01: Identity -->
        <section class="scorer-section">
          <div class="scorer-section__head">
            <span class="scorer-section__num">01</span>
            <h3 class="scorer-section__title">{{ t("onlineEvals.scorer.identitySection") }}</h3>
          </div>

          <div class="scorer-field">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.nameLabel") }}
              <span class="scorer-field__req">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="scorer-field__lock" />
            </label>
            <OInput
              v-model.trim="form.name"
              :placeholder="t('onlineEvals.scorer.namePlaceholder')"
              size="sm"
              :disabled="mode === 'edit'"
              data-test="scorer-form-name-input"
            />
          </div>

          <div class="scorer-field scorer-field--desc">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.descriptionLabel") }}
            </label>
            <OInput
              v-model.trim="form.description"
              type="textarea"
              :placeholder="t('onlineEvals.scorer.descriptionPlaceholder')"
              size="sm"
              :rows="3"
              data-test="scorer-form-description-input"
            />
          </div>

          <div class="scorer-field">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.producesScoreConfigLabel") }}
              <span class="scorer-field__req">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="scorer-field__lock" />
            </label>
            <OSelect
              v-model="form.producesScoreConfigId"
              :options="scoreConfigOptions"
              :placeholder="t('onlineEvals.scorer.producesScoreConfigNone')"
              size="md"
              :disabled="mode === 'edit'"
              data-test="scorer-form-score-config-select"
              @update:modelValue="handleScoreConfigSelection"
            />
            <div class="scorer-field__help">{{ t("onlineEvals.scorer.producesScoreHelp") }}</div>

            <div v-if="selectedScoreConfig" class="scorer-preview">
              <span class="scorer-preview__dot" />
              <span class="scorer-preview__label">
                {{ t("onlineEvals.scorer.selectedPrefix") }}
                <strong class="scorer-mono">{{ selectedScoreConfig.name }}</strong>
              </span>
              <span class="scorer-preview__sep">·</span>
              <span class="scorer-preview__meta">
                {{ t("onlineEvals.scorer.typeLabel") }}
                <span class="scorer-mono">{{ dataTypeOf(selectedScoreConfig) }}</span>
              </span>
              <template v-if="selectedRange">
                <span class="scorer-preview__sep">·</span>
                <span class="scorer-preview__meta">
                  {{ t("onlineEvals.scorer.rangeLabel") }}
                  <span class="scorer-mono">{{ selectedRange }}</span>
                </span>
              </template>
              <span class="scorer-preview__sep">·</span>
              <span class="scorer-preview__meta">
                {{ t("onlineEvals.scorer.healthyLabel") }}
                <span class="scorer-mono">{{ selectedHealthy }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Section 02: LLM Judge configuration -->
        <section v-if="form.scorerType === 'llm_judge'" class="scorer-section">
          <div class="scorer-section__head">
            <span class="scorer-section__num">02</span>
            <h3 class="scorer-section__title">{{ t("onlineEvals.scorer.judgeSection") }}</h3>
          </div>

          <div class="scorer-field">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.providerLabel") }}
              <span class="scorer-field__req">*</span>
            </label>
            <div class="scorer-field__row">
              <OSelect
                v-model="form.providerId"
                :options="providerOptions"
                :placeholder="t('onlineEvals.scorer.providerPlaceholder')"
                size="md"
                class="scorer-field__row-grow"
                data-test="scorer-form-provider-select"
              />
              <OButton
                variant="ghost"
                size="icon-md"
                icon-left="refresh"
                :loading="isRefreshingProviders"
                :title="t('onlineEvals.scorer.refreshProviders')"
                data-test="scorer-form-provider-refresh-btn"
                @click="$emit('refresh-providers')"
              />
            </div>

            <div v-if="selectedProvider" class="scorer-preview">
              <span class="scorer-preview__dot" />
              <span class="scorer-preview__meta">
                {{ t("onlineEvals.scorer.endpointLabel") }}
                <span class="scorer-mono">{{ providerEndpoint(selectedProvider) }}</span>
              </span>
              <span class="scorer-preview__sep">·</span>
              <span class="scorer-preview__meta">
                {{ t("onlineEvals.scorer.defaultModelPreviewLabel") }}
                <span class="scorer-mono">{{ defaultModelOf(selectedProvider) || "—" }}</span>
              </span>
              <span class="scorer-preview__sep">·</span>
              <span class="scorer-preview__meta">
                {{ t("onlineEvals.scorer.authLabel") }}
                <span class="scorer-mono">{{ t("onlineEvals.scorer.authConfigured") }}</span>
              </span>
            </div>

            <div class="scorer-field__help">
              <i18n-t keypath="onlineEvals.scorer.providerHelp" tag="span">
                <template #settingsLink>
                  <router-link
                    :to="{ name: 'llmProviders' }"
                    class="scorer-field__help-link"
                    target="_blank"
                  >
                    {{ t("onlineEvals.scorer.providerHelpSettingsLink") }}
                  </router-link>
                </template>
              </i18n-t>
            </div>
          </div>

          <div class="scorer-field">
            <label class="scorer-field__label">{{ t("onlineEvals.scorer.modelLabel") }}</label>
            <OInput
              v-model.trim="form.model"
              :placeholder="t('onlineEvals.scorer.modelPlaceholder')"
              size="sm"
              data-test="scorer-form-model-input"
            />
          </div>

          <div class="scorer-field scorer-field--prompt">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.promptLabel") }}
              <span class="scorer-field__req">*</span>
            </label>
            <OInput
              v-model="form.template"
              type="textarea"
              size="sm"
              :rows="8"
              data-test="scorer-form-prompt-input"
            />
            <div class="scorer-prompt-vars">
              <span class="scorer-prompt-vars__label">
                {{ t("onlineEvals.scorer.promptVariablesLabel") }}
              </span>
              <span
                v-for="v in promptVariables"
                :key="v"
                class="scorer-prompt-vars__chip scorer-mono"
              >{{ formatTemplateVariable(v) }}</span>
            </div>
            <div class="scorer-field__help">{{ t("onlineEvals.scorer.promptHelp") }}</div>
          </div>

          <div class="scorer-field scorer-field--schema">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.outputSchemaLabel") }}
            </label>
            <OInput
              v-model="form.outputSchema"
              type="textarea"
              size="sm"
              :rows="6"
              data-test="scorer-form-output-schema-input"
            />
          </div>
        </section>

        <!-- Section 02: Remote endpoint -->
        <section v-else class="scorer-section">
          <div class="scorer-section__head">
            <span class="scorer-section__num">02</span>
            <h3 class="scorer-section__title">{{ t("onlineEvals.scorer.endpointSection") }}</h3>
          </div>

          <div class="scorer-field">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.remoteEndpointLabel") }}
              <span class="scorer-field__req">*</span>
            </label>
            <OInput
              v-model.trim="form.remoteEndpoint"
              :placeholder="t('onlineEvals.scorer.remoteEndpointPlaceholder')"
              size="sm"
              data-test="scorer-form-remote-endpoint-input"
            />
          </div>

          <div class="scorer-field scorer-field--request-body">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.requestBodyLabel") }}
              <span class="scorer-field__req">*</span>
            </label>
            <OInput
              v-model="form.template"
              type="textarea"
              size="sm"
              :rows="10"
              data-test="scorer-form-request-body-input"
            />
            <div class="scorer-prompt-vars">
              <span class="scorer-prompt-vars__label">
                {{ t("onlineEvals.scorer.promptVariablesLabel") }}
              </span>
              <span
                v-for="v in promptVariables"
                :key="v"
                class="scorer-prompt-vars__chip scorer-mono"
              >{{ formatTemplateVariable(v) }}</span>
            </div>
          </div>
        </section>
      </div>

      <ScorerTestPanel
        :variables="scorerTestVariables"
        :inputs="scorerTestInputs"
        :state="scorerTestState"
        @run="runScorerTest"
        @update:inputs="scorerTestInputs = $event"
      />
    </div>

    <footer class="scorer-form__foot">
      <OButton
        data-test="scorer-form-cancel-btn"
        type="button"
        variant="outline"
        size="sm-action"
        @click="$emit('cancel')"
      >
        {{ t("onlineEvals.buttons.cancel") }}
      </OButton>
      <OButton
        data-test="scorer-form-save-btn"
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
import { computed, onMounted, ref, toRef } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type Provider,
  type ScoreConfig,
  type Scorer,
  type ScorerType,
} from "@/services/online-evals.service";
import {
  dataTypeOf,
  defaultModelOf,
  entityId,
  valueOf,
} from "../utils/evalEntity";
import {
  defaultOutputSchema,
  extractTemplateVariables,
  formatTemplateVariable,
  parseOptionalJson,
  showError,
  stringifyJson,
} from "../utils/evalFormat";
import { useScorerTest } from "../composables/useScorerTest";
import ScorerTestPanel from "./scorer/ScorerTestPanel.vue";

const props = defineProps<{
  orgId: string;
  mode: "create" | "edit";
  row: Scorer | null;
  scorerType: ScorerType;
  providers: Provider[];
  scoreConfigs: ScoreConfig[];
  scoreConfigVersions: Record<string, ScoreConfig[]>;
  isRefreshingProviders?: boolean;
}>();

const emit = defineEmits<{
  (e: "saved"): void;
  (e: "cancel"): void;
  (e: "request-versions", scoreConfigId: string): void;
  (e: "refresh-providers"): void;
}>();

const { t } = useI18n();
const form = ref(initForm(props.row, props.scorerType));
const isSaving = ref(false);

const {
  scorerTestInputs,
  scorerTestScenario,
  scorerTestState,
  scorerTestVariables,
  runScorerTest,
} = useScorerTest(toRef(() => form.value.template));

const titleText = computed(() => {
  const isRemote = form.value.scorerType === "remote";
  if (props.mode === "create") {
    return isRemote
      ? t("onlineEvals.scorer.createTitleRemote")
      : t("onlineEvals.scorer.createTitleLlm");
  }
  return isRemote
    ? t("onlineEvals.scorer.editTitleRemote")
    : t("onlineEvals.scorer.editTitleLlm");
});

const scoreConfigOptions = computed(() =>
  props.scoreConfigs.map((config) => ({
    label: config.name,
    value: entityId(config),
  })),
);

const providerOptions = computed(() =>
  props.providers.map((provider) => ({
    label: provider.name,
    value: provider.id,
  })),
);

const selectedScoreConfig = computed(() =>
  props.scoreConfigs.find((c) => entityId(c) === form.value.producesScoreConfigId) || null,
);

const selectedRange = computed(() => {
  const config = selectedScoreConfig.value;
  if (!config) return "";
  const type = dataTypeOf(config);
  if (type === "numeric") {
    const range = valueOf(config, "numericRange", "numeric_range");
    if (!range || range.min === undefined || range.max === undefined) return "";
    return `${range.min}–${range.max}`;
  }
  if (type === "categorical") {
    const cats = config.categories;
    if (!Array.isArray(cats) || cats.length === 0) return "";
    return cats.join(" · ");
  }
  return "true / false";
});

const selectedHealthy = computed(() => {
  const config = selectedScoreConfig.value;
  if (!config) return "—";
  const ht = valueOf(config, "healthyThreshold", "healthy_threshold");
  if (!ht) return "—";
  const type = dataTypeOf(config);
  if (type === "numeric") {
    if (ht.value === undefined || !ht.direction) return "—";
    const symbol = ht.direction === "gte" ? "≥" : "≤";
    return `${symbol} ${ht.value}`;
  }
  if (type === "categorical") {
    const list = ht.healthy_categories || ht.healthyCategories;
    if (!Array.isArray(list) || list.length === 0) return "—";
    return list.join(", ");
  }
  const val = ht.healthy_value ?? ht.healthyValue;
  if (val === undefined || val === null) return "—";
  return String(val);
});

const selectedProvider = computed(
  () => props.providers.find((p) => p.id === form.value.providerId) || null,
);

const promptVariables = computed(() => extractTemplateVariables(form.value.template || ""));

onMounted(() => {
  if (props.mode === "edit" && form.value.producesScoreConfigId) {
    void prepareSelectedScoreConfigVersion(true);
  }
});

function initForm(row: Scorer | null, scorerType: ScorerType) {
  if (!row) {
    return {
      name: "",
      scorerType,
      description: "",
      producesScoreConfigId: "",
      producesScoreConfigVersion: "",
      pinScoreConfigVersion: false,
      providerId: "",
      model: "",
      remoteEndpoint: "",
      template: "Evaluate {{ input }} and {{ output }}.",
      outputSchema: stringifyJson(defaultOutputSchema()),
    };
  }
  const rowScorerType = (valueOf(row, "scorerType", "scorer_type") || "llm_judge") as ScorerType;
  return {
    name: row.name,
    scorerType: rowScorerType,
    description: row.description || "",
    producesScoreConfigId: String(
      valueOf(row, "producesScoreConfigId", "produces_score_config_id") || "",
    ),
    producesScoreConfigVersion: String(
      valueOf(row, "producesScoreConfigVersion", "produces_score_config_version") || "",
    ),
    pinScoreConfigVersion: Boolean(
      valueOf(row, "producesScoreConfigVersion", "produces_score_config_version"),
    ),
    providerId: String(row.params?.provider_id || ""),
    model: String(row.params?.model || ""),
    remoteEndpoint: String(row.params?.endpoint || ""),
    template: row.template || "",
    outputSchema: stringifyJson(
      valueOf(row, "outputSchema", "output_schema") || defaultOutputSchema(),
    ),
  };
}

function providerEndpoint(provider: Provider) {
  return provider.endpoint || providerHostFallback(provider);
}

function providerHostFallback(provider: Provider) {
  const type = String(valueOf(provider, "providerType", "provider_type") || "").toLowerCase();
  if (type === "openai") return "api.openai.com";
  if (type === "anthropic") return "api.anthropic.com";
  return "—";
}

async function handleScoreConfigSelection() {
  form.value.pinScoreConfigVersion = false;
  form.value.producesScoreConfigVersion = "";
  await prepareSelectedScoreConfigVersion(false);
}

async function prepareSelectedScoreConfigVersion(keepSelectedVersion: boolean) {
  const selectedId = form.value.producesScoreConfigId;
  if (!selectedId) return;

  emit("request-versions", selectedId);
  await Promise.resolve();

  const versions = props.scoreConfigVersions[selectedId];
  const latestVersion = versions?.[0]?.version;
  if (!latestVersion) return;

  const currentVersion = form.value.producesScoreConfigVersion;
  const selectedVersionExists =
    Array.isArray(versions) && versions.some((c) => String(c.version) === currentVersion);

  if (!keepSelectedVersion || !currentVersion || !selectedVersionExists) {
    form.value.producesScoreConfigVersion = String(latestVersion);
  }
}

async function save() {
  if (!props.orgId) return;
  isSaving.value = true;
  try {
    const isLlmJudge = form.value.scorerType === "llm_judge";
    const scoreConfigRef = {
      producesScoreConfigId: form.value.producesScoreConfigId || null,
      producesScoreConfigVersion:
        form.value.pinScoreConfigVersion && form.value.producesScoreConfigVersion
          ? Number(form.value.producesScoreConfigVersion)
          : null,
    };
    const scorerPayload: Record<string, any> = isLlmJudge
      ? {
          type: "llm_judge",
          ...scoreConfigRef,
          template: form.value.template,
          outputSchema:
            parseOptionalJson(form.value.outputSchema, t("onlineEvals.scorer.outputSchemaLabel")) ||
            defaultOutputSchema(),
          params: {
            provider_id: form.value.providerId,
            ...(form.value.model ? { model: form.value.model } : {}),
            include_reasoning: true,
          },
        }
      : {
          type: "remote",
          ...scoreConfigRef,
          template: form.value.template,
          params: {
            endpoint: form.value.remoteEndpoint,
            http_method: "POST",
            timeout_ms: 30000,
          },
        };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.scorers.update(props.orgId, entityId(props.row), {
        name: form.value.name,
        description: form.value.description || null,
        scorer: scorerPayload,
      });
    } else {
      await onlineEvalsService.scorers.create(props.orgId, {
        name: form.value.name,
        description: form.value.description || null,
        scorer: scorerPayload,
      });
    }
    toast({
      variant: "success",
      message: t("onlineEvals.saved", { label: t("onlineEvals.singular.scorers") }),
    });
    emit("saved");
  } catch (err: any) {
    showError(err, t("onlineEvals.scorer.saveError"));
  } finally {
    isSaving.value = false;
  }
}
</script>

<style lang="scss" scoped>
.scorer-form {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  gap: 10px;
}

.scorer-form__top {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 8px 14px;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 0.313rem 0.063rem var(--o2-hover-shadow);
  flex-shrink: 0;
}

.scorer-form__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  letter-spacing: 0.005em;
  white-space: nowrap;
}

.scorer-form__subtitle {
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.scorer-form__top-spacer {
  flex: 1;
  min-width: 8px;
}

.scorer-form__badge {
  padding: 3px 8px;
  border-radius: 4px;
  font: 700 11px inherit;
  background: color-mix(in srgb, var(--color-text-primary) 10%, transparent);
  color: var(--color-text-primary, currentColor);
  white-space: nowrap;
}

.scorer-form__badge--llm_judge {
  background: color-mix(in srgb, var(--o2-status-info-text) 14%, transparent);
  color: var(--o2-status-info-text);
}

.scorer-form__badge--remote {
  background: color-mix(in srgb, var(--o2-status-success-text) 14%, transparent);
  color: var(--o2-status-success-text);
}

.scorer-form__close {
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

.scorer-form__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  color: var(--color-primary-600, #3F7994);
}

.scorer-form__body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(320px, 0.9fr);
  gap: 10px;
}

.scorer-form__main {
  min-width: 0;
  overflow: auto;
  padding: 18px 24px 24px;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 0.313rem 0.063rem var(--o2-hover-shadow);
}

.scorer-form__foot {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 22px;
  background-color: var(--o2-card-bg);
  border-radius: 0.375rem;
  box-shadow: 0 0 0.313rem 0.063rem var(--o2-hover-shadow);
  flex-shrink: 0;
  z-index: 1;
}

/* Cap all textareas in the form so they scroll internally instead of pushing layout */
.scorer-form__main :deep(textarea) {
  max-height: 280px;
  overflow-y: auto;
}

/* Specific per-field caps that match each field's role */
.scorer-form__main .scorer-field--desc :deep(textarea) { max-height: 120px; }
.scorer-form__main .scorer-field--prompt :deep(textarea) { max-height: 280px; }
.scorer-form__main .scorer-field--schema :deep(textarea) { max-height: 220px; }
.scorer-form__main .scorer-field--request-body :deep(textarea) { max-height: 280px; }

.scorer-section {
  margin-bottom: 24px;
}

.scorer-section__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-dialog-header-border, var(--o2-border));
  margin-bottom: 12px;
}

.scorer-section__num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-text-secondary) 12%, transparent);
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font: 700 11px ui-monospace, SFMono-Regular, Menlo, monospace;
}

.scorer-section__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
}

.scorer-field {
  margin-bottom: 12px;
}

.scorer-field__label {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary, currentColor);
  margin-bottom: 4px;
}

.scorer-field__req {
  color: var(--o2-status-error-text);
  margin-left: 2px;
}

.scorer-field__lock {
  margin-left: 6px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scorer-field__help {
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-top: 4px;
}

.scorer-field__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.scorer-field__row-grow {
  flex: 1;
  min-width: 0;
}

.scorer-field__help-link {
  color: var(--color-primary-600, #3F7994);
  font-weight: 600;
  text-decoration: none;
}

.scorer-field__help-link:hover {
  text-decoration: underline;
}

.scorer-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.scorer-preview {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 10px;
  padding: 8px 12px;
  margin-top: 8px;
  border: 1px solid color-mix(in srgb, var(--o2-status-info-text) 25%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--o2-status-info-text) 8%, transparent);
  font-size: 12px;
  color: var(--color-text-primary, currentColor);
}

.scorer-preview__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--o2-status-info-text);
  flex-shrink: 0;
}

.scorer-preview__label {
  font-weight: 500;
}

.scorer-preview__sep {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scorer-preview__meta {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scorer-preview__meta .scorer-mono {
  color: var(--color-text-primary, currentColor);
  font-weight: 600;
}

.scorer-prompt-vars {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  font-size: 11.5px;
}

.scorer-prompt-vars__label {
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scorer-prompt-vars__chip {
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  background: color-mix(in srgb, var(--color-text-secondary) 10%, transparent);
  color: var(--color-text-primary, currentColor);
}

@media (max-width: 1100px) {
  .scorer-form__body {
    grid-template-columns: 1fr;
  }
}
</style>
