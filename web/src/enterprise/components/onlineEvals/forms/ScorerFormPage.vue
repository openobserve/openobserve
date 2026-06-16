<template>
  <form class="tw:flex tw:flex-col tw:flex-1 tw:min-h-0 tw:gap-2.5" @submit.prevent="save">
    <div class="tw:flex tw:items-center tw:gap-2.5 tw:min-h-12 tw:px-3.5 tw:py-2 tw:bg-(--o2-card-bg) tw:rounded-md tw:shadow-[0_0_0.313rem_0.063rem_var(--o2-hover-shadow)] tw:shrink-0">
      <OButton
        variant="outline"
        size="icon-sm"
        icon-left="arrow-back-ios-new"
        data-test="scorer-form-back-btn"
        :title="t('onlineEvals.scorer.backTo')"
        @click="$emit('cancel')"
      />
      <h1 class="tw:m-0 tw:text-[17px] tw:font-semibold tw:text-text-primary tw:tracking-[0.005em] tw:whitespace-nowrap">{{ titleText }}</h1>
      <span class="tw:text-text-secondary tw:text-xs tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:min-w-0">
        {{
          form.scorerType === "remote"
            ? t("onlineEvals.scorer.subtitleRemote")
            : t("onlineEvals.scorer.subtitleLlm")
        }}
      </span>
      <div class="tw:flex-1 tw:min-w-2" />
      <span
        class="tw:py-[3px] tw:px-2 tw:rounded tw:font-bold tw:text-[11px] tw:bg-[color-mix(in_srgb,var(--color-text-primary)_10%,transparent)] tw:text-(--color-text-primary) tw:whitespace-nowrap"
        :class="{
          'tw:bg-[color-mix(in_srgb,var(--o2-status-info-text)_14%,transparent)]! tw:text-(--o2-status-info-text)!': form.scorerType === 'llm_judge',
          'tw:bg-[color-mix(in_srgb,var(--o2-status-success-text)_14%,transparent)]! tw:text-(--o2-status-success-text)!': form.scorerType === 'remote',
        }"
      >
        {{
          form.scorerType === "remote"
            ? t("onlineEvals.scorer.badgeRemote")
            : t("onlineEvals.scorer.badgeLlm")
        }}
      </span>
      <button
        type="button"
        class="scorer-form__close tw:inline-flex tw:items-center tw:justify-center tw:w-7 tw:h-7 tw:p-0 tw:text-(--color-text-secondary) tw:bg-transparent tw:border-0 tw:rounded-md tw:cursor-pointer tw:transition-[background,color] tw:duration-[150ms]"
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

    <div class="tw:flex-1 tw:min-h-0 tw:overflow-hidden tw:grid tw:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)] max-[1100px]:tw:grid-cols-1 tw:gap-2.5">
      <div class="scorer-form__main tw:min-w-0 tw:overflow-auto tw:p-[18px_24px_24px] tw:bg-(--o2-card-bg) tw:rounded-md tw:shadow-[0_0_0.313rem_0.063rem_var(--o2-hover-shadow)]">
        <!-- Section 01: Identity -->
        <section class="tw:mb-6">
          <div class="tw:flex tw:items-center tw:gap-[10px] tw:pb-[10px] tw:border-b tw:border-(--color-dialog-header-border) tw:mb-3">
            <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-[22px] tw:h-[22px] tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary) tw:font-bold tw:text-[11px] tw:font-mono">01</span>
            <h3 class="tw:m-0 tw:text-sm tw:font-semibold tw:text-(--color-text-primary)">{{ t("onlineEvals.scorer.identitySection") }}</h3>
          </div>

          <div class="tw:mb-3">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.scorer.nameLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="tw:ml-1.5 tw:text-(--color-text-secondary)" />
            </label>
            <OInput
              v-model.trim="form.name"
              :placeholder="t('onlineEvals.scorer.namePlaceholder')"
              size="sm"
              :disabled="mode === 'edit'"
              data-test="scorer-form-name-input"
            />
          </div>

          <div class="tw:mb-3">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
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

          <div class="tw:mb-3">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.scorer.producesScoreConfigLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
              <OIcon v-if="mode === 'edit'" name="lock" size="xs" class="tw:ml-1.5 tw:text-(--color-text-secondary)" />
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
            <div class="tw:text-[11.5px] tw:text-(--color-text-secondary) tw:mt-1">{{ t("onlineEvals.scorer.producesScoreHelp") }}</div>

            <div v-if="selectedScoreConfig" class="tw:flex tw:items-center tw:flex-wrap tw:gap-[6px_10px] tw:p-[8px_12px] tw:mt-2 tw:border tw:border-[color-mix(in_srgb,var(--o2-status-info-text)_25%,transparent)] tw:rounded-md tw:bg-[color-mix(in_srgb,var(--o2-status-info-text)_8%,transparent)] tw:text-xs tw:text-(--color-text-primary)">
              <span class="tw:w-2 tw:h-2 tw:rounded-full tw:bg-(--o2-status-info-text) tw:shrink-0" />
              <span class="tw:font-medium">
                {{ t("onlineEvals.scorer.selectedPrefix") }}
                <strong class="tw:font-mono">{{ selectedScoreConfig.name }}</strong>
              </span>
              <span class="tw:text-(--color-text-secondary)">·</span>
              <span class="tw:text-(--color-text-secondary)">
                {{ t("onlineEvals.scorer.typeLabel") }}
                <span class="tw:font-mono">{{ dataTypeOf(selectedScoreConfig) }}</span>
              </span>
              <template v-if="selectedRange">
                <span class="tw:text-(--color-text-secondary)">·</span>
                <span class="tw:text-(--color-text-secondary)">
                  {{ t("onlineEvals.scorer.rangeLabel") }}
                  <span class="tw:font-mono">{{ selectedRange }}</span>
                </span>
              </template>
              <span class="tw:text-(--color-text-secondary)">·</span>
              <span class="tw:text-(--color-text-secondary)">
                {{ t("onlineEvals.scorer.healthyLabel") }}
                <span class="tw:font-mono">{{ selectedHealthy }}</span>
              </span>
            </div>
          </div>
        </section>

        <!-- Section 02: LLM Judge configuration -->
        <section v-if="form.scorerType === 'llm_judge'" class="tw:mb-6">
          <div class="tw:flex tw:items-center tw:gap-[10px] tw:pb-[10px] tw:border-b tw:border-(--color-dialog-header-border) tw:mb-3">
            <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-[22px] tw:h-[22px] tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary) tw:font-bold tw:text-[11px] tw:font-mono">02</span>
            <h3 class="tw:m-0 tw:text-sm tw:font-semibold tw:text-(--color-text-primary)">{{ t("onlineEvals.scorer.judgeSection") }}</h3>
          </div>

          <div class="tw:mb-3">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.scorer.providerLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
            </label>
            <div class="tw:flex tw:items-center tw:gap-2">
              <OSelect
                v-model="form.providerId"
                :options="providerOptions"
                :placeholder="t('onlineEvals.scorer.providerPlaceholder')"
                size="md"
                class="tw:flex-1 tw:min-w-0"
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

            <div v-if="selectedProvider" class="tw:flex tw:items-center tw:flex-wrap tw:gap-[6px_10px] tw:p-[8px_12px] tw:mt-2 tw:border tw:border-[color-mix(in_srgb,var(--o2-status-info-text)_25%,transparent)] tw:rounded-md tw:bg-[color-mix(in_srgb,var(--o2-status-info-text)_8%,transparent)] tw:text-xs tw:text-(--color-text-primary)">
              <span class="tw:w-2 tw:h-2 tw:rounded-full tw:bg-(--o2-status-info-text) tw:shrink-0" />
              <span class="tw:text-(--color-text-secondary)">
                {{ t("onlineEvals.scorer.endpointLabel") }}
                <span class="tw:font-mono">{{ providerEndpoint(selectedProvider) }}</span>
              </span>
              <span class="tw:text-(--color-text-secondary)">·</span>
              <span class="tw:text-(--color-text-secondary)">
                {{ t("onlineEvals.scorer.defaultModelPreviewLabel") }}
                <span class="tw:font-mono">{{ defaultModelOf(selectedProvider) || "—" }}</span>
              </span>
              <span class="tw:text-(--color-text-secondary)">·</span>
              <span class="tw:text-(--color-text-secondary)">
                {{ t("onlineEvals.scorer.authLabel") }}
                <span class="tw:font-mono">{{ t("onlineEvals.scorer.authConfigured") }}</span>
              </span>
            </div>

            <div class="tw:text-[11.5px] tw:text-(--color-text-secondary) tw:mt-1">
              <i18n-t keypath="onlineEvals.scorer.providerHelp" tag="span">
                <template #settingsLink>
                  <router-link
                    :to="{ name: 'llmProviders' }"
                    class="scorer-field__help-link tw:text-(--color-primary-600) tw:font-semibold tw:no-underline hover:tw:underline"
                    target="_blank"
                  >
                    {{ t("onlineEvals.scorer.providerHelpSettingsLink") }}
                  </router-link>
                </template>
              </i18n-t>
            </div>
          </div>

          <div class="tw:mb-3">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">{{ t("onlineEvals.scorer.modelLabel") }}</label>
            <OInput
              v-model.trim="form.model"
              :placeholder="t('onlineEvals.scorer.modelPlaceholder')"
              size="sm"
              data-test="scorer-form-model-input"
            />
          </div>

          <div class="tw:mb-3 tw:flex tw:flex-col tw:gap-[14px]">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.scorer.promptLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
            </label>
            <OInput
              v-model="form.template"
              type="textarea"
              size="sm"
              :rows="8"
              data-test="scorer-form-prompt-input"
            />
            <div class="tw:flex tw:items-center tw:flex-wrap tw:gap-1.5 tw:mt-1.5 tw:text-[11.5px]">
              <span class="tw:text-(--color-text-secondary)">
                {{ t("onlineEvals.scorer.promptVariablesLabel") }}
              </span>
              <span
                v-for="v in promptVariables"
                :key="v"
                class="tw:py-[1px] tw:px-1.5 tw:rounded-[3px] tw:text-[11px] tw:font-mono tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] tw:text-(--color-text-primary)"
              >{{ formatTemplateVariable(v) }}</span>
            </div>
            <div class="tw:text-[11.5px] tw:text-(--color-text-secondary) tw:mt-1">
              {{
                t("onlineEvals.scorer.promptHelp", {
                  inputVar: formatTemplateVariable("input"),
                  outputVar: formatTemplateVariable("output"),
                })
              }}
            </div>
          </div>

          <div class="tw:mb-3 tw:flex tw:flex-col tw:gap-[14px]">
            <label class="tw:flex tw:items-start tw:gap-2 tw:cursor-pointer">
              <input
                v-model="form.includeReasoning"
                type="checkbox"
                data-test="scorer-form-include-reasoning"
              />
              <span>
                <strong class="tw:block tw:text-xs tw:text-(--color-text-primary)">{{ t("onlineEvals.scorer.includeReasoningLabel") }}</strong>
                <small class="tw:block tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.scorer.includeReasoningHint") }}</small>
              </span>
            </label>

            <div class="tw:flex tw:justify-between tw:items-baseline tw:gap-3">
              <div class="tw:flex tw:flex-col tw:gap-0.5">
                <strong class="tw:text-xs tw:font-semibold">{{ t("onlineEvals.scorer.extraFieldsLabel") }}</strong>
                <span class="tw:text-[10px] tw:font-semibold tw:text-(--color-text-muted) tw:uppercase tw:tracking-[0.04em]">
                  {{ t("onlineEvals.scorer.extraFieldsOptional") }}
                </span>
                <small class="tw:block tw:text-[11px] tw:text-(--color-text-secondary)">{{ t("onlineEvals.scorer.extraFieldsHint") }}</small>
              </div>
            </div>

            <div
              v-if="form.extraMetadataFields.length"
              class="tw:flex tw:flex-col tw:gap-1.5 tw:border tw:border-(--color-border) tw:rounded-md tw:p-[8px_10px] tw:bg-(--color-card-bg-solid)"
              data-test="scorer-form-extra-fields"
            >
              <div class="tw:grid tw:grid-cols-[minmax(120px,1fr)_110px_minmax(140px,2fr)_28px] tw:gap-2 tw:items-center tw:text-[10px] tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-(--color-text-muted)">
                <span>{{ t("onlineEvals.scorer.extraFields.colName") }}</span>
                <span>{{ t("onlineEvals.scorer.extraFields.colType") }}</span>
                <span>{{ t("onlineEvals.scorer.extraFields.colDescription") }}</span>
                <span aria-hidden="true" />
              </div>
              <div
                v-for="(field, idx) in form.extraMetadataFields"
                :key="idx"
                class="tw:grid tw:grid-cols-[minmax(120px,1fr)_110px_minmax(140px,2fr)_28px] tw:gap-2 tw:items-center"
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
                  class="scorer-extras__remove tw:w-6 tw:h-6 tw:border-0 tw:bg-transparent tw:text-(--color-text-secondary) tw:text-base tw:cursor-pointer tw:rounded"
                  :aria-label="t('onlineEvals.buttons.remove')"
                  :data-test="`scorer-form-extra-field-remove-${idx}`"
                  @click="removeExtraField(idx)"
                >
                  ×
                </button>
              </div>
            </div>

            <div class="tw:flex tw:justify-between tw:gap-3">
              <button
                type="button"
                class="scorer-extras__add tw:border-0 tw:bg-transparent tw:py-1 tw:px-0 tw:text-xs tw:font-semibold tw:text-(--o2-primary-btn-bg) tw:cursor-pointer disabled:tw:text-(--color-text-muted) disabled:tw:cursor-not-allowed"
                :disabled="form.extraMetadataFields.length >= MAX_EXTRA_FIELDS"
                data-test="scorer-form-extra-field-add"
                @click="addExtraField"
              >
                {{ t("onlineEvals.scorer.extraFields.addButton") }}
                <span class="tw:font-normal tw:text-(--color-text-secondary) tw:ml-1">
                  ({{ form.extraMetadataFields.length }} / {{ MAX_EXTRA_FIELDS }})
                </span>
              </button>

              <button
                type="button"
                class="scorer-extras__preview tw:border-0 tw:bg-transparent tw:py-1 tw:px-0 tw:text-xs tw:font-semibold tw:text-(--o2-primary-btn-bg) tw:cursor-pointer"
                data-test="scorer-form-preview-schema"
                @click="previewOutputSchema"
              >
                {{ t("onlineEvals.scorer.extraFields.previewSchema") }}
              </button>
            </div>

          </div>
        </section>

        <!-- Section 02: Endpoint -->
        <section v-else class="tw:mb-6">
          <div class="tw:flex tw:items-center tw:gap-[10px] tw:pb-[10px] tw:border-b tw:border-(--color-dialog-header-border) tw:mb-3">
            <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-[22px] tw:h-[22px] tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary) tw:font-bold tw:text-[11px] tw:font-mono">02</span>
            <h3 class="tw:m-0 tw:text-sm tw:font-semibold tw:text-(--color-text-primary)">{{ t("onlineEvals.scorer.endpointSection") }}</h3>
          </div>

          <div class="tw:mb-3">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.scorer.remoteUrlLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
            </label>
            <div class="scorer-url-bar tw:grid tw:grid-cols-[104px_minmax(0,1fr)] tw:gap-0">
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

          <div class="tw:mb-3 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] tw:gap-3">
            <div class="tw:flex tw:flex-col tw:gap-1.5">
              <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
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
            <div class="tw:flex tw:flex-col tw:gap-1.5">
              <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
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
            <div class="tw:flex tw:flex-col tw:gap-1.5">
              <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
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
        <section v-if="form.scorerType === 'remote'" class="tw:mb-6">
          <div class="tw:flex tw:items-center tw:gap-[10px] tw:pb-[10px] tw:border-b tw:border-(--color-dialog-header-border) tw:mb-3">
            <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-[22px] tw:h-[22px] tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary) tw:font-bold tw:text-[11px] tw:font-mono">03</span>
            <h3 class="tw:m-0 tw:text-sm tw:font-semibold tw:text-(--color-text-primary)">{{ t("onlineEvals.scorer.authSection") }}</h3>
          </div>

          <div class="tw:mb-3">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
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

          <div v-if="form.authType === 'bearer'" class="tw:mb-3">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.scorer.remoteAuth.tokenLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
            </label>
            <OInput
              v-model.trim="form.authBearerToken"
              :placeholder="t('onlineEvals.scorer.remoteAuth.bearerTokenPlaceholder')"
              size="sm"
              type="password"
              data-test="scorer-form-remote-auth-bearer-token"
            />
            <div class="tw:text-[11.5px] tw:text-(--color-text-secondary) tw:mt-1">
              {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
            </div>
          </div>

          <div v-if="form.authType === 'basic'" class="tw:mb-3 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-3">
            <div class="tw:flex tw:flex-col tw:gap-1.5">
              <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.usernameLabel") }}
                <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
              </label>
              <OInput
                v-model.trim="form.authBasicUsername"
                :placeholder="t('onlineEvals.scorer.remoteAuth.basicUsernamePlaceholder')"
                size="sm"
                data-test="scorer-form-remote-auth-basic-username"
              />
            </div>
            <div class="tw:flex tw:flex-col tw:gap-1.5">
              <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.passwordLabel") }}
                <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
              </label>
              <OInput
                v-model.trim="form.authBasicPassword"
                :placeholder="t('onlineEvals.scorer.remoteAuth.basicPasswordPlaceholder')"
                size="sm"
                type="password"
                data-test="scorer-form-remote-auth-basic-password"
              />
              <div class="tw:text-[11.5px] tw:text-(--color-text-secondary) tw:mt-1">
                {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
              </div>
            </div>
          </div>

          <div v-if="form.authType === 'api_key'" class="tw:mb-3 tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] tw:gap-3">
            <div class="tw:flex tw:flex-col tw:gap-1.5">
              <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.headerNameLabel") }}
                <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
              </label>
              <OInput
                v-model.trim="form.authApiKeyHeaderName"
                :placeholder="t('onlineEvals.scorer.remoteAuth.apiKeyHeaderPlaceholder')"
                size="sm"
                data-test="scorer-form-remote-auth-apikey-header"
              />
            </div>
            <div class="tw:flex tw:flex-col tw:gap-1.5">
              <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
                {{ t("onlineEvals.scorer.remoteAuth.tokenLabel") }}
                <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
              </label>
              <OInput
                v-model.trim="form.authApiKeyToken"
                :placeholder="t('onlineEvals.scorer.remoteAuth.apiKeyTokenPlaceholder')"
                size="sm"
                type="password"
                data-test="scorer-form-remote-auth-apikey-token"
              />
              <div class="tw:text-[11.5px] tw:text-(--color-text-secondary) tw:mt-1">
                {{ t("onlineEvals.scorer.remoteAuth.encryptedHint") }}
              </div>
            </div>
          </div>
        </section>

        <!-- Section 04: Custom headers -->
        <section v-if="form.scorerType === 'remote'" class="tw:mb-6">
          <div class="tw:flex tw:items-center tw:gap-[10px] tw:pb-[10px] tw:border-b tw:border-(--color-dialog-header-border) tw:mb-3">
            <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-[22px] tw:h-[22px] tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary) tw:font-bold tw:text-[11px] tw:font-mono">04</span>
            <h3 class="tw:m-0 tw:text-sm tw:font-semibold tw:text-(--color-text-primary)">{{ t("onlineEvals.scorer.headersSection") }}</h3>
            <span class="tw:ml-auto tw:text-[11.5px] tw:text-(--color-text-secondary) tw:italic">
              {{ t("onlineEvals.scorer.remoteHeaders.subtitle") }}
            </span>
          </div>

          <div class="tw:mb-3">
            <div
              v-if="form.customHeaders.length"
              class="tw:flex tw:flex-col tw:gap-1.5 tw:border tw:border-(--color-border) tw:rounded-md tw:p-[8px_10px] tw:bg-(--color-card-bg-solid)"
              data-test="scorer-form-remote-headers"
            >
              <div class="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] tw:gap-1.5 tw:items-center tw:text-[10px] tw:font-semibold tw:uppercase tw:tracking-[0.04em] tw:text-(--color-text-muted)">
                <span>{{ t("onlineEvals.scorer.remoteHeaders.colName") }}</span>
                <span>{{ t("onlineEvals.scorer.remoteHeaders.colValue") }}</span>
                <span aria-hidden="true" />
              </div>
              <div
                v-for="(header, idx) in form.customHeaders"
                :key="idx"
                class="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] tw:gap-1.5 tw:items-center"
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
                  class="scorer-extras__remove tw:w-6 tw:h-6 tw:border-0 tw:bg-transparent tw:text-(--color-text-secondary) tw:text-base tw:cursor-pointer tw:rounded"
                  :aria-label="t('onlineEvals.buttons.remove')"
                  :data-test="`scorer-form-remote-header-remove-${idx}`"
                  @click="removeCustomHeader(idx)"
                >
                  ×
                </button>
              </div>
            </div>

            <div class="tw:flex tw:justify-between tw:gap-3">
              <button
                type="button"
                class="scorer-extras__add tw:border-0 tw:bg-transparent tw:py-1 tw:px-0 tw:text-xs tw:font-semibold tw:text-(--o2-primary-btn-bg) tw:cursor-pointer"
                data-test="scorer-form-remote-header-add"
                @click="addCustomHeader"
              >
                {{ t("onlineEvals.scorer.remoteHeaders.addButton") }}
              </button>
            </div>
          </div>
        </section>

        <!-- Section 05: Request body template -->
        <section v-if="form.scorerType === 'remote'" class="tw:mb-6">
          <div class="tw:flex tw:items-center tw:gap-[10px] tw:pb-[10px] tw:border-b tw:border-(--color-dialog-header-border) tw:mb-3">
            <span class="tw:inline-flex tw:items-center tw:justify-center tw:w-[22px] tw:h-[22px] tw:rounded-full tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_12%,transparent)] tw:text-(--color-text-secondary) tw:font-bold tw:text-[11px] tw:font-mono">05</span>
            <h3 class="tw:m-0 tw:text-sm tw:font-semibold tw:text-(--color-text-primary)">{{ t("onlineEvals.scorer.requestBodySection") }}</h3>
          </div>

          <div class="tw:mb-3">
            <label class="tw:flex tw:items-center tw:text-xs tw:font-semibold tw:text-(--color-text-primary) tw:mb-1">
              {{ t("onlineEvals.scorer.requestBodyLabel") }}
              <span class="tw:text-(--o2-status-error-text) tw:ml-[2px]">*</span>
            </label>
            <OInput
              v-model="form.template"
              type="textarea"
              size="sm"
              :rows="10"
              data-test="scorer-form-request-body-input"
            />
            <div class="tw:flex tw:items-center tw:flex-wrap tw:gap-1.5 tw:mt-1.5 tw:text-[11.5px]">
              <span class="tw:text-(--color-text-secondary)">
                {{ t("onlineEvals.scorer.promptVariablesLabel") }}
              </span>
              <span
                v-for="v in promptVariables"
                :key="v"
                class="tw:py-[1px] tw:px-1.5 tw:rounded-[3px] tw:text-[11px] tw:font-mono tw:bg-[color-mix(in_srgb,var(--color-text-secondary)_10%,transparent)] tw:text-(--color-text-primary)"
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

    <footer class="tw:sticky tw:bottom-0 tw:flex tw:items-center tw:justify-end tw:gap-2 tw:px-5.5 tw:py-3 tw:bg-(--o2-card-bg) tw:rounded-md tw:shadow-[0_0_0.313rem_0.063rem_var(--o2-hover-shadow)] tw:shrink-0 tw:z-1">
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
      <p v-if="isLoadingSchemaPreview" class="tw:m-0 tw:p-3 tw:text-xs tw:text-(--color-text-secondary)">
        {{ t("onlineEvals.scorer.extraFields.schemaLoading") }}
      </p>
      <p
        v-else-if="schemaPreviewError"
        class="tw:m-0 tw:p-3 tw:text-xs tw:text-(--o2-status-error-text)"
      >
        {{ schemaPreviewError }}
      </p>
      <pre class="tw:m-0 tw:max-h-[60vh] tw:overflow-auto tw:p-3 tw:rounded-md tw:bg-(--color-card-bg-solid) tw:border tw:border-(--color-border) tw:font-normal tw:text-xs tw:font-(family-name:--o2-font-mono) tw:text-(--color-text-primary) tw:whitespace-pre tw:[tab-size:2]" v-else>{{ schemaPreview }}</pre>

      <template #footer>
        <div class="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:w-full">
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

<style>
/* Cap all textareas in the form so they scroll internally instead of pushing layout */
.scorer-form__main textarea {
  max-height: 280px;
  overflow-y: auto;
}

/* Specific per-field caps that match each field's role */
.scorer-form__main .scorer-field--desc textarea { max-height: 120px; }
.scorer-form__main .scorer-field--prompt textarea { max-height: 280px; }
.scorer-form__main .scorer-field--schema textarea { max-height: 220px; }
.scorer-form__main .scorer-field--request-body textarea { max-height: 280px; }

.scorer-form__close:hover {
  background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  color: var(--color-primary-600, #3F7994);
}

.scorer-extras__row .has-error input {
  border-color: var(--o2-status-error-text);
}

.scorer-extras__remove:hover {
  background: color-mix(in srgb, var(--o2-status-error-text) 12%, transparent);
  color: var(--o2-status-error-text);
}

.scorer-extras__add:disabled {
  color: var(--color-text-muted, var(--o2-text-muted));
  cursor: not-allowed;
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
