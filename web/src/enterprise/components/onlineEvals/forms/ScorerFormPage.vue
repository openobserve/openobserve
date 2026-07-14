<template>
  <form class="scorer-form flex flex-col flex-1 min-h-0 gap-2.5" @submit.prevent="save">
    <!-- Shared page header (same as JobFormPage) so the two eval forms read
         identically: Back pill in the module-icon slot, title, and the
         scorer-type badge + close button in #actions. -->
    <AppPageHeader
      :back="{
        label: t('onlineEvals.scorer.backTo'),
        onClick: () => $emit('cancel'),
        dataTest: 'scorer-form-back-btn',
      }"
      class="px-3 border-b border-border-default"
      style="flex-shrink: 0"
    >
      <template #title>
        <span data-test="scorer-form-title">{{ titleText }}</span>
      </template>
      <!-- Scorer-type badge sits inline, immediately after the title. -->
      <template #title-trail>
        <OTag
          type="scorerType"
          :value="form.scorerType"
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
          @click="$emit('cancel')"
        />
      </template>
    </AppPageHeader>

    <div class="flex-1 min-h-0 overflow-hidden grid grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)] max-[1100px]:grid-cols-1 gap-2.5">
      <div class="scorer-form__main min-w-0 overflow-auto p-[18px_24px_24px] bg-surface-base rounded-md shadow-[0_0_0.313rem_0.063rem_var(--color-hover-shadow)]">
        <!-- Section 01: Identity -->
        <section class="mb-6">
          <div class="flex items-center gap-[10px] pb-[10px] border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-[11px] font-mono">01</span>
            <h3 class="m-0 text-sm font-semibold text-text-primary">{{ t("onlineEvals.scorer.identitySection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
              {{ t("onlineEvals.scorer.nameLabel") }}
              <span class="text-status-error-text ml-[2px]">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-text-secondary" />
            </label>
            <OInput
              v-model.trim="form.name"
              :placeholder="t('onlineEvals.scorer.namePlaceholder')"
              size="sm"
              :disabled="mode === 'edit'"
              data-test="scorer-form-name-input"
            />
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
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

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
              {{ t("onlineEvals.scorer.producesScoreConfigLabel") }}
              <span class="text-status-error-text ml-[2px]">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="ml-1.5 text-text-secondary" />
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
            <div class="text-[11.5px] text-text-secondary mt-1">{{ t("onlineEvals.scorer.producesScoreHelp") }}</div>

            <div v-if="selectedScoreConfig" class="flex items-center flex-wrap gap-[6px_10px] p-[8px_12px] mt-2 border border-[color-mix(in_srgb,var(--color-status-info-text)_25%,transparent)] rounded-md bg-[color-mix(in_srgb,var(--color-status-info-text)_8%,transparent)] text-xs text-text-primary">
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
        <section v-if="form.scorerType === 'llm_judge'" class="mb-6">
          <div class="flex items-center gap-[10px] pb-[10px] border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-[11px] font-mono">02</span>
            <h3 class="m-0 text-sm font-semibold text-text-primary">{{ t("onlineEvals.scorer.judgeSection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
              {{ t("onlineEvals.scorer.providerLabel") }}
              <span class="text-status-error-text ml-[2px]">*</span>
            </label>
            <div class="flex items-center gap-2">
              <OSelect
                v-model="form.providerId"
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

            <div v-if="selectedProvider" class="flex items-center flex-wrap gap-[6px_10px] p-[8px_12px] mt-2 border border-[color-mix(in_srgb,var(--color-status-info-text)_25%,transparent)] rounded-md bg-[color-mix(in_srgb,var(--color-status-info-text)_8%,transparent)] text-xs text-text-primary">
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

            <div class="text-[11.5px] text-text-secondary mt-1">
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
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">{{ t("onlineEvals.scorer.modelLabel") }}</label>
            <OInput
              v-model.trim="form.model"
              :placeholder="t('onlineEvals.scorer.modelPlaceholder')"
              size="sm"
              data-test="scorer-form-model-input"
            />
          </div>

          <div class="mb-3 flex flex-col gap-[14px]">
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
              {{ t("onlineEvals.scorer.promptLabel") }}
              <span class="text-status-error-text ml-[2px]">*</span>
            </label>
            <OInput
              v-model="form.template"
              type="textarea"
              size="sm"
              :rows="8"
              data-test="scorer-form-prompt-input"
            />
            <div class="flex items-center flex-wrap gap-1.5 mt-1.5 text-[11.5px]">
              <span class="text-text-secondary">
                {{ t("onlineEvals.scorer.promptVariablesLabel") }}
              </span>
              <span
                v-for="v in promptVariables"
                :key="v"
                class="py-[1px] px-1.5 rounded-[3px] text-[11px] font-mono bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] text-text-primary"
              >{{ formatTemplateVariable(v) }}</span>
            </div>
            <div class="text-[11.5px] text-text-secondary mt-1">
              {{
                t("onlineEvals.scorer.promptHelp", {
                  inputVar: formatTemplateVariable("input"),
                  outputVar: formatTemplateVariable("output"),
                })
              }}
            </div>
          </div>

          <div class="mb-3 flex flex-col gap-[14px]">
            <label class="flex items-start gap-2 cursor-pointer">
              <input
                v-model="form.includeReasoning"
                type="checkbox"
                data-test="scorer-form-include-reasoning"
              />
              <span>
                <strong class="block text-xs text-text-primary">{{ t("onlineEvals.scorer.includeReasoningLabel") }}</strong>
                <small class="block text-[11px] text-text-secondary">{{ t("onlineEvals.scorer.includeReasoningHint") }}</small>
              </span>
            </label>

            <div class="flex justify-between items-baseline gap-3">
              <div class="flex flex-col gap-0.5">
                <strong class="text-xs font-semibold">{{ t("onlineEvals.scorer.extraFieldsLabel") }}</strong>
                <span class="text-[10px] font-semibold text-text-muted uppercase tracking-[0.04em]">
                  {{ t("onlineEvals.scorer.extraFieldsOptional") }}
                </span>
                <small class="block text-[11px] text-text-secondary">{{ t("onlineEvals.scorer.extraFieldsHint") }}</small>
              </div>
            </div>

            <div
              v-if="form.extraMetadataFields.length"
              class="flex flex-col gap-1.5 border border-border-default rounded-md p-[8px_10px] bg-card-glass-solid"
              data-test="scorer-form-extra-fields"
            >
              <div class="grid grid-cols-[minmax(120px,1fr)_110px_minmax(140px,2fr)_28px] gap-2 items-center text-[10px] font-semibold uppercase tracking-[0.04em]">
                <span>{{ t("onlineEvals.scorer.extraFields.colName") }}</span>
                <span>{{ t("onlineEvals.scorer.extraFields.colType") }}</span>
                <span>{{ t("onlineEvals.scorer.extraFields.colDescription") }}</span>
                <span aria-hidden="true" />
              </div>
              <div
                v-for="(field, idx) in form.extraMetadataFields"
                :key="idx"
                class="grid grid-cols-[minmax(120px,1fr)_110px_minmax(140px,2fr)_28px] gap-2 items-center"
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
                  size="md"
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
                  class="w-6 h-6 border-0 bg-transparent text-text-secondary text-base cursor-pointer rounded hover:bg-[color-mix(in_srgb,var(--color-status-error-text)_12%,transparent)] hover:text-status-error-text"
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
                :disabled="form.extraMetadataFields.length >= MAX_EXTRA_FIELDS"
                data-test="scorer-form-extra-field-add"
                @click="addExtraField"
              >
                {{ t("onlineEvals.scorer.extraFields.addButton") }}
                <span class="font-normal text-text-secondary ml-1">
                  ({{ form.extraMetadataFields.length }} / {{ MAX_EXTRA_FIELDS }})
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
          <div class="flex items-center gap-[10px] pb-[10px] border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-[11px] font-mono">02</span>
            <h3 class="m-0 text-sm font-semibold text-text-primary">{{ t("onlineEvals.scorer.endpointSection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
              {{ t("onlineEvals.scorer.remoteUrlLabel") }}
              <span class="text-status-error-text ml-[2px]">*</span>
            </label>
            <div class="scorer-url-bar grid grid-cols-[104px_minmax(0,1fr)] gap-0">
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

          <div class="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
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
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
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
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
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
        <section v-if="form.scorerType === 'remote'" class="mb-6">
          <div class="flex items-center gap-[10px] pb-[10px] border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-[11px] font-mono">03</span>
            <h3 class="m-0 text-sm font-semibold text-text-primary">{{ t("onlineEvals.scorer.authSection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
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

          <div v-if="form.authType === 'bearer'" class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
              {{ t("onlineEvals.scorer.remoteAuth.tokenLabel") }}
              <span class="text-status-error-text ml-[2px]">*</span>
            </label>
            <OInput
              v-model.trim="form.authBearerToken"
              :placeholder="t('onlineEvals.scorer.remoteAuth.bearerTokenPlaceholder')"
              size="sm"
              type="password"
              data-test="scorer-form-remote-auth-bearer-token"
            />
            <div class="text-[11.5px] text-text-secondary mt-1">
              {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
            </div>
          </div>

          <div v-if="form.authType === 'basic'" class="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.usernameLabel") }}
                <span class="text-status-error-text ml-[2px]">*</span>
              </label>
              <OInput
                v-model.trim="form.authBasicUsername"
                :placeholder="t('onlineEvals.scorer.remoteAuth.basicUsernamePlaceholder')"
                size="sm"
                data-test="scorer-form-remote-auth-basic-username"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.passwordLabel") }}
                <span class="text-status-error-text ml-[2px]">*</span>
              </label>
              <OInput
                v-model.trim="form.authBasicPassword"
                :placeholder="t('onlineEvals.scorer.remoteAuth.basicPasswordPlaceholder')"
                size="sm"
                type="password"
                data-test="scorer-form-remote-auth-basic-password"
              />
              <div class="text-[11.5px] text-text-secondary mt-1">
                {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
              </div>
            </div>
          </div>

          <div v-if="form.authType === 'api_key'" class="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.headerNameLabel") }}
                <span class="text-status-error-text ml-[2px]">*</span>
              </label>
              <OInput
                v-model.trim="form.authApiKeyHeaderName"
                :placeholder="t('onlineEvals.scorer.remoteAuth.apiKeyHeaderPlaceholder')"
                size="sm"
                data-test="scorer-form-remote-auth-apikey-header"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.tokenLabel") }}
                <span class="text-status-error-text ml-[2px]">*</span>
              </label>
              <OInput
                v-model.trim="form.authApiKeyToken"
                :placeholder="t('onlineEvals.scorer.remoteAuth.apiKeyTokenPlaceholder')"
                size="sm"
                type="password"
                data-test="scorer-form-remote-auth-apikey-token"
              />
              <div class="text-[11.5px] text-text-secondary mt-1">
                {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
              </div>
            </div>
          </div>
        </section>

        <!-- Section 04: Custom headers -->
        <section v-if="form.scorerType === 'remote'" class="mb-6">
          <div class="flex items-center gap-[10px] pb-[10px] border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-[11px] font-mono">04</span>
            <h3 class="m-0 text-sm font-semibold text-text-primary">{{ t("onlineEvals.scorer.headersSection") }}</h3>
            <span class="ml-auto text-[11.5px] text-text-secondary italic">
              {{ t("onlineEvals.scorer.remoteHeaders.subtitle") }}
            </span>
          </div>

          <div class="mb-3">
            <div
              v-if="form.customHeaders.length"
              class="flex flex-col gap-1.5 border border-border-default rounded-md p-[8px_10px] bg-card-glass-solid"
              data-test="scorer-form-remote-headers"
            >
              <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-1.5 items-center text-[10px] font-semibold uppercase tracking-[0.04em]">
                <span>{{ t("onlineEvals.scorer.remoteHeaders.colName") }}</span>
                <span>{{ t("onlineEvals.scorer.remoteHeaders.colValue") }}</span>
                <span aria-hidden="true" />
              </div>
              <div
                v-for="(header, idx) in form.customHeaders"
                :key="idx"
                class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-1.5 items-center"
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
                  class="w-6 h-6 border-0 bg-transparent text-text-secondary text-base cursor-pointer rounded hover:bg-[color-mix(in_srgb,var(--color-status-error-text)_12%,transparent)] hover:text-status-error-text"
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
        <section v-if="form.scorerType === 'remote'" class="mb-6">
          <div class="flex items-center gap-[10px] pb-[10px] border-b border-dialog-header-border mb-3">
            <span class="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] text-text-secondary font-bold text-[11px] font-mono">05</span>
            <h3 class="m-0 text-sm font-semibold text-text-primary">{{ t("onlineEvals.scorer.requestBodySection") }}</h3>
          </div>

          <div class="mb-3">
            <label class="flex items-center text-xs font-semibold text-text-primary mb-1">
              {{ t("onlineEvals.scorer.requestBodyLabel") }}
              <span class="text-status-error-text ml-[2px]">*</span>
            </label>
            <OInput
              v-model="form.template"
              type="textarea"
              size="sm"
              :rows="10"
              data-test="scorer-form-request-body-input"
            />
            <div class="flex items-center flex-wrap gap-1.5 mt-1.5 text-[11.5px]">
              <span class="text-text-secondary">
                {{ t("onlineEvals.scorer.promptVariablesLabel") }}
              </span>
              <span
                v-for="v in promptVariables"
                :key="v"
                class="py-[1px] px-1.5 rounded-[3px] text-[11px] font-mono bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] text-text-primary"
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

    <footer class="sticky bottom-0 flex items-center justify-end gap-2 px-5.5 py-3 bg-surface-base rounded-md shadow-[0_0_0.313rem_0.063rem_var(--color-hover-shadow)] shrink-0 z-1">
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
      <p v-if="isLoadingSchemaPreview" class="m-0 p-3 text-xs text-text-secondary">
        {{ t("onlineEvals.scorer.extraFields.schemaLoading") }}
      </p>
      <p
        v-else-if="schemaPreviewError"
        class="m-0 p-3 text-xs text-status-error-text"
      >
        {{ schemaPreviewError }}
      </p>
      <pre class="m-0 max-h-[60vh] overflow-auto p-3 rounded-md bg-card-glass-solid border border-border-default font-normal text-xs font-(family-name:--font-mono) text-text-primary whitespace-pre [tab-size:2]" v-else>{{ schemaPreview }}</pre>

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
import AppPageHeader from "@/components/common/AppPageHeader.vue";
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

<style>
/* The global `label:not(.o-input-label)` rule (unlayered) overrides these
   field labels' `text-text-primary`/`font-semibold`/`text-xs`
   utilities, graying them out. This higher-specificity selector restores the
   dark primary color + weight/size, matching main's scoped `.scorer-field__label`. */
.scorer-form__main label:not(.o-input-label) {
  color: var(--color-text-primary, currentColor);
  font-weight: 600;
  font-size: 12px;
}

.scorer-form__main textarea {
  max-height: 280px;
  overflow-y: auto;
}

.scorer-url-bar .o-select__trigger,
.scorer-url-bar select {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.scorer-url-bar input {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
}
</style>
