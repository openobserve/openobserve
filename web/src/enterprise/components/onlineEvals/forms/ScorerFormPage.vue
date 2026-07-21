<template>
  <OForm
    class="scorer-form flex flex-col flex-1 min-h-0 gap-2.5"
    :form="form"
    v-slot="{ isSubmitting }"
  >
    <!-- Shared page header (same as JobFormPage) so the two eval forms read
         identically: Back pill in the module-icon slot, title, and the
         scorer-type badge + close button in #actions. -->
    <OPageLayout
      :back="{
        label: t('onlineEvals.scorer.backTo'),
        onClick: () => $emit('cancel'),
        dataTest: 'scorer-form-back-btn',
      }"
      bleed
    >
      <template #title>
        <span data-test="scorer-form-title">{{ titleText }}</span>
      </template>
      <!-- Scorer-type badge sits inline, immediately after the title. -->
      <template #title-trail>
        <OTag
          type="scorerType"
          :value="formValues.scorerType"
          data-test="scorer-form-type-badge"
        />
      </template>
      <template #actions>
        <OButton
          variant="ghost"
          size="icon-sm"
          icon-left="close"
          :aria-label="t('onlineEvals.buttons.cancel')"
          :title="t('onlineEvals.buttons.cancel')"
          data-test="scorer-form-close-btn"
          :disabled="isSubmitting"
          @click="$emit('cancel')"
        />
      </template>

    <div class="flex-1 min-h-0 overflow-hidden grid grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)] max-[1100px]:grid-cols-1 gap-2.5">
      <div class="scorer-form__main min-w-0 overflow-auto p-[18px_24px_24px] bg-surface-base rounded-default border border-border-default">
        <!-- Section 01: Identity -->
        <section class="mb-6">
          <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-2xs font-mono">01</span>
            <h3 class="m-0 text-sm font-semibold text-text-heading">{{ t("onlineEvals.scorer.identitySection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.scorer.nameLabel") }}
              <span class="text-status-error-text ml-0.5">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-text-secondary" />
            </label>
            <OFormInput
              name="name"
              :placeholder="t('onlineEvals.scorer.namePlaceholder')"
              size="sm"
              :disabled="mode === 'edit'"
              data-test="scorer-form-name-input"
            />
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.scorer.descriptionLabel") }}
            </label>
            <OFormTextarea
              name="description"
              :placeholder="t('onlineEvals.scorer.descriptionPlaceholder')"
              size="sm"
              :rows="3"
              data-test="scorer-form-description-input"
            />
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.scorer.producesScoreConfigLabel") }}
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-text-secondary" />
            </label>
            <OFormSelect
              name="producesScoreConfigId"
              :options="scoreConfigOptions"
              :placeholder="t('onlineEvals.scorer.producesScoreConfigNone')"
              size="md"
              :disabled="mode === 'edit'"
              data-test="scorer-form-score-config-select"
              @update:modelValue="handleScoreConfigSelection"
            />
            <div class="text-2xs text-text-secondary mt-1">{{ t("onlineEvals.scorer.producesScoreHelp") }}</div>

            <div v-if="selectedScoreConfig" class="flex items-center flex-wrap gap-[6px_10px] p-[8px_12px] mt-2 border border-[color-mix(in_srgb,var(--color-status-info-text)_25%,transparent)] rounded-default bg-[color-mix(in_srgb,var(--color-status-info-text)_8%,transparent)] text-xs text-text-body">
              <span class="w-2 h-2 rounded-full bg-status-info-text shrink-0" />
              <span class="font-medium">
                {{ t("onlineEvals.scorer.selectedPrefix") }}
                <strong class="font-mono">{{ selectedScoreConfig.name }}</strong>
              </span>
              <span class="text-text-secondary">·</span>
              <span class="text-text-secondary">
                {{ t("onlineEvals.scorer.typeLabel") }}
                <span class="font-mono">{{ dataTypeOf(selectedScoreConfig) }}</span>
              </span>
              <template v-if="selectedRange">
                <span class="text-text-secondary">·</span>
                <span class="text-text-secondary">
                  {{ t("onlineEvals.scorer.rangeLabel") }}
                  <span class="font-mono">{{ selectedRange }}</span>
                </span>
              </template>
              <span class="text-text-secondary">·</span>
              <span class="text-text-secondary">
                {{ t("onlineEvals.scorer.healthyLabel") }}
                <span class="font-mono">{{ selectedHealthy }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Section 02: LLM Judge configuration -->
        <section v-if="formValues.scorerType === 'llm_judge'" class="mb-6">
          <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-2xs font-mono">02</span>
            <h3 class="m-0 text-sm font-semibold text-text-heading">{{ t("onlineEvals.scorer.judgeSection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.scorer.providerLabel") }}
              <span class="text-status-error-text ml-0.5">*</span>
            </label>
            <div class="flex items-center gap-2">
              <OFormSelect
                name="providerId"
                :options="providerOptions"
                :placeholder="t('onlineEvals.scorer.providerPlaceholder')"
                size="md"
                class="flex-1 min-w-0"
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

            <div v-if="selectedProvider" class="flex items-center flex-wrap gap-[6px_10px] p-[8px_12px] mt-2 border border-[color-mix(in_srgb,var(--color-status-info-text)_25%,transparent)] rounded-default bg-[color-mix(in_srgb,var(--color-status-info-text)_8%,transparent)] text-xs text-text-body">
              <span class="w-2 h-2 rounded-full bg-status-info-text shrink-0" />
              <span class="text-text-secondary">
                {{ t("onlineEvals.scorer.endpointLabel") }}
                <span class="font-mono">{{ providerEndpoint(selectedProvider) }}</span>
              </span>
              <span class="text-text-secondary">·</span>
              <span class="text-text-secondary">
                {{ t("onlineEvals.scorer.defaultModelPreviewLabel") }}
                <span class="font-mono">{{ defaultModelOf(selectedProvider) || "—" }}</span>
              </span>
              <span class="text-text-secondary">·</span>
              <span class="text-text-secondary">
                {{ t("onlineEvals.scorer.authLabel") }}
                <span class="font-mono">{{ t("onlineEvals.scorer.authConfigured") }}</span>
              </span>
            </div>

            <div class="text-2xs text-text-secondary mt-1">
              <i18n-t keypath="onlineEvals.scorer.providerHelp" tag="span">
                <template #settingsLink>
                  <router-link
                    :to="{ name: 'llmProviders' }"
                    class="scorer-field__help-link text-primary-600 font-semibold no-underline hover:underline"
                    target="_blank"
                  >
                    {{ t("onlineEvals.scorer.providerHelpSettingsLink") }}
                  </router-link>
                </template>
              </i18n-t>
            </div>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">{{ t("onlineEvals.scorer.modelLabel") }}</label>
            <OFormInput
              name="model"
              :placeholder="t('onlineEvals.scorer.modelPlaceholder')"
              size="sm"
              data-test="scorer-form-model-input"
            />
          </div>

          <div class="mb-3 flex flex-col gap-3.5">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.scorer.promptLabel") }}
              <span class="text-status-error-text ml-0.5">*</span>
            </label>
            <OFormTextarea
              name="template"
              size="sm"
              :rows="8"
              data-test="scorer-form-prompt-input"
            />
            <ScorerPromptVariableGuide />
            <div class="flex items-center flex-wrap gap-1.5 mt-1.5 text-2xs">
              <span class="text-text-secondary">
                {{ t("onlineEvals.scorer.promptVariablesLabel") }}
              </span>
              <span
                v-for="v in promptVariables"
                :key="v"
                class="py-px px-1.5 rounded-default text-2xs font-mono bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] text-text-body"
              >{{ formatTemplateVariable(v) }}</span>
            </div>
            <div class="text-2xs text-text-secondary mt-1">
              {{
                t("onlineEvals.scorer.promptHelp", {
                  inputVar: formatTemplateVariable("input"),
                  outputVar: formatTemplateVariable("output"),
                })
              }}
            </div>
          </div>

          <div class="mb-3 flex flex-col gap-3.5">
            <OFormCheckbox
              name="includeReasoning"
              class="scorer-extras__toggle"
              data-test="scorer-form-include-reasoning"
            >
              <template #label>
                <span>
                  <strong class="block text-xs text-text-heading">{{ t("onlineEvals.scorer.includeReasoningLabel") }}</strong>
                  <small class="block text-2xs text-text-secondary">{{ t("onlineEvals.scorer.includeReasoningHint") }}</small>
                </span>
              </template>
            </OFormCheckbox>

            <div class="flex justify-between items-baseline gap-3">
              <div class="flex flex-col gap-0.5">
                <strong class="text-xs font-semibold">{{ t("onlineEvals.scorer.extraFieldsLabel") }}</strong>
                <span class="text-3xs font-semibold text-text-muted uppercase tracking-[0.04em]">
                  {{ t("onlineEvals.scorer.extraFieldsOptional") }}
                </span>
                <small class="block text-2xs text-text-secondary">{{ t("onlineEvals.scorer.extraFieldsHint") }}</small>
              </div>
            </div>

            <div
              v-if="formValues.extraMetadataFields.length"
              class="flex flex-col gap-1.5 border border-border-default rounded-default p-[8px_10px] bg-card-bg"
              data-test="scorer-form-extra-fields"
            >
              <div class="grid grid-cols-[minmax(120px,1fr)_110px_minmax(140px,2fr)_28px] gap-2 items-center text-3xs font-semibold uppercase tracking-[0.04em]">
                <span>{{ t("onlineEvals.scorer.extraFields.colName") }}</span>
                <span>{{ t("onlineEvals.scorer.extraFields.colType") }}</span>
                <span>{{ t("onlineEvals.scorer.extraFields.colDescription") }}</span>
                <span aria-hidden="true" />
              </div>
              <div
                v-for="(field, idx) in formValues.extraMetadataFields"
                :key="idx"
                class="grid grid-cols-[minmax(120px,1fr)_110px_minmax(140px,2fr)_28px] gap-2 items-center"
              >
                <OFormInput
                  :name="`extraMetadataFields[${idx}].name`"
                  size="sm"
                  :placeholder="t('onlineEvals.scorer.extraFields.namePlaceholder')"
                  :class="{ 'has-error': field.name && extraFieldNameDuplicates.has(field.name) }"
                  :data-test="`scorer-form-extra-field-name-${idx}`"
                />
                <OFormSelect
                  :name="`extraMetadataFields[${idx}].type`"
                  size="md"
                  :options="extraFieldTypeOptions"
                  :data-test="`scorer-form-extra-field-type-${idx}`"
                />
                <OFormInput
                  :name="`extraMetadataFields[${idx}].description`"
                  size="sm"
                  :placeholder="t('onlineEvals.scorer.extraFields.descriptionPlaceholder')"
                  :data-test="`scorer-form-extra-field-description-${idx}`"
                />
                <button
                  type="button"
                  class="w-6 h-6 border-0 bg-transparent text-text-secondary text-base cursor-pointer rounded-default hover:bg-[color-mix(in_srgb,var(--color-status-error-text)_12%,transparent)] hover:text-status-error-text"
                  :aria-label="t('onlineEvals.buttons.remove')"
                  :data-test="`scorer-form-extra-field-remove-${idx}`"
                  @click="removeExtraField(idx)"
                >
                  ×
                </button>
              </div>
            </div>

            <div class="flex justify-between gap-3">
              <button
                type="button"
                class="border-0 bg-transparent py-1 px-0 text-xs font-semibold text-primary-600 cursor-pointer disabled:text-text-muted disabled:cursor-not-allowed"
                :disabled="formValues.extraMetadataFields.length >= MAX_EXTRA_FIELDS"
                data-test="scorer-form-extra-field-add"
                @click="addExtraField"
              >
                {{ t("onlineEvals.scorer.extraFields.addButton") }}
                <span class="font-normal text-text-secondary ml-1">
                  ({{ formValues.extraMetadataFields.length }} / {{ MAX_EXTRA_FIELDS }})
                </span>
              </button>

              <button
                type="button"
                class="scorer-extras__preview border-0 bg-transparent py-1 px-0 text-xs font-semibold text-primary-600 cursor-pointer"
                data-test="scorer-form-preview-schema"
                @click="previewOutputSchema"
              >
                {{ t("onlineEvals.scorer.extraFields.previewSchema") }}
              </button>
            </div>

          </div>
        </section>

        <!-- Section 02: Endpoint -->
        <section v-else class="mb-6">
          <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-2xs font-mono">02</span>
            <h3 class="m-0 text-sm font-semibold text-text-heading">{{ t("onlineEvals.scorer.endpointSection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.scorer.remoteUrlLabel") }}
              <span class="text-status-error-text ml-0.5">*</span>
            </label>
            <div class="scorer-url-bar grid grid-cols-[104px_minmax(0,1fr)] gap-0">
              <OFormSelect
                name="httpMethod"
                size="md"
                :options="httpMethodOptions"
                :searchable="false"
                data-test="scorer-form-remote-method-select"
              />
              <OFormInput
                name="remoteEndpoint"
                :placeholder="t('onlineEvals.scorer.remoteEndpointPlaceholder')"
                size="sm"
                data-test="scorer-form-remote-endpoint-input"
              />
            </div>
          </div>

          <div class="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
                {{ t("onlineEvals.scorer.remoteTimeoutLabel") }}
              </label>
              <OFormInput
                name="timeoutMs"
                type="number"
                size="sm"
                :min="0"
                data-test="scorer-form-remote-timeout"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
                {{ t("onlineEvals.scorer.remoteRetriesLabel") }}
              </label>
              <OFormInput
                name="maxRetries"
                type="number"
                size="sm"
                :min="0"
                data-test="scorer-form-remote-retries"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
                {{ t("onlineEvals.scorer.remoteBackoffLabel") }}
              </label>
              <OFormSelect
                name="backoffStrategy"
                size="md"
                :options="backoffOptions"
                :searchable="false"
                data-test="scorer-form-remote-backoff"
              />
            </div>
          </div>
        </section>

        <!-- Section 03: Authentication -->
        <section v-if="formValues.scorerType === 'remote'" class="mb-6">
          <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-2xs font-mono">03</span>
            <h3 class="m-0 text-sm font-semibold text-text-heading">{{ t("onlineEvals.scorer.authSection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.scorer.remoteAuthLabel") }}
            </label>
            <!-- Clearable so a user can return to "no auth": the auth-type
                 options list only bearer/basic/api_key (a "" option can't be
                 selected — OSelect treats "" as unselected), and each of those
                 makes its token fields required. Without the ✕, picking a type
                 by accident (or wanting to remove auth on edit) would be a trap
                 with no way back to the empty/no-auth state. -->
            <OFormSelect
              name="authType"
              size="md"
              :options="authTypeOptions"
              :searchable="false"
              :clearable="true"
              :placeholder="t('onlineEvals.scorer.remoteAuth.placeholder')"
              data-test="scorer-form-remote-auth-type"
            />
          </div>

          <div v-if="formValues.authType === 'bearer'" class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.scorer.remoteAuth.tokenLabel") }}
              <span class="text-status-error-text ml-0.5">*</span>
            </label>
            <OFormInput
              name="authBearerToken"
              :placeholder="t('onlineEvals.scorer.remoteAuth.bearerTokenPlaceholder')"
              size="sm"
              type="password"
              data-test="scorer-form-remote-auth-bearer-token"
            />
            <div class="text-2xs text-text-secondary mt-1">
              {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
            </div>
          </div>

          <div v-if="formValues.authType === 'basic'" class="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.usernameLabel") }}
                <span class="text-status-error-text ml-0.5">*</span>
              </label>
              <OFormInput
                name="authBasicUsername"
                :placeholder="t('onlineEvals.scorer.remoteAuth.basicUsernamePlaceholder')"
                size="sm"
                data-test="scorer-form-remote-auth-basic-username"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.passwordLabel") }}
                <span class="text-status-error-text ml-0.5">*</span>
              </label>
              <OFormInput
                name="authBasicPassword"
                :placeholder="t('onlineEvals.scorer.remoteAuth.basicPasswordPlaceholder')"
                size="sm"
                type="password"
                data-test="scorer-form-remote-auth-basic-password"
              />
              <div class="text-2xs text-text-secondary mt-1">
                {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
              </div>
            </div>
          </div>

          <div v-if="formValues.authType === 'api_key'" class="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.headerNameLabel") }}
                <span class="text-status-error-text ml-0.5">*</span>
              </label>
              <OFormInput
                name="authApiKeyHeaderName"
                :placeholder="t('onlineEvals.scorer.remoteAuth.apiKeyHeaderPlaceholder')"
                size="sm"
                data-test="scorer-form-remote-auth-apikey-header"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.tokenLabel") }}
                <span class="text-status-error-text ml-0.5">*</span>
              </label>
              <OFormInput
                name="authApiKeyToken"
                :placeholder="t('onlineEvals.scorer.remoteAuth.apiKeyTokenPlaceholder')"
                size="sm"
                type="password"
                data-test="scorer-form-remote-auth-apikey-token"
              />
              <div class="text-2xs text-text-secondary mt-1">
                {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
              </div>
            </div>
          </div>
        </section>

        <!-- Section 04: Custom headers -->
        <section v-if="formValues.scorerType === 'remote'" class="mb-6">
          <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-2xs font-mono">04</span>
            <h3 class="m-0 text-sm font-semibold text-text-heading">{{ t("onlineEvals.scorer.headersSection") }}</h3>
            <span class="ml-auto text-2xs text-text-secondary italic">
              {{ t("onlineEvals.scorer.remoteHeaders.subtitle") }}
            </span>
          </div>

          <div class="mb-3">
            <div
              v-if="formValues.customHeaders.length"
              class="flex flex-col gap-1.5 border border-border-default rounded-default p-[8px_10px] bg-card-bg"
              data-test="scorer-form-remote-headers"
            >
              <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-1.5 items-center text-3xs font-semibold uppercase tracking-[0.04em]">
                <span>{{ t("onlineEvals.scorer.remoteHeaders.colName") }}</span>
                <span>{{ t("onlineEvals.scorer.remoteHeaders.colValue") }}</span>
                <span aria-hidden="true" />
              </div>
              <div
                v-for="(header, idx) in formValues.customHeaders"
                :key="idx"
                class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-1.5 items-center"
              >
                <OFormInput
                  :name="`customHeaders[${idx}].key`"
                  size="sm"
                  :placeholder="t('onlineEvals.scorer.remoteHeaders.keyPlaceholder')"
                  :data-test="`scorer-form-remote-header-key-${idx}`"
                />
                <OFormInput
                  :name="`customHeaders[${idx}].value`"
                  size="sm"
                  :placeholder="t('onlineEvals.scorer.remoteHeaders.valuePlaceholder')"
                  :data-test="`scorer-form-remote-header-value-${idx}`"
                />
                <button
                  type="button"
                  class="w-6 h-6 border-0 bg-transparent text-text-secondary text-base cursor-pointer rounded-default hover:bg-[color-mix(in_srgb,var(--color-status-error-text)_12%,transparent)] hover:text-status-error-text"
                  :aria-label="t('onlineEvals.buttons.remove')"
                  :data-test="`scorer-form-remote-header-remove-${idx}`"
                  @click="removeCustomHeader(idx)"
                >
                  ×
                </button>
              </div>
            </div>

            <div class="flex justify-between gap-3">
              <button
                type="button"
                class="border-0 bg-transparent py-1 px-0 text-xs font-semibold text-primary-600 cursor-pointer"
                data-test="scorer-form-remote-header-add"
                @click="addCustomHeader"
              >
                {{ t("onlineEvals.scorer.remoteHeaders.addButton") }}
              </button>
            </div>
          </div>
        </section>

        <!-- Section 05: Request body template -->
        <section v-if="formValues.scorerType === 'remote'" class="mb-6">
          <div class="flex items-center gap-2.5 pb-2.5 border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-5.5 h-5.5 rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-2xs font-mono">05</span>
            <h3 class="m-0 text-sm font-semibold text-text-heading">{{ t("onlineEvals.scorer.requestBodySection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-heading mb-1">
              {{ t("onlineEvals.scorer.requestBodyLabel") }}
              <span class="text-status-error-text ml-0.5">*</span>
            </label>
            <OFormTextarea
              name="template"
              size="sm"
              :rows="10"
              data-test="scorer-form-request-body-input"
            />
            <div class="flex items-center flex-wrap gap-1.5 mt-1.5 text-2xs">
              <span class="text-text-secondary">
                {{ t("onlineEvals.scorer.promptVariablesLabel") }}
              </span>
              <span
                v-for="v in promptVariables"
                :key="v"
                class="py-px px-1.5 rounded-default text-2xs font-mono bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] text-text-body"
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

    <footer class="sticky bottom-0 flex items-center justify-end gap-2 px-5.5 py-3 bg-surface-base border-t border-border-default shrink-0 z-1">
      <OButton
        data-test="scorer-form-cancel-btn"
        type="button"
        variant="outline"
        size="sm-action"
        :disabled="isSubmitting"
        @click="$emit('cancel')"
      >
        {{ t("onlineEvals.buttons.cancel") }}
      </OButton>
      <OButton
        data-test="scorer-form-save-btn"
        type="submit"
        variant="primary"
        size="sm-action"
        :loading="isSubmitting"
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
      <p v-if="isLoadingSchemaPreview" class="m-0 p-3 text-xs text-text-secondary">
        {{ t("onlineEvals.scorer.extraFields.schemaLoading") }}
      </p>
      <p
        v-else-if="schemaPreviewError"
        class="m-0 p-3 text-xs text-status-error-text"
      >
        {{ schemaPreviewError }}
      </p>
      <pre class="m-0 max-h-[60vh] overflow-auto p-3 rounded-default bg-card-bg border border-border-default font-normal text-xs font-(family-name:--font-mono) text-text-body whitespace-pre [tab-size:2]" v-else>{{ schemaPreview }}</pre>

      <template #footer>
        <div class="flex items-center justify-between gap-2 w-full">
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
    </OPageLayout>
  </OForm>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRef } from "vue";
import { useI18n } from "vue-i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OFormTextarea from "@/lib/forms/Input/OFormTextarea.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OFormCheckbox from "@/lib/forms/Checkbox/OFormCheckbox.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
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
import ScorerPromptVariableGuide from "./scorer/ScorerPromptVariableGuide.vue";
import ScorerTestPanel from "./scorer/ScorerTestPanel.vue";
import {
  makeScorerFormSchema,
  type ScorerForm,
} from "./ScorerFormPage.schema";

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

// Co-located Zod schema (factory keeps messages i18n-driven). The form is
// mounted fresh for each create/edit action, so building it once is safe.
const scorerFormSchema = makeScorerFormSchema(t);

// This component owns <OForm>, so it creates the form with useOForm and reads it
// reactively via form.useStore. `formValues` drives the template reads that need
// live form state: the
// `scorerType`/`authType` `v-if` sections, the previews
// (selectedScoreConfig/selectedProvider), the duplicate-field highlight, the
// repeatable-row arrays (extraMetadataFields/customHeaders), and the live Scorer
// Test panel + schema-preview. Writes go through form.setFieldValue; the @submit
// handler builds the payload from the validated `value`.
const form = useOForm<ScorerForm>({
  defaultValues: initForm(props.row, props.scorerType),
  schema: scorerFormSchema,
  onSubmit: save,
});
const formValues = form.useStore((s: any) => s.values as ScorerForm);

const {
  scorerTestInputs,
  scorerTestState,
  scorerTestVariables,
  scorerTestResult,
  scorerTestError,
  runScorerTest,
} = useScorerTest(toRef(() => formValues.value.template));

const canRunScorerTest = computed(() => {
  if (!props.orgId) return false;
  if (!formValues.value.name?.trim()) return false;
  if (!formValues.value.template?.trim()) return false;
  if (formValues.value.scorerType === "llm_judge") {
    if (!formValues.value.providerId) return false;
  } else if (formValues.value.scorerType === "remote") {
    if (!formValues.value.remoteEndpoint?.trim()) return false;
  }
  if (scorerTestVariables.value.length === 0) return false;
  return scorerTestVariables.value.every((variable) =>
    String(scorerTestInputs.value[variable] ?? "").trim().length > 0,
  );
});

function buildScorerTestPayload() {
  const isLlmJudge = formValues.value.scorerType === "llm_judge";
  const scoreConfigRef: Record<string, any> = {};
  if (formValues.value.producesScoreConfigId) {
    scoreConfigRef.producesScoreConfigId = formValues.value.producesScoreConfigId;
    if (
      formValues.value.pinScoreConfigVersion &&
      formValues.value.producesScoreConfigVersion
    ) {
      scoreConfigRef.producesScoreConfigVersion = Number(
        formValues.value.producesScoreConfigVersion,
      );
    }
  }

  const scorer = isLlmJudge
    ? {
        type: "llm_judge" as const,
        ...scoreConfigRef,
        template: formValues.value.template,
        params: {
          provider_id: formValues.value.providerId,
          ...(formValues.value.model.trim() ? { model: formValues.value.model.trim() } : {}),
          include_reasoning: formValues.value.includeReasoning,
          ...(cleanedExtraFields.value.length
            ? { extra_metadata_fields: cleanedExtraFields.value }
            : {}),
        },
      }
    : {
        type: "remote" as const,
        ...scoreConfigRef,
        template: formValues.value.template,
        params: buildRemoteParams(formValues.value),
      };

  return {
    name: formValues.value.name.trim(),
    ...(formValues.value.description?.trim()
      ? { description: formValues.value.description.trim() }
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

// Custom headers are a FORM-OWNED field-array — add/remove operate directly on
// the one form (the single source of truth); the template v-for + build helpers
// read it back via `formValues`.
function addCustomHeader() {
  const cur = formValues.value.customHeaders;
  form.setFieldValue("customHeaders", [...cur, { key: "", value: "" }], {
    dontUpdateMeta: true,
  });
}

function removeCustomHeader(index: number) {
  const cur = formValues.value.customHeaders;
  form.setFieldValue(
    "customHeaders",
    cur.filter((_, i) => i !== index),
    { dontUpdateMeta: true },
  );
}

// Pure cleaners — used reactively against the read-mirror (the computeds below,
// for the live duplicate-name highlight + the Test panel) AND at @submit against
// the validated `value`. They take their source so the @submit handler never
// reads the mirror.
function cleanHeaders(headers: CustomHeader[]) {
  return headers
    .map((h) => ({ key: h.key.trim(), value: h.value }))
    .filter((h) => h.key.length > 0);
}

function cleanExtraFields(fields: ExtraMetadataField[]): ExtraMetadataField[] {
  return fields
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
    }));
}

const cleanedCustomHeaders = computed(() => cleanHeaders(formValues.value.customHeaders));
const cleanedExtraFields = computed<ExtraMetadataField[]>(() =>
  cleanExtraFields(formValues.value.extraMetadataFields),
);

// Builds the remote `auth` / `params` from a SOURCE object — the live `form`
// mirror for the Test panel, or the validated `value` at @submit.
function buildAuthPayload(src: ScorerForm): Record<string, any> | null {
  const kind = src.authType;
  if (kind === "bearer") {
    const token = src.authBearerToken.trim();
    if (!token) return null;
    return { type: "bearer", token };
  }
  if (kind === "basic") {
    const username = src.authBasicUsername.trim();
    const password = src.authBasicPassword.trim();
    if (!username || !password) return null;
    return { type: "basic", username, password };
  }
  if (kind === "api_key") {
    const token = src.authApiKeyToken.trim();
    const headerName = src.authApiKeyHeaderName.trim();
    if (!token || !headerName) return null;
    return { type: "api_key", token, header_name: headerName };
  }
  return null;
}

function buildRemoteParams(src: ScorerForm): Record<string, any> {
  const params: Record<string, any> = {
    // Trim stray whitespace around a pasted URL so it never reaches the payload.
    endpoint: src.remoteEndpoint.trim(),
    http_method: src.httpMethod || DEFAULT_HTTP_METHOD,
    timeout_ms: Number(src.timeoutMs) || DEFAULT_TIMEOUT_MS,
  };
  const retries = Number(src.maxRetries);
  if (Number.isFinite(retries) && retries > 0) params.max_retries = retries;
  const auth = buildAuthPayload(src);
  if (auth) params.auth = auth;
  const headers = cleanHeaders(src.customHeaders);
  if (headers.length) params.custom_headers = headers;
  return params;
}

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

// Extra-metadata fields are a FORM-OWNED field-array — see addCustomHeader.
function addExtraField() {
  const cur = formValues.value.extraMetadataFields;
  if (cur.length >= MAX_EXTRA_FIELDS) return;
  form.setFieldValue(
    "extraMetadataFields",
    [...cur, { name: "", type: "string", description: "" }],
    { dontUpdateMeta: true },
  );
}

function removeExtraField(index: number) {
  const cur = formValues.value.extraMetadataFields;
  form.setFieldValue(
    "extraMetadataFields",
    cur.filter((_, i) => i !== index),
    { dontUpdateMeta: true },
  );
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
        ...(formValues.value.producesScoreConfigId
          ? { producesScoreConfigId: formValues.value.producesScoreConfigId }
          : {}),
        ...(formValues.value.pinScoreConfigVersion && formValues.value.producesScoreConfigVersion
          ? { producesScoreConfigVersion: Number(formValues.value.producesScoreConfigVersion) }
          : {}),
        includeReasoning: formValues.value.includeReasoning,
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
  const isRemote = formValues.value.scorerType === "remote";
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
  props.scoreConfigs.find((c) => entityId(c) === formValues.value.producesScoreConfigId) || null,
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
  () => props.providers.find((p) => p.id === formValues.value.providerId) || null,
);

const promptVariables = computed(() => extractTemplateVariables(formValues.value.template || ""));

onMounted(() => {
  if (props.mode === "edit" && formValues.value.producesScoreConfigId) {
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

function initForm(row: Scorer | null, scorerType: ScorerType): ScorerForm {
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
  form.setFieldValue("pinScoreConfigVersion", false);
  form.setFieldValue("producesScoreConfigVersion", "");
  await prepareSelectedScoreConfigVersion(false);
}

async function prepareSelectedScoreConfigVersion(keepSelectedVersion: boolean) {
  const selectedId = formValues.value.producesScoreConfigId;
  if (!selectedId) return;

  emit("request-versions", selectedId);
  await Promise.resolve();

  const versions = props.scoreConfigVersions[selectedId];
  const latestVersion = versions?.[0]?.version;
  if (!latestVersion) return;

  const currentVersion = formValues.value.producesScoreConfigVersion;
  const selectedVersionExists =
    Array.isArray(versions) && versions.some((c) => String(c.version) === currentVersion);

  if (!keepSelectedVersion || !currentVersion || !selectedVersionExists) {
    form.setFieldValue("producesScoreConfigVersion", String(latestVersion));
  }
}

// @submit handler — OForm only calls this once the whole schema passes (incl.
// the conditional auth/provider/endpoint requireds + extra-field uniqueness), so
// the schema (not a manual guard) gates the save. OForm awaits this promise → the
// Save spinner spans the save.
async function save(value: ScorerForm) {
  if (!props.orgId) return;
  try {
    const isLlmJudge = value.scorerType === "llm_judge";
    // producesScoreConfigVersion / pinScoreConfigVersion are set programmatically
    // (handleScoreConfigSelection / version-prep) but they ARE schema fields, so
    // the validated `value` carries them — read the single source of truth.
    const scoreConfigRef = {
      producesScoreConfigId: value.producesScoreConfigId || null,
      producesScoreConfigVersion:
        value.pinScoreConfigVersion && value.producesScoreConfigVersion
          ? Number(value.producesScoreConfigVersion)
          : null,
    };
    const extraFields = cleanExtraFields(value.extraMetadataFields);
    const scorerPayload: Record<string, any> = isLlmJudge
      ? {
          type: "llm_judge",
          ...scoreConfigRef,
          template: value.template,
          params: {
            provider_id: value.providerId,
            ...(value.model.trim() ? { model: value.model.trim() } : {}),
            include_reasoning: value.includeReasoning,
            ...(extraFields.length
              ? { extra_metadata_fields: extraFields }
              : {}),
          },
        }
      : {
          type: "remote",
          ...scoreConfigRef,
          template: value.template,
          params: buildRemoteParams(value),
        };

    if (props.mode === "edit" && props.row) {
      await onlineEvalsService.scorers.update(props.orgId, entityId(props.row), {
        name: value.name.trim(),
        description: value.description?.trim() || null,
        scorer: scorerPayload,
      });
    } else {
      await onlineEvalsService.scorers.create(props.orgId, {
        name: value.name.trim(),
        description: value.description?.trim() || null,
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
  }
}
</script>

<style scoped>
/* keep(complex-state): the global `label:not(.o-input-label)` element rule
   (unlayered) out-specifies the color/weight/size utilities on these field
   labels, graying them out — this higher-specificity :not() selector restores
   the primary color + weight/size. */
.scorer-form__main label:not(.o-input-label) {
  color: var(--color-text-heading, currentColor);
  font-weight: 600;
  font-size: var(--text-xs);
}

/* keep(lib-override:o2-forms): native <textarea>/<select>/<input> rendered inside
   OFormTextarea / OFormSelect / OFormInput are child-component DOM reachable only
   through :deep(); the url-bar rules butt-join the method select and endpoint
   input into one control. */
.scorer-form__main :deep(textarea) {
  max-height: 17.5rem;
  overflow-y: auto;
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
</style>
