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
            <div class="scorer-field__help">
              {{
                t("onlineEvals.scorer.promptHelp", {
                  inputVar: formatTemplateVariable("input"),
                  outputVar: formatTemplateVariable("output"),
                })
              }}
            </div>
          </div>

          <div class="scorer-field scorer-field--extras">
            <label class="scorer-extras__toggle">
              <input
                v-model="form.includeReasoning"
                type="checkbox"
                data-test="scorer-form-include-reasoning"
              />
              <span>
                <strong>{{ t("onlineEvals.scorer.includeReasoningLabel") }}</strong>
                <small>{{ t("onlineEvals.scorer.includeReasoningHint") }}</small>
              </span>
            </label>

            <div class="scorer-extras__head">
              <div class="scorer-extras__head-text">
                <strong>{{ t("onlineEvals.scorer.extraFieldsLabel") }}</strong>
                <span class="scorer-extras__optional">
                  {{ t("onlineEvals.scorer.extraFieldsOptional") }}
                </span>
                <small>{{ t("onlineEvals.scorer.extraFieldsHint") }}</small>
              </div>
            </div>

            <div
              v-if="form.extraMetadataFields.length"
              class="scorer-extras__table"
              data-test="scorer-form-extra-fields"
            >
              <div class="scorer-extras__row scorer-extras__row--head">
                <span>{{ t("onlineEvals.scorer.extraFields.colName") }}</span>
                <span>{{ t("onlineEvals.scorer.extraFields.colType") }}</span>
                <span>{{ t("onlineEvals.scorer.extraFields.colDescription") }}</span>
                <span aria-hidden="true" />
              </div>
              <div
                v-for="(field, idx) in form.extraMetadataFields"
                :key="idx"
                class="scorer-extras__row"
              >
                <OInput
                  v-model.trim="field.name"
                  size="sm"
                  :placeholder="t('onlineEvals.scorer.extraFields.namePlaceholder')"
                  :class="{ 'has-error': field.name && extraFieldNameDuplicates.has(field.name) }"
                  :data-test="`scorer-form-extra-field-name-${idx}`"
                />
                <OSelect
                  v-model="field.type"
                  size="sm"
                  :options="extraFieldTypeOptions"
                  :data-test="`scorer-form-extra-field-type-${idx}`"
                />
                <OInput
                  v-model="field.description"
                  size="sm"
                  :placeholder="t('onlineEvals.scorer.extraFields.descriptionPlaceholder')"
                  :data-test="`scorer-form-extra-field-description-${idx}`"
                />
                <button
                  type="button"
                  class="scorer-extras__remove"
                  :aria-label="t('onlineEvals.buttons.remove')"
                  :data-test="`scorer-form-extra-field-remove-${idx}`"
                  @click="removeExtraField(idx)"
                >
                  ×
                </button>
              </div>
            </div>

            <div class="scorer-extras__actions">
              <button
                type="button"
                class="scorer-extras__add"
                :disabled="form.extraMetadataFields.length >= MAX_EXTRA_FIELDS"
                data-test="scorer-form-extra-field-add"
                @click="addExtraField"
              >
                {{ t("onlineEvals.scorer.extraFields.addButton") }}
                <span class="scorer-extras__count">
                  ({{ form.extraMetadataFields.length }} / {{ MAX_EXTRA_FIELDS }})
                </span>
              </button>

              <button
                type="button"
                class="scorer-extras__preview"
                data-test="scorer-form-preview-schema"
                @click="previewOutputSchema"
              >
                {{ t("onlineEvals.scorer.extraFields.previewSchema") }}
              </button>
            </div>

          </div>
        </section>

        <!-- Section 02: Endpoint -->
        <section v-else class="scorer-section">
          <div class="scorer-section__head">
            <span class="scorer-section__num">02</span>
            <h3 class="scorer-section__title">{{ t("onlineEvals.scorer.endpointSection") }}</h3>
          </div>

          <div class="scorer-field">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.remoteUrlLabel") }}
              <span class="scorer-field__req">*</span>
            </label>
            <div class="scorer-url-bar">
              <OSelect
                v-model="form.httpMethod"
                size="md"
                :options="httpMethodOptions"
                :searchable="false"
                data-test="scorer-form-remote-method-select"
              />
              <OInput
                v-model.trim="form.remoteEndpoint"
                :placeholder="t('onlineEvals.scorer.remoteEndpointPlaceholder')"
                size="sm"
                data-test="scorer-form-remote-endpoint-input"
              />
            </div>
          </div>

          <div class="scorer-field scorer-field--triple">
            <div class="scorer-field__col">
              <label class="scorer-field__label">
                {{ t("onlineEvals.scorer.remoteTimeoutLabel") }}
              </label>
              <OInput
                v-model.number="form.timeoutMs"
                type="number"
                size="sm"
                :min="0"
                data-test="scorer-form-remote-timeout"
              />
            </div>
            <div class="scorer-field__col">
              <label class="scorer-field__label">
                {{ t("onlineEvals.scorer.remoteRetriesLabel") }}
              </label>
              <OInput
                v-model.number="form.maxRetries"
                type="number"
                size="sm"
                :min="0"
                data-test="scorer-form-remote-retries"
              />
            </div>
            <div class="scorer-field__col">
              <label class="scorer-field__label">
                {{ t("onlineEvals.scorer.remoteBackoffLabel") }}
              </label>
              <OSelect
                v-model="form.backoffStrategy"
                size="md"
                :options="backoffOptions"
                :searchable="false"
                data-test="scorer-form-remote-backoff"
              />
            </div>
          </div>
        </section>

        <!-- Section 03: Authentication -->
        <section v-if="form.scorerType === 'remote'" class="scorer-section">
          <div class="scorer-section__head">
            <span class="scorer-section__num">03</span>
            <h3 class="scorer-section__title">{{ t("onlineEvals.scorer.authSection") }}</h3>
          </div>

          <div class="scorer-field">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.remoteAuthLabel") }}
            </label>
            <OSelect
              v-model="form.authType"
              size="md"
              :options="authTypeOptions"
              :searchable="false"
              :placeholder="t('onlineEvals.scorer.remoteAuth.placeholder')"
              data-test="scorer-form-remote-auth-type"
            />
          </div>

          <div v-if="form.authType === 'bearer'" class="scorer-field">
            <label class="scorer-field__label">
              {{ t("onlineEvals.scorer.remoteAuth.tokenLabel") }}
              <span class="scorer-field__req">*</span>
            </label>
            <OInput
              v-model.trim="form.authBearerToken"
              :placeholder="t('onlineEvals.scorer.remoteAuth.bearerTokenPlaceholder')"
              size="sm"
              type="password"
              data-test="scorer-form-remote-auth-bearer-token"
            />
            <div class="scorer-field__help">
              {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
            </div>
          </div>

          <div v-if="form.authType === 'basic'" class="scorer-field scorer-field--row">
            <div class="scorer-field__half">
              <label class="scorer-field__label">
                {{ t("onlineEvals.scorer.remoteAuth.usernameLabel") }}
                <span class="scorer-field__req">*</span>
              </label>
              <OInput
                v-model.trim="form.authBasicUsername"
                :placeholder="t('onlineEvals.scorer.remoteAuth.basicUsernamePlaceholder')"
                size="sm"
                data-test="scorer-form-remote-auth-basic-username"
              />
            </div>
            <div class="scorer-field__half">
              <label class="scorer-field__label">
                {{ t("onlineEvals.scorer.remoteAuth.passwordLabel") }}
                <span class="scorer-field__req">*</span>
              </label>
              <OInput
                v-model.trim="form.authBasicPassword"
                :placeholder="t('onlineEvals.scorer.remoteAuth.basicPasswordPlaceholder')"
                size="sm"
                type="password"
                data-test="scorer-form-remote-auth-basic-password"
              />
              <div class="scorer-field__help">
                {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
              </div>
            </div>
          </div>

          <div v-if="form.authType === 'api_key'" class="scorer-field scorer-field--row">
            <div class="scorer-field__half">
              <label class="scorer-field__label">
                {{ t("onlineEvals.scorer.remoteAuth.headerNameLabel") }}
                <span class="scorer-field__req">*</span>
              </label>
              <OInput
                v-model.trim="form.authApiKeyHeaderName"
                :placeholder="t('onlineEvals.scorer.remoteAuth.apiKeyHeaderPlaceholder')"
                size="sm"
                data-test="scorer-form-remote-auth-apikey-header"
              />
            </div>
            <div class="scorer-field__half">
              <label class="scorer-field__label">
                {{ t("onlineEvals.scorer.remoteAuth.tokenLabel") }}
                <span class="scorer-field__req">*</span>
              </label>
              <OInput
                v-model.trim="form.authApiKeyToken"
                :placeholder="t('onlineEvals.scorer.remoteAuth.apiKeyTokenPlaceholder')"
                size="sm"
                type="password"
                data-test="scorer-form-remote-auth-apikey-token"
              />
              <div class="scorer-field__help">
                {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
              </div>
            </div>
          </div>
        </section>

        <!-- Section 04: Custom headers -->
        <section v-if="form.scorerType === 'remote'" class="scorer-section">
          <div class="scorer-section__head">
            <span class="scorer-section__num">04</span>
            <h3 class="scorer-section__title">{{ t("onlineEvals.scorer.headersSection") }}</h3>
            <span class="scorer-section__head-aside">
              {{ t("onlineEvals.scorer.remoteHeaders.subtitle") }}
            </span>
          </div>

          <div class="scorer-field">
            <div
              v-if="form.customHeaders.length"
              class="scorer-headers"
              data-test="scorer-form-remote-headers"
            >
              <div class="scorer-headers__row scorer-headers__row--head">
                <span>{{ t("onlineEvals.scorer.remoteHeaders.colName") }}</span>
                <span>{{ t("onlineEvals.scorer.remoteHeaders.colValue") }}</span>
                <span aria-hidden="true" />
              </div>
              <div
                v-for="(header, idx) in form.customHeaders"
                :key="idx"
                class="scorer-headers__row"
              >
                <OInput
                  v-model.trim="header.key"
                  size="sm"
                  :placeholder="t('onlineEvals.scorer.remoteHeaders.keyPlaceholder')"
                  :data-test="`scorer-form-remote-header-key-${idx}`"
                />
                <OInput
                  v-model="header.value"
                  size="sm"
                  :placeholder="t('onlineEvals.scorer.remoteHeaders.valuePlaceholder')"
                  :data-test="`scorer-form-remote-header-value-${idx}`"
                />
                <button
                  type="button"
                  class="scorer-extras__remove"
                  :aria-label="t('onlineEvals.buttons.remove')"
                  :data-test="`scorer-form-remote-header-remove-${idx}`"
                  @click="removeCustomHeader(idx)"
                >
                  ×
                </button>
              </div>
            </div>

            <div class="scorer-extras__actions">
              <button
                type="button"
                class="scorer-extras__add"
                data-test="scorer-form-remote-header-add"
                @click="addCustomHeader"
              >
                {{ t("onlineEvals.scorer.remoteHeaders.addButton") }}
              </button>
            </div>
          </div>
        </section>

        <!-- Section 05: Request body template -->
        <section v-if="form.scorerType === 'remote'" class="scorer-section">
          <div class="scorer-section__head">
            <span class="scorer-section__num">05</span>
            <h3 class="scorer-section__title">{{ t("onlineEvals.scorer.requestBodySection") }}</h3>
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
        :result="scorerTestResult"
        :error-message="scorerTestError"
        :can-run="canRunScorerTest"
        @run="onRunScorerTest"
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

    <ODialog
      v-model:open="schemaPreviewOpen"
      data-test="scorer-form-schema-preview-dialog"
      size="md"
      :title="t('onlineEvals.scorer.extraFields.schemaTitle')"
    >
      <p v-if="isLoadingSchemaPreview" class="scorer-schema-dialog__state">
        {{ t("onlineEvals.scorer.extraFields.schemaLoading") }}
      </p>
      <p
        v-else-if="schemaPreviewError"
        class="scorer-schema-dialog__state scorer-schema-dialog__state--error"
      >
        {{ schemaPreviewError }}
      </p>
      <pre v-else class="scorer-schema-dialog__code">{{ schemaPreview }}</pre>

      <template #footer>
        <div class="scorer-schema-dialog__footer">
          <OButton
            data-test="scorer-form-schema-copy-btn"
            variant="outline"
            size="sm-action"
            :icon-left="schemaJustCopied ? 'check' : 'content-copy'"
            :disabled="!schemaPreview || isLoadingSchemaPreview"
            @click="copySchemaToClipboard"
          >
            {{ copyButtonLabel }}
          </OButton>
          <OButton
            data-test="scorer-form-schema-close-btn"
            variant="primary"
            size="sm-action"
            @click="schemaPreviewOpen = false"
          >
            {{ t("onlineEvals.buttons.close") }}
          </OButton>
        </div>
      </template>
    </ODialog>
  </form>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRef } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import onlineEvalsService, {
  type ExtraMetadataField,
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
  extractTemplateVariables,
  formatTemplateVariable,
  showError,
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
  scorerTestState,
  scorerTestVariables,
  scorerTestResult,
  scorerTestError,
  runScorerTest,
} = useScorerTest(toRef(() => form.value.template));

const canRunScorerTest = computed(() => {
  if (!props.orgId) return false;
  if (!form.value.name?.trim()) return false;
  if (!form.value.template?.trim()) return false;
  if (form.value.scorerType === "llm_judge") {
    if (!form.value.providerId) return false;
  } else if (form.value.scorerType === "remote") {
    if (!form.value.remoteEndpoint?.trim()) return false;
  }
  if (scorerTestVariables.value.length === 0) return false;
  return scorerTestVariables.value.every((variable) =>
    String(scorerTestInputs.value[variable] ?? "").trim().length > 0,
  );
});

function buildScorerTestPayload() {
  const isLlmJudge = form.value.scorerType === "llm_judge";
  const scoreConfigRef: Record<string, any> = {};
  if (form.value.producesScoreConfigId) {
    scoreConfigRef.producesScoreConfigId = form.value.producesScoreConfigId;
    if (
      form.value.pinScoreConfigVersion &&
      form.value.producesScoreConfigVersion
    ) {
      scoreConfigRef.producesScoreConfigVersion = Number(
        form.value.producesScoreConfigVersion,
      );
    }
  }

  const scorer = isLlmJudge
    ? {
        type: "llm_judge" as const,
        ...scoreConfigRef,
        template: form.value.template,
        params: {
          provider_id: form.value.providerId,
          ...(form.value.model ? { model: form.value.model } : {}),
          include_reasoning: form.value.includeReasoning,
          ...(cleanedExtraFields.value.length
            ? { extra_metadata_fields: cleanedExtraFields.value }
            : {}),
        },
      }
    : {
        type: "remote" as const,
        ...scoreConfigRef,
        template: form.value.template,
        params: buildRemoteParams(),
      };

  return {
    name: form.value.name.trim(),
    ...(form.value.description?.trim()
      ? { description: form.value.description.trim() }
      : {}),
    scorer,
    inputVariables: { ...scorerTestInputs.value },
  };
}

function onRunScorerTest() {
  if (!canRunScorerTest.value) return;
  void runScorerTest(props.orgId, buildScorerTestPayload());
}

const MAX_EXTRA_FIELDS = 10;

const extraFieldTypeOptions = computed(() => [
  { label: t("onlineEvals.scorer.extraFields.typeString"), value: "string" },
  { label: t("onlineEvals.scorer.extraFields.typeNumber"), value: "number" },
  { label: t("onlineEvals.scorer.extraFields.typeBoolean"), value: "boolean" },
]);

const httpMethodOptions = computed(() =>
  ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ label: m, value: m })),
);

const authTypeOptions = computed(() => [
  { label: t("onlineEvals.scorer.remoteAuth.bearer"), value: "bearer" },
  { label: t("onlineEvals.scorer.remoteAuth.basic"), value: "basic" },
  { label: t("onlineEvals.scorer.remoteAuth.apiKey"), value: "api_key" },
]);

const backoffOptions = computed(() => [
  { label: t("onlineEvals.scorer.remoteBackoff.exponential"), value: "exponential" },
  { label: t("onlineEvals.scorer.remoteBackoff.linear"), value: "linear" },
  { label: t("onlineEvals.scorer.remoteBackoff.fixed"), value: "fixed" },
]);

function addCustomHeader() {
  form.value.customHeaders.push({ key: "", value: "" });
}

function removeCustomHeader(index: number) {
  form.value.customHeaders.splice(index, 1);
}

const cleanedCustomHeaders = computed(() =>
  form.value.customHeaders
    .map((h) => ({ key: h.key.trim(), value: h.value }))
    .filter((h) => h.key.length > 0),
);

function buildAuthPayload(): Record<string, any> | null {
  const t = form.value.authType;
  if (t === "bearer") {
    const token = form.value.authBearerToken.trim();
    if (!token) return null;
    return { type: "bearer", token };
  }
  if (t === "basic") {
    const username = form.value.authBasicUsername.trim();
    const password = form.value.authBasicPassword;
    if (!username || !password) return null;
    return { type: "basic", username, password };
  }
  if (t === "api_key") {
    const token = form.value.authApiKeyToken.trim();
    const headerName = form.value.authApiKeyHeaderName.trim();
    if (!token || !headerName) return null;
    return { type: "api_key", token, header_name: headerName };
  }
  return null;
}

function buildRemoteParams(): Record<string, any> {
  const params: Record<string, any> = {
    endpoint: form.value.remoteEndpoint,
    http_method: form.value.httpMethod || DEFAULT_HTTP_METHOD,
    timeout_ms: Number(form.value.timeoutMs) || DEFAULT_TIMEOUT_MS,
  };
  const retries = Number(form.value.maxRetries);
  if (Number.isFinite(retries) && retries > 0) params.max_retries = retries;
  const auth = buildAuthPayload();
  if (auth) params.auth = auth;
  if (cleanedCustomHeaders.value.length) params.custom_headers = cleanedCustomHeaders.value;
  return params;
}

const cleanedExtraFields = computed<ExtraMetadataField[]>(() =>
  form.value.extraMetadataFields
    .map((field) => ({
      name: field.name.trim(),
      type: field.type,
      description: field.description?.trim() || undefined,
    }))
    .filter((field) => field.name.length > 0)
    .map((field) => ({
      name: field.name,
      type: field.type,
      ...(field.description ? { description: field.description } : {}),
    })),
);

const extraFieldNameDuplicates = computed(() => {
  const seen = new Map<string, number>();
  for (const field of cleanedExtraFields.value) {
    seen.set(field.name, (seen.get(field.name) ?? 0) + 1);
  }
  return new Set(
    Array.from(seen.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name),
  );
});

function addExtraField() {
  if (form.value.extraMetadataFields.length >= MAX_EXTRA_FIELDS) return;
  form.value.extraMetadataFields.push({ name: "", type: "string", description: "" });
}

function removeExtraField(index: number) {
  form.value.extraMetadataFields.splice(index, 1);
}

const schemaPreview = ref<string>("");
const schemaPreviewError = ref<string | null>(null);
const isLoadingSchemaPreview = ref(false);
const schemaPreviewOpen = ref(false);
const schemaJustCopied = ref(false);

const copyButtonLabel = computed(() =>
  schemaJustCopied.value
    ? t("onlineEvals.scorer.extraFields.schemaCopied")
    : t("onlineEvals.scorer.extraFields.schemaCopy"),
);

async function copySchemaToClipboard() {
  if (!schemaPreview.value) return;
  try {
    await navigator.clipboard.writeText(schemaPreview.value);
    schemaJustCopied.value = true;
    window.setTimeout(() => {
      schemaJustCopied.value = false;
    }, 1500);
  } catch {
    toast({
      variant: "error",
      message: t("onlineEvals.scorer.extraFields.schemaCopyFailed"),
    });
  }
}

async function previewOutputSchema() {
  if (!props.orgId) return;
  schemaPreviewOpen.value = true;
  isLoadingSchemaPreview.value = true;
  schemaPreviewError.value = null;
  schemaPreview.value = "";
  try {
    const data = await onlineEvalsService.scorers.previewLlmJudgeOutputSchema(
      props.orgId,
      {
        ...(form.value.producesScoreConfigId
          ? { producesScoreConfigId: form.value.producesScoreConfigId }
          : {}),
        ...(form.value.pinScoreConfigVersion && form.value.producesScoreConfigVersion
          ? { producesScoreConfigVersion: Number(form.value.producesScoreConfigVersion) }
          : {}),
        includeReasoning: form.value.includeReasoning,
        extraMetadataFields: cleanedExtraFields.value,
      },
    );
    const schema = (data as any)?.outputSchema ?? (data as any)?.output_schema ?? data;
    schemaPreview.value = JSON.stringify(schema, null, 2);
  } catch (err: any) {
    const body = err?.response?.data ?? {};
    schemaPreviewError.value =
      body.message || body.error || err?.message || "Failed to derive schema";
  } finally {
    isLoadingSchemaPreview.value = false;
  }
}

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

type AuthType = "" | "bearer" | "basic" | "api_key";

interface CustomHeader {
  key: string;
  value: string;
}

const DEFAULT_HTTP_METHOD = "POST";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 0;

function readAuth(rawAuth: any): {
  authType: AuthType;
  authBearerToken: string;
  authBasicUsername: string;
  authBasicPassword: string;
  authApiKeyToken: string;
  authApiKeyHeaderName: string;
} {
  const empty = {
    authType: "" as AuthType,
    authBearerToken: "",
    authBasicUsername: "",
    authBasicPassword: "",
    authApiKeyToken: "",
    authApiKeyHeaderName: "",
  };
  if (!rawAuth || typeof rawAuth !== "object") return empty;
  const t = String(rawAuth.type || "").toLowerCase();
  if (t === "bearer") {
    return { ...empty, authType: "bearer", authBearerToken: String(rawAuth.token || "") };
  }
  if (t === "basic") {
    return {
      ...empty,
      authType: "basic",
      authBasicUsername: String(rawAuth.username || ""),
      authBasicPassword: String(rawAuth.password || ""),
    };
  }
  if (t === "api_key" || t === "apikey") {
    return {
      ...empty,
      authType: "api_key",
      authApiKeyToken: String(rawAuth.token || ""),
      authApiKeyHeaderName: String(rawAuth.header_name || rawAuth.headerName || ""),
    };
  }
  return empty;
}

function readCustomHeaders(rawHeaders: any): CustomHeader[] {
  if (!Array.isArray(rawHeaders)) return [];
  return rawHeaders
    .filter((h) => h && typeof h === "object")
    .map((h) => ({ key: String(h.key || ""), value: String(h.value || "") }));
}

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
      includeReasoning: true,
      extraMetadataFields: [] as ExtraMetadataField[],
      httpMethod: DEFAULT_HTTP_METHOD,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxRetries: DEFAULT_MAX_RETRIES,
      backoffStrategy: "exponential" as "exponential" | "linear" | "fixed",
      authType: "" as AuthType,
      authBearerToken: "",
      authBasicUsername: "",
      authBasicPassword: "",
      authApiKeyToken: "",
      authApiKeyHeaderName: "",
      customHeaders: [] as CustomHeader[],
    };
  }
  const rowScorerType = (valueOf(row, "scorerType", "scorer_type") || "llm_judge") as ScorerType;
  const rawExtras = (row.params?.extra_metadata_fields ?? row.params?.extraMetadataFields ?? []) as any[];
  const auth = readAuth(row.params?.auth);
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
    includeReasoning: row.params?.include_reasoning !== false,
    extraMetadataFields: Array.isArray(rawExtras)
      ? rawExtras
          .filter((f) => f && typeof f === "object")
          .map((f) => ({
            name: String(f.name || ""),
            type: (f.type === "number" || f.type === "boolean" ? f.type : "string") as
              | "string"
              | "number"
              | "boolean",
            description: String(f.description || ""),
          }))
      : [],
    httpMethod: String(row.params?.http_method || DEFAULT_HTTP_METHOD).toUpperCase(),
    timeoutMs: Number(row.params?.timeout_ms ?? DEFAULT_TIMEOUT_MS),
    maxRetries: Number(row.params?.max_retries ?? DEFAULT_MAX_RETRIES),
    backoffStrategy: "exponential" as "exponential" | "linear" | "fixed",
    ...auth,
    customHeaders: readCustomHeaders(row.params?.custom_headers),
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
          params: {
            provider_id: form.value.providerId,
            ...(form.value.model ? { model: form.value.model } : {}),
            include_reasoning: form.value.includeReasoning,
            ...(cleanedExtraFields.value.length
              ? { extra_metadata_fields: cleanedExtraFields.value }
              : {}),
          },
        }
      : {
          type: "remote",
          ...scoreConfigRef,
          template: form.value.template,
          params: buildRemoteParams(),
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
  font-weight: 700;
  font-size: 11px;
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

.scorer-field--extras {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.scorer-extras__toggle {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.scorer-extras__toggle strong {
  display: block;
  font-size: 12px;
  color: var(--color-text-primary, currentColor);
}

.scorer-extras__toggle small {
  display: block;
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scorer-extras__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}

.scorer-extras__head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.scorer-extras__head-text strong {
  font-size: 12px;
  font-weight: 600;
}

.scorer-extras__head-text small {
  font-size: 11px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scorer-extras__optional {
  font-size: 10px;
  font-weight: 600;
  color: var(--color-text-muted, var(--o2-text-muted));
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.scorer-extras__table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--color-border, var(--o2-border));
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--color-card-bg-solid, var(--o2-card-bg-solid));
}

.scorer-extras__row {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) 110px minmax(140px, 2fr) 28px;
  gap: 8px;
  align-items: center;
}

.scorer-extras__row--head {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted, var(--o2-text-muted));
}

.scorer-extras__row .has-error :deep(input) {
  border-color: var(--o2-status-error-text);
}

.scorer-extras__remove {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-size: 16px;
  cursor: pointer;
  border-radius: 4px;
}

.scorer-extras__remove:hover {
  background: color-mix(in srgb, var(--o2-status-error-text) 12%, transparent);
  color: var(--o2-status-error-text);
}

.scorer-extras__actions {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.scorer-extras__add,
.scorer-extras__preview {
  border: none;
  background: transparent;
  padding: 4px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--o2-primary-btn-bg);
  cursor: pointer;
}

.scorer-extras__add:disabled {
  color: var(--color-text-muted, var(--o2-text-muted));
  cursor: not-allowed;
}

.scorer-extras__count {
  font-weight: 400;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  margin-left: 4px;
}

.scorer-url-bar {
  display: grid;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 0;
}

.scorer-url-bar :deep(.o-select__trigger),
.scorer-url-bar :deep(select) {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.scorer-url-bar :deep(input) {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}

.scorer-auth__row {
  margin-top: 8px;
}

.scorer-auth__grid {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(0, 2fr);
  gap: 8px;
  margin-top: 8px;
}

.scorer-headers {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--color-border, var(--o2-border));
  border-radius: 6px;
  padding: 8px 10px;
  background: var(--color-card-bg-solid, var(--o2-card-bg-solid));
}

.scorer-headers__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 28px;
  gap: 6px;
  align-items: center;
}

.scorer-headers__row--head {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted, var(--o2-text-muted));
}

.scorer-field--row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.scorer-field--triple {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}

.scorer-field__half,
.scorer-field__col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scorer-section__head-aside {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
  font-style: italic;
}

.scorer-schema-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.scorer-schema-dialog__code {
  margin: 0;
  max-height: 60vh;
  overflow: auto;
  padding: 12px;
  border-radius: 6px;
  background: var(--color-card-bg-solid, var(--o2-card-bg-solid));
  border: 1px solid var(--color-border, var(--o2-border));
  font: 400 12px var(--o2-font-mono);
  color: var(--color-text-primary, currentColor);
  white-space: pre;
  tab-size: 2;
}

.scorer-schema-dialog__state {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  color: var(--color-text-secondary, var(--o2-text-secondary));
}

.scorer-schema-dialog__state--error {
  color: var(--o2-status-error-text);
}

@media (max-width: 1100px) {
  .scorer-form__body {
    grid-template-columns: 1fr;
  }
}
</style>
