<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<template>
  <div class="w-full service-identity-setup mt-2">
    <!-- Loading skeleton while fetching recommendations -->
    <div v-if="loading" class="flex flex-col gap-4 py-4">
      <OSkeleton class="rounded-default h-14 w-full" />
      <OSkeleton class="rounded-default h-14 w-full" />
      <OSkeleton class="rounded-default h-10 w-40" />
    </div>

    <div v-else>
      <!-- Section 1: Service Configuration -->
      <div
        class="mb-3 rounded-default overflow-hidden border border-card-glass-border"
       
      >
        <div class="p-3 flex flex-col gap-3">
          <!-- Service name source banner -->
          <div
            v-if="!serviceOptional"
            class="rounded-default border overflow-hidden transition-all"
            :class="
              serviceNameDetected
                ? 'bg-banner-info-bg border-banner-info-border'
                : 'bg-banner-warning-bg border-banner-warning-border'
            "
          >
            <!-- Collapsed row -->
            <div
              data-test="service-identity-service-name-header"
              class="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity"
              @click="serviceNameExpanded = !serviceNameExpanded"
            >
              <OIcon
                :name="serviceNameDetected ? 'check-circle' : 'warning'"
                size="sm"
                :class="serviceNameDetected ? 'text-status-positive' : 'text-status-warning-text'"
              />
              <div class="flex-1 min-w-0 text-compact leading-tight">
                <template v-if="serviceNameDetected">
                  {{ t("settings.serviceIdentitySetup.serviceNameDetectedFrom") }}
                  <span class="font-bold text-primary">Service</span>
                  {{ t("settings.serviceIdentitySetup.fieldAlias") }}
                  <span class="text-xs opacity-60"
                    >({{
                      detectedServiceFields.length + unseenServiceFields.length
                    }})</span
                  >
                </template>
                <template v-else>
                  <span class="font-semibold">{{
                    t("settings.correlation.serviceNameNotDetected")
                  }}</span>
                </template>
              </div>
              <OIcon
                :name="
                  serviceNameExpanded
                    ? 'keyboard-arrow-up'
                    : 'keyboard-arrow-down'
                "
                size="sm"
                class="opacity-40 shrink-0"
              />
            </div>

            <!-- Expanded detail -->
            <div
              v-if="serviceNameExpanded"
              class="px-3 pb-3 pt-2 border-t"
              :class="
                serviceNameDetected
                  ? 'border-banner-info-border'
                  : 'border-banner-warning-border'
              "
            >
              <!-- Inner card -->
              <div
                class="rounded-default p-2.5"
                :class="
                  'bg-surface-subtle'
                "
              >
                <div
                  class="text-xs font-medium mb-2"
                  :class="
                    'text-text-secondary'
                  "
                >
                  {{ t("settings.correlation.serviceNameExpandedHelp") }}
                </div>

                <!-- Field pills -->
                <div class="flex flex-wrap gap-1.5 mb-3">
                  <!-- Detected fields (with stream type dots) -->
                  <div
                    v-for="field in detectedServiceFields"
                    :key="field.name"
                    class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-default font-mono text-xs font-medium border border-card-glass-border"
                   
                    :class="
                      'bg-surface-base text-text-secondary'
                    "
                  >
                    <div class="flex items-center gap-0.5 mr-0.5">
                      <span
                        v-for="st in field.streamTypes"
                        :key="st"
                        class="w-1.5 h-1.5 rounded-full"
                        :class="{
                          'bg-badge-blue-solid-bg': st === 'logs',
                          'bg-badge-orange-solid-bg': st === 'traces',
                          'bg-badge-success-solid-bg': st === 'metrics',
                        }"
                        :title="st"
                      />
                    </div>
                    {{ field.name }}
                  </div>

                  <!-- Configured but not yet seen (grey pills) -->
                  <div
                    v-for="field in unseenServiceFields"
                    :key="field"
                    class="inline-flex items-center px-2.5 py-1 rounded-default border-dashed font-mono text-xs border border-dashed border-card-glass-border"
                   
                    :class="
                      'text-text-secondary'
                    "
                    :title="
                      t('settings.correlation.serviceNameConfiguredNotSeen')
                    "
                  >
                    {{ field }}
                  </div>
                </div>

                <!-- Legend row -->
                <div
                  class="flex flex-wrap items-center justify-between gap-2"
                >
                  <div
                    class="flex flex-wrap items-center gap-3 text-3xs"
                    :class="
                      'text-text-secondary'
                    "
                  >
                    <div class="flex items-center gap-1">
                      <span
                        class="w-1.5 h-1.5 rounded-full bg-badge-blue-solid-bg"
                      />
                      {{ t("settings.correlation.foundInLogs") }}
                    </div>
                    <div class="flex items-center gap-1">
                      <span
                        class="w-1.5 h-1.5 rounded-full bg-badge-orange-solid-bg"
                      />
                      {{ t("settings.correlation.foundInTraces") }}
                    </div>
                    <div class="flex items-center gap-1">
                      <span
                        class="w-1.5 h-1.5 rounded-full bg-badge-success-solid-bg"
                      />
                      {{ t("settings.correlation.foundInMetrics") }}
                    </div>
                    <div
                      v-if="unseenServiceFields.length > 0"
                      class="flex items-center gap-1"
                    >
                      <span
                        class="w-1.5 h-1.5 rounded-full border border-dashed border-grey-4"
                      />
                      {{
                        t("settings.correlation.serviceNameConfiguredNotSeen")
                      }}
                    </div>
                  </div>

                  <!-- Customize link -->
                  <a
                    class="config-link-btn cursor-pointer inline-flex items-center gap-1 px-2 py-0.5 rounded-default text-xs font-semibold no-underline border border-text-link text-text-link bg-badge-blue-soft-bg transition-[background] hover:bg-[color-mix(in_srgb,var(--color-badge-blue-ol-border)_18%,transparent)]"
                    @click.prevent="emit('navigate-to-aliases', 'service')"
                  >
                    {{ t("settings.correlation.customizeFieldMappings") }}
                  </a>
                </div>
              </div>
            </div>
          </div>

          <!-- Field Mapping Dialog -->
          <ODialog
            data-test="service-identity-setup-field-mapping-dialog"
            v-model:open="showFieldMappingDialog"
            size="sm"
            :title="t('settings.correlation.customizeFieldMappings')"
            :sub-title="t('settings.correlation.fieldMappingDialogHelp')"
            :secondary-button-label="t('common.cancel')"
            :primary-button-label="t('common.save')"
            :primary-button-loading="savingFieldMappings"
            @click:secondary="showFieldMappingDialog = false"
            @click:primary="saveFieldMappings"
          >
            <OTagInput
              :model-value="editableServiceFields"
              @update:model-value="editableServiceFields = $event"
              :placeholder="t('settings.correlation.fieldMappingPlaceholder')"
              label=""
            />
          </ODialog>

          <!-- Service Optional toggle -->
          <div data-test="service-identity-service-optional" class="mb-3">
            <OSwitch
              data-test="service-identity-service-optional-btn"
              v-model="serviceOptional"
              :label="t('settings.correlation.serviceOptionalLabel')"
              size="md"
            />
            <div
              class="text-xs mt-1 leading-snug ml-9"
              :class="
                'text-text-secondary'
              "
            >
              {{ t("settings.correlation.serviceOptionalHelp") }}
            </div>
          </div>

          <!-- Disambiguation Fields -->
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="font-bold text-sm">{{
                t("settings.correlation.distinguishByLabel")
              }}</span>
              <span class="flex-1"><OSeparator /></span>
            </div>
            <div
              class="text-xs mb-3"
              :class="
                'text-text-secondary'
              "
            >
              {{ t("settings.correlation.distinguishByHelp") }}
            </div>

            <!-- Empty state: nothing configured anywhere -->
            <div
              v-if="allConfiguredEnvs.length === 0 && !addingToEnv"
              class="flex flex-col items-center gap-2 py-3 px-4 rounded-default border border-dashed"
              :class="
                'border-border-default bg-surface-subtle'
              "
            >
              <OIcon name="tune" size="lg" class="text-icon-color mb-1" />
              <span
                class="text-sm font-medium"
                :class="
                  'text-text-secondary'
                "
              >
                {{ t("settings.serviceIdentitySetup.noFieldsConfiguredYet") }}
              </span>
              <OButton
                variant="outline"
                size="sm"
                class="mt-1"
                data-test="service-identity-add-distinguish-btn"
                @click="addingToEnv = activeEnvironment"
              >
                <template #icon-left><OIcon name="add" size="xs" /></template>
                {{ t("settings.correlation.addField") }}
              </OButton>
            </div>

            <!-- All configured env groups -->
            <div v-else class="flex flex-col gap-2">
              <!-- Auto-suggested banner (only when fields came from suggestion, not saved config) -->
              <div
                v-if="isAutoSuggested"
                class="flex items-start gap-2 px-3 py-2 rounded-default text-xs"
                :class="
                  'bg-status-info-bg text-status-info-text'
                "
              >
                <OIcon
                  name="auto-awesome"
                  size="xs"
                  class="shrink-0 mt-0.5"
                />
                <span>{{ t("settings.correlation.autoSuggestedBanner") }}</span>
              </div>

              <!-- One row per configured env -->
              <template
                v-for="(envKey, envIdx) in allConfiguredEnvs"
                :key="envKey"
              >
                <!-- Environment label -->
                <div
                  v-if="allConfiguredEnvs.length > 1"
                  class="flex items-center gap-2 mt-1"
                  :class="{ 'pt-2 border-t': envIdx > 0 }"
                >
                  <span
                    class="text-3xs font-bold"
                    :class="
                      'text-text-secondary'
                    "
                  >
                    {{ getIdentitySetLabel(envKey) }}
                  </span>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  <!-- Pills for this env's fields -->
                  <div
                    v-for="fieldId in (setDistinguishBy[envKey] ?? []).filter(
                      Boolean,
                    )"
                    :key="fieldId"
                    class="flex items-center gap-1 pl-3 pr-1 py-1 rounded-default text-xs font-medium transition-colors border border-card-glass-border"
                   
                    :class="
                      'bg-surface-base text-text-secondary'
                    "
                  >
                    <span>{{
                      getGroupByValue(fieldId)?.display ?? fieldId
                    }}</span>
                    <OTooltip
                      v-if="getFieldCardinalityTooltip(fieldId)"
                      :content="getFieldCardinalityTooltip(fieldId) ?? ''"
                      side="top"
                    />
                    <OButton
                      variant="ghost"
                      size="icon-xs-sq"
                      @click="removeFieldByIdFromEnv(envKey, fieldId)"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </OButton>
                  </div>

                  <!-- Inline add select for this group -->
                  <template v-if="addingToEnv === envKey">
                    <OSelect
                      ref="addFieldSelectRef"
                      v-model="addFieldValue"
                      :options="getAddFieldOptionsForEnv(envKey)"
                      labelKey="label"
                      valueKey="value"
                      searchable
                      :placeholder="t('settings.correlation.selectField')"
                      style="width: 13.75rem"
                      :dropdown-style="{ minWidth: '18.75rem' }"
                      data-test="service-identity-add-distinguish-btn"
                      @update:model-value="onAddFieldToEnv(envKey, $event)"
                    />
                    <OButton
                      variant="ghost"
                      size="icon-xs-sq"
                      @click="
                        addingToEnv = '';
                        addFieldValue = undefined;
                      "
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
                        aria-hidden="true"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </OButton>
                  </template>

                  <!-- + Add field button -->
                  <OButton
                    v-else-if="
                      (setDistinguishBy[envKey] ?? []).filter(Boolean).length <
                      5
                    "
                    variant="outline"
                    size="sm"
                    @click="addingToEnv = envKey"
                    icon-left="add"
                  >
                    {{ t("settings.correlation.addField") }}
                    <OTooltip
                      side="top"
                      :content="t('settings.correlation.addFieldTooltip')"
                      max-width="240px"
                    />
                  </OButton>
                </div>
              </template>

              <!-- Adding to a new env (not yet in the list) -->
              <template
                v-if="addingToEnv && !allConfiguredEnvs.includes(addingToEnv)"
              >
                <div
                  class="flex flex-wrap items-center gap-2 pt-2 border-t border-card-glass-border"
                 
                >
                  <OSelect
                    ref="addFieldSelectRef"
                    v-model="addFieldValue"
                    :options="getAddFieldOptionsForEnv(addingToEnv)"
                    labelKey="label"
                    valueKey="value"
                    searchable
                    :placeholder="t('settings.correlation.selectField')"
                    style="width: 13.75rem"
                    :dropdown-style="{ minWidth: '18.75rem' }"
                    data-test="service-identity-add-distinguish-btn"
                    @update:model-value="onAddFieldToEnv(addingToEnv, $event)"
                  />
                  <OButton
                    variant="ghost"
                    size="icon-xs-sq"
                    @click="
                      addingToEnv = '';
                      addFieldValue = undefined;
                    "
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
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </OButton>
                </div>
              </template>

              <!-- Add group + Save — bottom row -->
              <div
                v-if="!addingToEnv"
                class="flex items-center justify-between mt-2"
              >
                <OButton
                  variant="outline"
                  size="sm"
                  @click="addingToEnv = generateGroupId()"
                  icon-left="add"
                >
                  {{ t("settings.correlation.addGroup") }}
                  <OTooltip
                    side="top"
                    :content="t('settings.correlation.addGroupTooltip')"
                    max-width="240px"
                  />
                </OButton>
                <OButton
                  variant="primary"
                  size="sm-action"
                  :loading="saving"
                  :disabled="saving || !isDirty"
                  data-test="service-identity-save-btn"
                  @click="saveConfig"
                >
                  {{ t("settings.correlation.saveIdentityConfig") }}
                </OButton>
              </div>
            </div>
          </div>
        </div>
        <!-- /padding -->
      </div>
      <!-- /Service Configuration card -->

      <!-- Section 3: Workload Detection -->
      <div
        v-if="workloadDetectedGroups.length > 0"
        class="mb-3 rounded-default overflow-hidden border border-card-glass-border"
       
      >
        <!-- Section header -->
        <div
          class="px-4 py-3 flex items-center gap-2 border-b border-card-glass-border"
         
        >
          <OIcon name="radar" size="sm" class="text-teal-6" />
          <span class="font-bold text-sm">{{ t("settings.serviceIdentitySetup.workloadDetection") }}</span>
        </div>

        <!-- Collapsible: Workload detected using fields (N) -->
        <div
          class="mx-3 mt-3 rounded-default border overflow-hidden transition-all"
          :class="
            'bg-banner-info-bg border-banner-info-border'
          "
        >
          <div
            class="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:opacity-80 transition-opacity"
            @click="trackedAliasExpanded = !trackedAliasExpanded"
          >
            <OIcon name="check-circle" size="sm" />
            <div class="flex-1 min-w-0 text-compact leading-tight">
              {{ t("settings.serviceIdentitySetup.workloadDetectedUsingFields") }}
              <span class="text-xs opacity-60"
                >({{ trackedAliasIds.length }})</span
              >
            </div>
            <OIcon
              :name="
                trackedAliasExpanded
                  ? 'keyboard-arrow-up'
                  : 'keyboard-arrow-down'
              "
              size="sm"
              class="opacity-40 shrink-0"
            />
          </div>

          <div
            v-if="trackedAliasExpanded"
            class="px-3 pb-3 pt-2 border-t"
            :class="
              'border-banner-info-border'
            "
          >
            <div
              class="rounded-default p-2.5"
              :class="
                'bg-surface-subtle'
              "
            >
              <div
                class="text-xs mb-3"
                :class="
                  'text-text-secondary'
                "
              >
                {{ t("settings.serviceIdentitySetup.workloadTrackedHelp") }}
                <a
                  class="config-link-btn cursor-pointer inline-block mx-1 px-2 py-0.5 rounded-default text-xs font-semibold no-underline align-middle border border-text-link text-text-link bg-badge-blue-soft-bg transition-[background] hover:bg-[color-mix(in_srgb,var(--color-badge-blue-ol-border)_18%,transparent)]"
                  @click.prevent="emit('navigate-to-aliases', 'service')"
                  >{{ t("settings.serviceIdentitySetup.goToFieldAliases") }}</a
                >
                {{ t("settings.serviceIdentitySetup.toConfigureFieldMappings") }}
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <!-- Pills for tracked aliases -->
                <div
                  v-for="alias in resolvedTrackedAliases"
                  :key="alias.id"
                  class="flex items-center gap-1 pl-3 pr-1 py-1 rounded-default text-xs font-medium transition-colors border border-card-glass-border"
                 
                  :class="
                    'bg-surface-base text-text-secondary'
                  "
                >
                  <span>{{ alias.label }}</span>
                  <OButton
                    variant="ghost"
                    size="icon-xs-sq"
                    @click="
                      trackedAliasIds = trackedAliasIds.filter(
                        (id) => id !== alias.id,
                      )
                    "
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </OButton>
                </div>
                <!-- Inline add select -->
                <template v-if="addingTrackedAlias">
                  <OSelect
                    ref="addTrackedAliasSelectRef"
                    v-model="addTrackedAliasValue"
                    :options="trackedAliasAddOptions"
                    labelKey="label"
                    valueKey="value"
                    searchable
                    :placeholder="t('settings.serviceIdentitySetup.selectAliasGroup')"
                    style="width: 13.75rem"
                    :dropdown-style="{ minWidth: '18.75rem' }"
                    @update:model-value="onAddTrackedAlias($event)"
                  />
                  <OButton
                    variant="ghost"
                    size="icon-xs-sq"
                    @click="
                      addingTrackedAlias = false;
                      addTrackedAliasValue = undefined;
                    "
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
                      aria-hidden="true"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </OButton>
                </template>
                <!-- Add field button -->
                <OButton
                  v-else
                  variant="outline"
                  size="sm"
                  @click="addingTrackedAlias = true"
                  icon-left="add"
                >
                  {{ t("settings.correlation.addField") }}
                </OButton>
              </div>
              <div class="flex justify-end mt-3">
                <OButton
                  variant="primary"
                  size="sm-action"
                  :loading="saving"
                  :disabled="saving || !isDirty"
                  @click="saveConfig"
                >
                  {{ t("settings.correlation.saveIdentityConfig") }}
                </OButton>
              </div>
            </div>
          </div>
        </div>

        <div class="px-4 pt-3 pb-1">
          <div
            class="text-xs"
            :class="
              'text-text-secondary'
            "
          >
            {{ t("settings.serviceIdentitySetup.discoveredPatternsHelp") }}
            <a
              class="config-link-btn cursor-pointer inline-block mx-1 px-2 py-0.5 rounded-default text-xs font-semibold no-underline align-middle border border-text-link text-text-link bg-badge-blue-soft-bg transition-[background] hover:bg-[color-mix(in_srgb,var(--color-badge-blue-ol-border)_18%,transparent)]"
              @click.prevent="emit('navigate-to-services')"
              >{{ t("settings.serviceIdentitySetup.goToServices") }}</a
            >
            <span>{{ t("settings.serviceIdentitySetup.toSeeDiscoveredServices") }}</span>
          </div>
        </div>

        <!-- Environment Tabs (Chrome-style) -->
        <div
          class="flex items-end gap-0 px-4 border-b border-card-glass-border"
         
        >
          <div
            v-for="env in detectedEnvironments"
            :key="env.key"
            class="relative px-4 py-2 cursor-pointer transition-all text-xs font-medium min-w-17.5 text-center rounded-t-default border border-b-0"
            :class="
              activeEnvironment === env.key
                ? 'text-text-body'
                : 'bg-transparent text-text-muted border-transparent hover:text-text-secondary'
            "
            :style="
              activeEnvironment === env.key
                ? 'margin-bottom: -1px; padding-bottom: 9px; background-color: var(--color-card-glass-solid); border-color: var(--color-card-glass-border);'
                : ''
            "
            @click="activeEnvironment = env.key"
          >
            {{ env.label }}
            <span
              v-if="
                (setDistinguishBy[env.key] ?? []).filter(Boolean).length > 0
              "
              class="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-badge-success-solid-bg"
              :title="t('settings.serviceIdentitySetup.fieldsConfigured', { n: (setDistinguishBy[env.key] ?? []).filter(Boolean).length })"
            />
          </div>
        </div>

        <!-- Tab content panel — connects to active tab -->
        <div
          v-if="primaryDim"
          class="overflow-hidden px-4 pt-4 pb-2"
        >
          <!-- Stat cards -->
          <div class="flex items-stretch gap-3">
            <template v-for="(card, idx) in dimCards" :key="card.dim.group_id">
              <!-- Plus connector between cards -->
              <div v-if="idx > 0" class="flex items-center shrink-0">
                <OIcon name="add" size="sm" class="text-icon-color" />
              </div>

              <!-- Dim card -->
              <div
                class="dim-stat-card flex-1 min-w-0 rounded-default p-3 flex flex-col"
                :style="card.theme.border"
              >
                <div class="flex items-center gap-2 mb-2">
                  <OIcon
                    :name="card.theme.icon"
                    size="sm"
                    :class="card.theme.iconClass"
                  />
                  <span
                    class="text-2xs font-medium"
                    :class="
                      'text-text-secondary'
                    "
                    >{{ card.label }}</span
                  >
                  <span
                    class="text-lg font-bold ml-auto"
                    :class="card.theme.countClass"
                    >{{ card.count }}</span
                  >
                </div>
                <div class="dim-stat-pills flex flex-wrap gap-1 overflow-hidden">
                  <span
                    v-for="val in card.values.slice(0, 5)"
                    :key="val"
                    class="max-w-[calc(50%-4px)] h-5.5 box-border text-2xs py-0.5 px-2 rounded-full border cursor-pointer hover:opacity-70 transition-opacity inline-flex items-center gap-1"
                    :class="
                      card.theme.pill
                    "
                    :title="val"
                    @click.stop="openInsightDialogByIdx(val, idx)"
                    ><span class="truncate">{{ val }}</span
                    ><span
                      v-if="card.dim"
                      class="inline-flex gap-0.5 ml-0.5 shrink-0"
                      ><span
                        v-for="st in getValueStreamTypes(
                          card.dim.group_id,
                          val,
                        )"
                        :key="st"
                        class="w-1.5 h-1.5 rounded-full inline-block"
                        :class="{
                          'bg-badge-blue-solid-bg': st === 'logs',
                          'bg-badge-orange-solid-bg': st === 'traces',
                          'bg-badge-success-solid-bg': st === 'metrics',
                        }" /></span
                  ></span>
                  <ODropdown
                    v-if="card.values.length > 5"
                    v-model:open="dimCardMoreMenuOpen[idx]"
                    side="bottom"
                    align="start"
                  >
                    <template #trigger>
                      <span
                        class="max-w-[calc(50%-4px)] h-5.5 box-border text-2xs py-0.5 px-2 rounded-full cursor-pointer hover:opacity-70 transition-opacity"
                        :class="
                          'text-text-secondary'
                        "
                        >+{{ card.values.length - 5 }}</span
                      >
                    </template>
                    <div
                      class="p-2 flex flex-wrap gap-1 max-w-70 max-h-50 overflow-y-auto"
                      :class="
                        'bg-surface-overlay'
                      "
                    >
                      <span
                        v-for="val in card.values.slice(5)"
                        :key="val"
                        class="text-2xs py-0.5 px-2 rounded-full border cursor-pointer hover:opacity-70 transition-opacity inline-flex items-center gap-1"
                        :class="
                          card.theme.pill
                        "
                        :title="val"
                        @click.stop="openInsightDialogByIdx(val, idx); dimCardMoreMenuOpen[idx] = false"
                        ><span class="truncate">{{ val }}</span
                        ><span
                          v-if="card.dim"
                          class="inline-flex gap-0.5 ml-0.5 shrink-0"
                          ><span
                            v-for="st in getValueStreamTypes(
                              card.dim.group_id,
                              val,
                            )"
                            :key="st"
                            class="w-1.5 h-1.5 rounded-full inline-block"
                            :class="{
                              'bg-badge-blue-solid-bg': st === 'logs',
                              'bg-badge-orange-solid-bg': st === 'traces',
                              'bg-badge-success-solid-bg': st === 'metrics',
                            }" /></span
                      ></span>
                    </div>
                  </ODropdown>
                </div>
              </div>
            </template>
          </div>

          <!-- Stream type legend -->
          <div class="flex items-center gap-3 mt-2 ml-1">
            <div
              class="flex items-center gap-1 text-3xs"
              :class="
                'text-text-secondary'
              "
            >
              <span
                class="w-1.5 h-1.5 rounded-full inline-block bg-badge-blue-solid-bg"
              />
              <span>{{ t("settings.correlation.foundInLogs") }}</span>
            </div>
            <div
              class="flex items-center gap-1 text-3xs"
              :class="
                'text-text-secondary'
              "
            >
              <span
                class="w-1.5 h-1.5 rounded-full inline-block bg-badge-orange-solid-bg"
              />
              <span>{{ t("settings.correlation.foundInTraces") }}</span>
            </div>
            <div
              class="flex items-center gap-1 text-3xs"
              :class="
                'text-text-secondary'
              "
            >
              <span
                class="w-1.5 h-1.5 rounded-full inline-block bg-badge-success-solid-bg"
              />
              <span>{{ t("settings.correlation.foundInMetrics") }}</span>
            </div>
          </div>
        </div>

        <!-- Recommended Configuration -->
        <div
          v-if="
            suggestedConfig &&
            activeEnvGroups.length > 0 &&
            !suggestionDismissed &&
            !suggestionAlreadyApplied
          "
          class="flex items-center gap-3 px-4 py-2.5"
          :class="
            'bg-surface-subtle'
          "
        >
          <div
            class="flex-1 min-w-0 text-xs truncate"
            :class="
              'text-text-secondary'
            "
          >
            <span
              class="font-bold"
              :class="
                'text-text-body'
              "
              >{{ t("settings.serviceIdentitySetup.recommended") }}</span
            >
            {{ " " }}{{ t("settings.serviceIdentitySetup.recommendedUse") }}
            <span class="font-semibold">{{
              suggestedConfig.distinguish_by
                .map((id) => getGroupByValue(id)?.display ?? id)
                .join(" + ")
            }}</span>
            {{ t("settings.serviceIdentitySetup.coversTelemetry", { coverage: activeEnvCoverage ?? "–" }) }}
          </div>
          <div class="shrink-0 flex items-center gap-1">
            <OButton variant="outline" size="sm" @click="applySuggestion">
              {{ t("settings.serviceIdentitySetup.apply") }}
            </OButton>
            <OButton
              variant="ghost"
              size="icon"
              class="opacity-40 hover:opacity-100"
              @click="dismissSuggestion"
            >
              <OIcon name="cancel" size="xs" />
            </OButton>
          </div>
        </div>

        <!-- Workload Insight Sidebar -->
        <ODrawer
          data-test="service-identity-setup-insight-drawer"
          v-model:open="insightDialogOpen"
          :width="insightPanelWidthPct"
        >
          <!-- #header kept: first line combines plain subtitle text with an inline theme-colored badge
               containing the title + tooltip; second line is a conditional coverage flex with icon.
               Cannot be expressed cleanly with title + sub-title props alone. -->
          <template #header>
            <div class="flex-1 min-w-0">
              <div class="text-base flex items-center">
                {{ insightData.subtitle }}
                <span
                  :class="[
                    'font-semibold px-2 py-0.5 rounded-default ml-2 inline-block',
                    'text-status-info-text bg-status-info-bg',
                  ]"
                >
                  {{ insightData.title }}
                  <OTooltip
                    v-if="insightData.title.length > 25"
                    :content="insightData.title"
                    side="top"
                  />
                </span>
              </div>
              <div
                v-if="
                  !(insightData as any).isCardLevel &&
                  insightData.coverage !== null
                "
                class="flex items-center gap-1.5 text-xs mt-1"
                :class="
                  'text-text-secondary'
                "
              >
                <OIcon name="verified" size="xs" class="text-status-positive" />
                <span
                  >{{ t("settings.serviceIdentitySetup.percentOfServices", { coverage: insightData.coverage }) }}
                  <span
                    v-if="
                      insightData.count !== null && insightData.total !== null
                    "
                    >({{ insightData.count }}/{{ insightData.total }})</span
                  >
                </span>
              </div>
            </div>
          </template>
          <!-- Stream contribution chart (single-value only) -->
          <div class="flex flex-col h-full">
          <template
            v-if="
              !(insightData as any).isCardLevel &&
              (insightData as any).streamDetails?.length > 0
            "
          >
            <div class="mb-3 shrink-0">
              <div
                class="text-2xs tracking-wide font-medium mb-2 text-text-label"
               
              >
                {{ t("settings.serviceIdentitySetup.streamSources") }}
              </div>
              <div style="height: 40vh; min-height: 180px">
                <CustomChartRenderer :data="insightChartData.options" />
              </div>
              <!-- Legend -->
              <div
                class="flex items-center justify-center gap-4 mt-2"
              >
                <div
                  v-for="sd in (insightData as any).streamDetails"
                  :key="sd.streamType"
                  class="flex items-center gap-1.5 text-2xs"
                  :class="
                    'text-text-secondary'
                  "
                >
                  <span
                    class="w-2 h-2 rounded-full"
                    :class="{
                      'bg-badge-blue-solid-bg': sd.streamType === 'logs',
                      'bg-badge-orange-solid-bg': sd.streamType === 'traces',
                      'bg-badge-success-solid-bg': sd.streamType === 'metrics',
                    }"
                  />
                  <span class="capitalize">{{ sd.streamType }}</span>
                  <span class="font-medium">{{
                    sd.streamNames.length
                  }}</span>
                </div>
              </div>
            </div>
          </template>

          <OSeparator class="mb-3 shrink-0" />

          <!-- Card-level: all values with bars -->
          <template
            v-if="
              (insightData as any).isCardLevel &&
              insightData.children.length > 0
            "
          >
            <div
              class="text-2xs font-medium mb-3"
              :class="
                'text-text-secondary'
              "
            >
              {{ t("settings.serviceIdentitySetup.allValues", { count: insightData.children.length }) }}
            </div>
            <div class="flex flex-col gap-2.5">
              <div
                v-for="child in insightData.children"
                :key="child.name"
                class="flex flex-col gap-1"
              >
                <div
                  class="flex items-center justify-between text-xs"
                >
                  <span class="truncate min-w-0 font-medium">{{
                    child.name
                  }}</span>
                  <span
                    class="shrink-0 ml-2 tabular-nums"
                    :class="
                      'text-text-secondary'
                    "
                    >{{ child.count }} {{ insightData.childCountLabel }}</span
                  >
                </div>
                <div
                  class="w-full h-2 rounded-full overflow-hidden"
                  :class="
                    'bg-surface-subtle'
                  "
                >
                  <div
                    class="h-full rounded-full transition-all"
                    :class="
                      insightDialogLevel === 'primary'
                        ? 'bg-blue-5'
                        : insightDialogLevel === 'secondary'
                          ? 'bg-teal-5'
                          : 'bg-purple-5'
                    "
                    :style="{
                      width: `${Math.max((child.count / insightData.maxChildCount) * 100, 6)}%`,
                    }"
                  />
                </div>
              </div>
            </div>
          </template>

          <!-- Single-value: related dimension columns (read-only) -->
          <template
            v-if="
              !(insightData as any).isCardLevel &&
              (insightData as any).relatedDimensions?.length > 0
            "
          >
            <!-- Explanation -->
            <div
              class="flex items-center gap-1.5 text-2xs mb-2 shrink-0 py-1.5 px-2.5 rounded-default"
              :class="
                'bg-status-info-bg text-text-secondary'
              "
            >
              <OIcon name="info" size="xs" />
              <span
                >{{ t("settings.serviceIdentitySetup.relatedValuesPre") }}
                <strong>{{
                  formatDimLabels((insightData as any).relatedDimensions)
                }}</strong>
                {{ t("settings.serviceIdentitySetup.valuesCoOccurringWith") }}
                <strong>{{ insightData.title }}</strong
                >.</span
              >
            </div>
            <div class="flex flex-1 min-h-0 py-3">
              <div
                v-for="(dim, dimIdx) in (insightData as any).relatedDimensions"
                :key="dim.label + dimIdx"
                class="flex-1 min-w-0 flex flex-col px-3"
                :class="[
                  dimIdx > 0
                    ? 'border-l border-border-default'
                    : '',
                ]"
              >
                <div
                  class="text-compact font-bold mb-2"
                  :class="
                    'text-text-body'
                  "
                >
                  {{ dim.label }}
                  <span
                    class="font-normal"
                    :class="
                      'text-text-secondary'
                    "
                    >({{ dim.values.length }})</span
                  >
                </div>
                <div
                  class="flex flex-col gap-1 flex-1 overflow-y-auto min-h-0"
                >
                  <span
                    v-for="dVal in dim.values"
                    :key="dVal"
                    class="text-compact py-1 px-2.5 rounded-default border truncate shrink-0"
                    :class="{
                      'bg-badge-teal-soft-bg border-badge-teal-ol-border text-badge-teal-soft-text': dim.color === 'teal',
                      'bg-badge-purple-soft-bg border-badge-purple-ol-border text-badge-purple-soft-text': dim.color === 'purple',
                      'bg-badge-blue-soft-bg border-badge-blue-ol-border text-badge-blue-soft-text': dim.color === 'blue',
                    }"
                    :title="dVal"
                    >{{ dVal }}</span
                  >
                  <span
                    v-if="dim.values.length === 0"
                    class="text-xs italic"
                    :class="
                      'text-text-secondary'
                    "
                    >{{ t("settings.serviceIdentitySetup.noValues") }}</span
                  >
                </div>
              </div>
            </div>
          </template>
          </div>
        </ODrawer>
      </div>

      <!-- Section 3: Warnings -->
      <div v-if="warnings.length > 0" class="mb-6">
        <OBanner
          variant="warning"
          icon="warning"
          data-test="service-identity-warnings-banner"
        >
          <div class="flex flex-col gap-1">
            <div v-for="(warn, idx) in warnings" :key="idx" class="text-sm">
              {{ warn }}
            </div>
          </div>
        </OBanner>
      </div>

      <!-- Field Details Dialog -->
      <ODialog
        data-test="service-identity-setup-details-dialog"
        v-model:open="detailsDialogVisible"
        @update:open="
          (v) => {
            if (!v) {
              preselectedValue = '';
              popupPrimaryValue = '';
              popupColumnSelections = [];
            }
          }
        "
        size="md"
        :title="primaryDim?.display"
        :sub-title="popupPrimaryValue ? `: ${popupPrimaryValue}` : undefined"
      >
        <OCardSection class="flex flex-col gap-4 p-0 border-t">
          <!-- Header section with cardinality details -->
          <div class="flex items-center gap-3 p-4 border-b">
            <span class="font-medium">{{ t("settings.serviceIdentitySetup.cardinality") }}</span>
            <OTag
              type="cardinalityClass"
              :value="
                dimensionAnalytics[primaryDim?.group_id]?.cardinality_class ||
                'Unknown'
              "
            >
              {{ t("settings.serviceIdentitySetup.uniqueValues", { n: dimensionAnalytics[primaryDim?.group_id]?.cardinality || 0 }) }}
            </OTag>
            <OTag
              type="cardinalityClass"
              :value="
                dimensionAnalytics[primaryDim?.group_id]?.cardinality_class ||
                'Unknown'
              "
            />
          </div>

          <!-- Two-pane Layout for Streams and Values -->
          <div
            v-if="
              selectedFieldAnalytics?.sample_values &&
              Object.keys(selectedFieldAnalytics.sample_values).length
            "
            class="flex h-75"
          >
            <!-- Left Pane: Streams List -->
            <div
              class="w-1/3 border-r bg-surface-subtle flex flex-col"
            >
              <!-- Static column header — never scrolls, never gets covered -->
              <div
                class="px-4 py-2 font-medium text-xs uppercase text-text-label border-b flex items-center justify-between shrink-0 bg-surface-subtle"
              >
                <span>{{
                  selectedStreamType ||
                  ["logs", "metrics", "traces"].find(
                    (t) => selectedFieldAnalytics.sample_values[t],
                  )
                }}</span>
                <span class="text-text-label">{{ t("settings.serviceIdentitySetup.streams") }}</span>
              </div>

              <!-- Scrollable content -->
              <div class="overflow-y-auto flex-1">
                <!-- Filtered to one type: no section header needed -->
                <template
                  v-if="
                    selectedStreamType &&
                    selectedFieldAnalytics.sample_values[selectedStreamType]
                  "
                >
                  <div
                    v-for="streamName in Object.keys(
                      selectedFieldAnalytics.sample_values[selectedStreamType],
                    )"
                    :key="streamName"
                    class="px-4 py-3 cursor-pointer transition-colors text-sm font-mono truncate hover:bg-primary/10"
                    :class="{
                      'bg-primary/20 text-primary font-medium':
                        activeStreamId === streamName,
                    }"
                    @click="activeStreamId = streamName"
                  >
                    {{ streamName }}
                  </div>
                </template>

                <!-- All types: sticky section labels for 2nd+ types only; first is already in the static header -->
                <template v-else>
                  <template
                    v-for="(typeName, typeIdx) in [
                      'logs',
                      'metrics',
                      'traces',
                    ].filter((t) => selectedFieldAnalytics.sample_values[t])"
                    :key="typeName"
                  >
                    <div
                      v-if="typeIdx > 0"
                      class="px-4 py-1 text-3xs font-bold uppercase text-text-label sticky top-0 z-10 border-b border-t bg-surface-subtle"
                    >
                      {{ typeName }}
                    </div>
                    <div
                      v-for="streamName in Object.keys(
                        selectedFieldAnalytics.sample_values[typeName],
                      )"
                      :key="typeName + '-' + streamName"
                      class="px-4 py-3 cursor-pointer transition-colors text-sm font-mono truncate hover:bg-primary/10"
                      :class="{
                        'bg-primary/20 text-primary font-medium':
                          activeStreamId === streamName &&
                          activeStreamType === typeName,
                      }"
                      @click="
                        activeStreamId = streamName;
                        activeStreamType = typeName;
                      "
                    >
                      {{ streamName }}
                    </div>
                  </template>
                </template>
              </div>
            </div>

            <!-- Right Pane: N-1 hierarchy columns -->
            <div
              class="flex-1 flex overflow-x-auto bg-surface-base"
            >
              <div
                v-for="(col, colIdx) in popupColumns"
                :key="col.group_id"
                class="min-w-40 flex-1 overflow-y-auto"
                :class="{ 'border-l': colIdx > 0 }"
              >
                <div
                  class="px-4 py-2 font-medium text-xs uppercase text-text-label sticky top-0 z-10 border-b bg-surface-subtle"
                >
                  {{ col.display }}
                </div>
                <div class="p-4 flex flex-col gap-2">
                  <div
                    v-for="val in getPopupColumnValues(colIdx)"
                    :key="val"
                    class="px-3 py-2 rounded-default border transition-colors cursor-pointer font-mono truncate"
                    :class="
                      popupColumnSelections[colIdx] === val
                        ? 'bg-primary/15 border-primary/40 text-primary ring-1 ring-primary/30'
                        : 'bg-surface-subtle border-border-default'
                    "
                    @click="selectPopupColumnValue(colIdx, val)"
                  >
                    {{ val }}
                  </div>
                  <div
                    v-if="getPopupColumnValues(colIdx).length === 0"
                    class="text-text-muted text-xs italic p-2"
                  >
                    {{ t("settings.serviceIdentitySetup.noValues") }}
                  </div>
                </div>
              </div>
              <!-- Fallback when no ranked dims beyond the selected field -->
              <div
                v-if="popupColumns.length === 0"
                class="flex items-center justify-center flex-1 text-text-muted text-sm italic"
              >
                {{ t("settings.serviceIdentitySetup.noAdditionalDimensions") }}
              </div>
            </div>
          </div>

          <div v-else class="text-text-muted italic p-4 text-center">
            {{ t("settings.serviceIdentitySetup.noSampleData") }}
          </div>
        </OCardSection>
      </ODialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import { useStore } from "vuex";
import useTheme from "@/composables/useTheme";
import { useI18n } from "vue-i18n";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import OTagInput from "@/lib/forms/TagInput/OTagInput.vue";
import serviceStreamsService from "@/services/service_streams";
import { clearIdentityConfigCache } from "@/utils/identityConfig";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import type {
  ServiceIdentityConfig,
  IdentitySet,
  DimensionAnalytics,
  DimensionAnalyticsSummary,
  FoundGroup,
  FieldAlias,
  ServiceFieldSource,
} from "@/services/service_streams";
import { ENV_SEGMENTS, groupEnvKey } from "@/utils/serviceStreamEnvs";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetectedEnvironment {
  environment_type: string;
  description: string;
  evidence_groups: string[];
}

interface SuggestedConfig {
  distinguish_by: string[];
  reason: string;
}

// ─── Props ────────────────────────────────────────────────────────────────────

const props = defineProps<{
  orgIdentifier: string;
  semanticGroups?: FieldAlias[];
}>();

// ─── Setup ────────────────────────────────────────────────────────────────────

const store = useStore();
const { isDark: isDarkTheme } = useTheme();
const { t } = useI18n();

// ─── State ────────────────────────────────────────────────────────────────────

const loading = ref(true);
const saving = ref(false);
const dimCardMoreMenuOpen = ref<Record<number, boolean>>({});
const activeStreamId = ref<string>("");
const activeStreamType = ref<string>("");
const selectedStreamType = ref<string>("");

const availableGroups = ref<FoundGroup[]>([]);
const serviceFieldSources = ref<ServiceFieldSource[]>([]);
const trackedAliasExpanded = ref(false);
const warnings = ref<string[]>([]);
const suggestionDismissed = ref(false);

/** Detailed analytics data mapped by dimension name */
const dimensionAnalytics = ref<Record<string, DimensionAnalytics>>({});

/** Section 2: pill-based field configuration */
const addingToEnv = ref<string>("");
const addFieldValue = ref<string | undefined>(undefined);
const addingTrackedAlias = ref(false);
const addTrackedAliasValue = ref<string | undefined>(undefined);
const addTrackedAliasSelectRef = ref<any>(null);

/** All env keys that have at least one configured field, ordered by detected env order */
const allConfiguredEnvs = computed(() => {
  const envOrder = detectedEnvironments.value.map((e) => e.key);
  const configured = new Set(
    Object.entries(setDistinguishBy.value)
      .filter(([, fields]) => fields.filter(Boolean).length > 0)
      .map(([key]) => key),
  );
  // Sort by detected environment order, then append any not in that list
  return [
    ...envOrder.filter((k) => configured.has(k)),
    ...[...configured].filter((k) => !envOrder.includes(k)),
  ];
});

const addFieldSelectRef = ref<any>(null);

/** Configured fields for the active env (non-empty IDs only) */
const configuredFields = computed(() => distinguishBy.value.filter(Boolean));

/** Whether the suggested config already matches what's currently selected */
const suggestionAlreadyApplied = computed(() => {
  if (!suggestedConfig.value?.distinguish_by?.length) return false;
  const suggested = [...suggestedConfig.value.distinguish_by].sort();
  const current = [...configuredFields.value].sort();
  return (
    suggested.length === current.length &&
    suggested.every((v, i) => v === current[i])
  );
});

/** Display label for the active environment tab */
const activeEnvLabel = computed(() =>
  getIdentitySetLabel(activeEnvironment.value),
);

/** Field Details Dialog State */
const detailsDialogVisible = ref(false);
const selectedField = ref<FoundGroup | null>(null);
/** When set, the popup right pane highlights this value and scrolls to it */
const preselectedValue = ref<string>("");
const valuesScrollContainer = ref<HTMLElement | null>(null);
/** Selected value per column index in the N-1 hierarchy columns */
const popupColumnSelections = ref<(string | null)[]>([]);
/** Selected value for the primary (title-level) dimension */
const popupPrimaryValue = ref<string>("");

/** Service name field is always the "service" alias group — not configurable */
const nameField = "service";

/**
 * Per-set disambiguation fields.
 * Keys are identity set IDs (e.g. "k8s", "aws") → array of group_ids.
 * Each tab's configuration is stored here independently.
 */
const setDistinguishBy = ref<Record<string, string[]>>({});

/**
 * Store for identity set labels from API.
 * Maps set ID to display label, populated from loaded config.
 */
const setLabels = ref<Record<string, string>>({});

/** Get display label for identity set ID from API-provided labels */
function getIdentitySetLabel(id: string): string {
  return setLabels.value[id] ?? id;
}

/**
 * Computed getter/setter for the currently active environment's distinguish_by list.
 * Allows the disambiguation field rows to remain unaware of the multi-set model.
 */
const distinguishBy = computed<string[]>({
  get: () => setDistinguishBy.value[activeEnvironment.value] ?? [],
  set: (val: string[]) => {
    if (activeEnvironment.value) {
      setDistinguishBy.value[activeEnvironment.value] = val;
    }
  },
});

/** Current identity config fetched from backend */
const currentIdentityConfig = ref<ServiceIdentityConfig | null>(null);

/** Tracked alias group IDs — limits which groups are written to discovered service records */
const trackedAliasIds = ref<string[]>([]);

/** When true, correlation matches streams without requiring the `service` dimension */
const serviceOptional = ref<boolean>(false);

// Computed value for the right pane based on selected stream
const activeStreamValues = computed(() => {
  if (
    !selectedFieldAnalytics.value?.sample_values ||
    !activeStreamId.value ||
    !activeStreamType.value
  ) {
    return [];
  }
  return (
    selectedFieldAnalytics.value.sample_values[activeStreamType.value]?.[
      activeStreamId.value
    ] || []
  );
});

/** Active environment tab - auto-selects first detected environment */
const activeEnvironment = ref<string>("");

/** Map of group_id first segment -> environment key (shared from serviceStreamEnvs util) */

/** Environments from the identity config, filtered to only show those with actual detected data */
const detectedEnvironments = computed(() => {
  const sets = currentIdentityConfig.value?.sets;
  if (!sets?.length) return [];

  // Filter sets to only show those with actual detected workload data
  const filteredSets = sets.filter((set) => {
    // Check if this environment has workload groups with detected fields
    // Use the workloadDetectedGroups logic which filters availableGroups by cardinality > 0
    const workloadGroups = workloadDetectedGroups.value;

    // Map environment names to the types of workload groups they should contain
    const environmentPatterns: Record<string, RegExp[]> = {
      kubernetes: [/^k8s/i, /kubernetes/i],
      k8s: [/^k8s/i, /kubernetes/i],
      aws: [/^aws/i],
      azure: [/^azure/i],
      gcp: [/^gcp/i],
    };

    const patterns = environmentPatterns[set.id.toLowerCase()] || [];

    // If no patterns defined, include the set (could be custom environment)
    if (patterns.length === 0) return true;

    // Check if any workload groups match this environment's patterns
    return workloadGroups.some((group) =>
      patterns.some(
        (pattern) =>
          pattern.test(group.group_id) || pattern.test(group.display),
      ),
    );
  });

  return filteredSets
    .map((set) => ({ key: set.id, label: set.label }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

/** Groups visible in the currently active environment tab */
const activeEnvGroups = computed(() => {
  const sets = currentIdentityConfig.value?.sets;
  if (!sets?.length) return [];

  let configuredFieldIds: string[] = [];

  if (!activeEnvironment.value || activeEnvironment.value === "all") {
    // For "all" tab: show all configured distinguish_by fields from all sets
    configuredFieldIds = sets.flatMap((set) => set.distinguish_by || []);
  } else {
    // For specific environment tab: show only fields for that set
    const activeSet = sets.find((set) => set.id === activeEnvironment.value);
    configuredFieldIds = activeSet?.distinguish_by || [];
  }

  // Convert field IDs to FoundGroup format by looking them up in availableGroups
  // Remove duplicates and sort alphabetically for consistent display
  const uniqueFieldIds = [...new Set(configuredFieldIds)];
  const groups = uniqueFieldIds
    .map((fieldId) =>
      availableGroups.value.find((group) => group.group_id === fieldId),
    )
    .filter((group): group is FoundGroup => group !== undefined);

  // Sort groups by display name for consistent ordering
  return groups.sort((a, b) => a.display.localeCompare(b.display));
});

/** Auto-select first detected environment when data loads */
watch(
  detectedEnvironments,
  (envs) => {
    if (
      envs.length > 0 &&
      !envs.some((e) => e.key === activeEnvironment.value)
    ) {
      activeEnvironment.value = envs[0].key;
    }
  },
  { immediate: true },
);

/** Ensure activeEnvironment is never invalid */
watch(
  activeEnvironment,
  (env) => {
    // Prevent "all" or empty values that cause save issues
    if (!env || env === "all") {
      const validEnvironments = detectedEnvironments.value;
      if (validEnvironments.length > 0) {
        activeEnvironment.value = validEnvironments[0].key;
      }
    }
  },
  { immediate: true },
);

/** Reset suggestion + add state when switching tabs */
watch(activeEnvironment, () => {
  suggestionDismissed.value = false;
  addingToEnv.value = "";
  addFieldValue.value = undefined;
});

/** Re-show recommendation when user changes fields away from the suggested config */
watch(configuredFields, () => {
  if (suggestionDismissed.value && !suggestionAlreadyApplied.value) {
    suggestionDismissed.value = false;
  }
});

/** Coverage % badge value for the active environment tab */
const activeEnvCoverage = computed(() => {
  if (!totalServices.value || activeEnvGroups.value.length === 0) return null;
  const coverages = activeEnvGroups.value
    .map((g) => {
      const dim = dimensionAnalytics.value[g.group_id];
      return dim
        ? Math.round((dim.service_count / totalServices.value) * 100)
        : null;
    })
    .filter((v): v is number => v !== null);
  if (!coverages.length) return null;
  return Math.round(coverages.reduce((a, b) => a + b, 0) / coverages.length);
});

/** Available groups filtered to only include ones with actual detected workload data */
const workloadDetectedGroups = computed(() => {
  return availableGroups.value.filter((group) => {
    const dim = dimensionAnalytics.value[group.group_id];
    // Only include groups that have dimension analytics with meaningful cardinality
    // This excludes empty groups like AWS/Azure/Kubernetes with 0 detected fields
    return dim && dim.cardinality > 0;
  });
});

// ─── Emits ────────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  (e: "navigate-to-aliases", groupId: string): void;
  (e: "navigate-to-services"): void;
  (e: "update-service-fields", fields: string[]): void;
}>();

// ─── Field Mapping Dialog ────────────────────────────────────────────────────

const showFieldMappingDialog = ref(false);
const editableServiceFields = ref<string[]>([]);
const savingFieldMappings = ref(false);

function openFieldMappingDialog() {
  editableServiceFields.value = [...allServiceFieldNames.value];
  showFieldMappingDialog.value = true;
}

async function saveFieldMappings() {
  savingFieldMappings.value = true;
  try {
    emit("update-service-fields", editableServiceFields.value);
    showFieldMappingDialog.value = false;
  } finally {
    savingFieldMappings.value = false;
  }
}

// ─── Computed ─────────────────────────────────────────────────────────────────

/** The FoundGroup for the "service" group (used for stream type chips) */
const serviceGroup = computed<FoundGroup | undefined>(() =>
  availableGroups.value.find((g) => g.group_id === "service"),
);
const serviceGroupDisplay = computed(
  () => serviceGroup.value?.display ?? "Service",
);
const serviceGroupStreamTypes = computed(
  () => serviceGroup.value?.stream_types ?? [],
);

/** Service name banner: expanded/collapsed toggle */
const serviceNameExpanded = ref(false);

/** Color themes for up to 5 dimension stat cards */
const DIM_CARD_THEMES = [
  {
    // blue
    icon: "cloud",
    iconClass: "text-blue-5",
    countClass: "text-blue-6",
    border:
      "border: 1px solid rgba(59,130,246,0.4); background: rgba(59,130,246,0.06)",
    pill: "bg-badge-blue-soft-bg border-badge-blue-ol-border text-badge-blue-soft-text",
  },
  {
    // teal
    icon: "folder-open",
    iconClass: "text-teal-5",
    countClass: "text-teal-6",
    border:
      "border: 1px solid rgba(20,184,166,0.4); background: rgba(20,184,166,0.06)",
    pill: "bg-badge-teal-soft-bg border-badge-teal-ol-border text-badge-teal-soft-text",
  },
  {
    // purple
    icon: "widgets",
    iconClass: "text-purple-5",
    countClass: "text-purple-6",
    border:
      "border: 1px solid rgba(168,85,247,0.4); background: rgba(168,85,247,0.06)",
    pill: "bg-badge-purple-soft-bg border-badge-purple-ol-border text-badge-purple-soft-text",
  },
  {
    // amber
    icon: "lan",
    iconClass: "text-amber-5",
    countClass: "text-amber-6",
    border:
      "border: 1px solid rgba(245,158,11,0.4); background: rgba(245,158,11,0.06)",
    pill: "bg-badge-amber-soft-bg border-badge-amber-ol-border text-badge-amber-soft-text",
  },
  {
    // rose
    icon: "hub",
    iconClass: "text-red-4",
    countClass: "text-red-5",
    border:
      "border: 1px solid rgba(244,63,94,0.4); background: rgba(244,63,94,0.06)",
    pill: "bg-badge-error-soft-bg border-badge-error-ol-border text-badge-error-soft-text",
  },
] as const;

/** Summary counts + top values for each ranked dimension (up to 5) */
const workloadSummary = computed(() => {
  const cards = primaryDimCards.value;
  const dims = rankedDims.value;

  // Build values for primary (from cards keys), secondary (from childValues), tertiary (from tertiaryValues)
  const primaryValues = Object.keys(cards);
  const allSecondaryVals = new Set<string>();
  const allTertiaryVals = new Set<string>();
  for (const card of Object.values(cards)) {
    for (const cv of card.childValues) allSecondaryVals.add(cv);
    for (const tVals of Object.values(card.tertiaryValues)) {
      for (const v of tVals) allTertiaryVals.add(v);
    }
  }
  const builtInValues: string[][] = [
    primaryValues,
    Array.from(allSecondaryVals),
    Array.from(allTertiaryVals),
  ];

  // Build per-dim summaries for all ranked dims (up to 5)
  const dimSummaries = dims.slice(0, 5).map((dim, i) => {
    let values: string[];
    let count: number;
    if (i < 3) {
      values = builtInValues[i];
      count = values.length;
    } else {
      const da = dimensionAnalytics.value[dim.group_id];
      values = da?.value_children ? Object.keys(da.value_children) : [];
      count = da?.cardinality ?? dim.unique_values ?? values.length;
    }
    return {
      dim,
      label: pluralize(dim.display),
      singularLabel: dim.display,
      count,
      values,
    };
  });

  return {
    dims: dimSummaries,
    // Backward-compat accessors used by insightData
    primaryLabel: dimSummaries[0]?.label ?? "",
    primarySingularLabel: dimSummaries[0]?.singularLabel ?? "",
    primaryCount: dimSummaries[0]?.count ?? 0,
    primaryValues,
    secondaryLabel: dimSummaries[1]?.label ?? "",
    secondarySingularLabel: dimSummaries[1]?.singularLabel ?? "",
    secondaryCount: dimSummaries[1]?.count ?? 0,
    secondaryValues: Array.from(allSecondaryVals),
    tertiaryLabel: dimSummaries[2]?.label ?? "",
    tertiarySingularLabel: dimSummaries[2]?.singularLabel ?? "",
    tertiaryCount: dimSummaries[2]?.count ?? 0,
    tertiaryValues: Array.from(allTertiaryVals),
  };
});

/** Dynamic dim cards — built from workloadSummary.dims + themes */
const dimCards = computed(() => {
  const levels: Array<"primary" | "secondary" | "tertiary"> = [
    "primary",
    "secondary",
    "tertiary",
  ];
  return workloadSummary.value.dims
    .map((s, i) => ({
      dim: s.dim,
      theme: DIM_CARD_THEMES[i] ?? DIM_CARD_THEMES[0],
      level: levels[i] ?? ("tertiary" as const),
      label: s.singularLabel,
      count: s.count,
      values: s.values,
    }))
    .filter((c) => c.count > 0 || c.values.length > 0);
});

/** Open insight dialog by card index */
function openInsightDialogByIdx(value: string, idx: number) {
  const levels: Array<"primary" | "secondary" | "tertiary"> = [
    "primary",
    "secondary",
    "tertiary",
  ];
  openInsightDialog(value, levels[idx] ?? "tertiary");
}

/** Workload insight popup state */
const insightDialogOpen = ref(false);
const insightDialogValue = ref("");
const insightDialogLevel = ref<"primary" | "secondary" | "tertiary">("primary");
/** Tracks selected pill per dimension column for drill-down filtering (dimIdx → selected value) */
const insightSelectedDim = ref<Record<number, string>>({});

function openInsightDialog(
  value: string,
  level: "primary" | "secondary" | "tertiary",
) {
  insightDialogValue.value = value;
  insightDialogLevel.value = level;
  insightSelectedDim.value = {}; // Reset drill-down selections
  insightDialogOpen.value = true;

  // Auto-select the first row in the first dimension column
  nextTick(() => {
    const dims = (insightData.value as any).relatedDimensions;
    if (dims?.length > 0) {
      const firstValues = getFilteredDimValues(dims, 0);
      if (firstValues.length > 0) {
        insightSelectedDim.value = { 0: firstValues[0] };
      }
    }
  });
}

/** When a dimension pill is clicked inside the insight dialog, filter the next column */
function selectDimValue(dimIdx: number, value: string) {
  const current = { ...insightSelectedDim.value };
  if (current[dimIdx] === value) {
    // Already selected — do nothing (no deselect)
    return;
  }
  current[dimIdx] = value;
  // Clear downstream selections
  for (const k of Object.keys(current)) {
    if (Number(k) > dimIdx) delete current[Number(k)];
  }
  insightSelectedDim.value = current;
}

/** Get filtered values for a dimension column based on upstream selections.
 *  Uses the same approach as getPopupColumnValues — queries dimensionAnalytics directly. */
function getFilteredDimValues(dimensions: any[], dimIdx: number): string[] {
  const dim = dimensions[dimIdx];
  if (!dim) return [];

  const prevIdx = dimIdx - 1;
  const prevSelected = insightSelectedDim.value[prevIdx];

  // First column or no upstream selection → show all values
  if (prevIdx < 0 || !prevSelected) return dim.values;

  // Query dimensionAnalytics directly (same as getPopupColumnValues)
  const prevDim = dimensions[prevIdx];
  if (prevDim?.groupId && dim.groupId) {
    const prevAnalytics = dimensionAnalytics.value[prevDim.groupId];
    const filtered =
      prevAnalytics?.value_children?.[prevSelected]?.[dim.groupId] ?? [];
    if (filtered.length > 0) return filtered.slice().sort();
  }

  // Fallback: show all values
  return dim.values;
}

/** Format a list of labels into proper English: "A", "A or B", "A, B, or C" */
function formatSelectableLabels(dims: any[]): string {
  const labels = dims.slice(0, -1).map((d: any) => d.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return labels.slice(0, -1).join(", ") + ", or " + labels[labels.length - 1];
}

/** Format all dimension labels into proper English: "A", "A and B", "A, B, and C" */
function formatDimLabels(dims: any[]): string {
  const labels = dims.map((d: any) => d.label);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return labels.slice(0, -1).join(", ") + ", and " + labels[labels.length - 1];
}

/** Returns inline style for selected dimension pill — subtle primary highlight */
function getDimSelectedStyle(_color: string): Record<string, string> {
  return {
    backgroundColor: isDarkTheme.value
      ? "rgba(59,130,246,0.15)"
      : "rgba(59,130,246,0.1)",
    borderColor: isDarkTheme.value
      ? "rgba(59,130,246,0.5)"
      : "rgba(59,130,246,0.4)",
    color: isDarkTheme.value ? "#93c5fd" : "#1d4ed8",
    fontWeight: "600",
  };
}

/** Build insight data for the currently open popup */
const insightData = computed(() => {
  const val = insightDialogValue.value;
  const level = insightDialogLevel.value;
  const cards = primaryDimCards.value;
  const isCardLevel = val === "";

  if (level === "primary") {
    const group = primaryDim.value;
    const dim = group ? dimensionAnalytics.value[group.group_id] : null;

    if (isCardLevel) {
      // Card-level: show ALL primary values with their secondary/tertiary counts
      const allValues = Object.keys(cards);
      const children = allValues.map((pVal) => {
        const card = cards[pVal];
        const secondaryCount = card?.childValues?.length ?? 0;
        const tertiaryCount = Object.values(card?.tertiaryValues ?? {}).reduce(
          (sum, arr) => sum + arr.length,
          0,
        );
        return { name: pVal, count: secondaryCount, tertiaryCount };
      });
      children.sort((a, b) => b.count - a.count);
      return {
        title: workloadSummary.value.primaryLabel,
        subtitle: t("settings.serviceIdentitySetup.uniqueValuesDetected", { n: allValues.length }),
        coverage: null,
        count: null,
        total: dim?.service_count ?? null,
        childLabel: "",
        childCountLabel: secondaryDim.value
          ? pluralize(secondaryDim.value.display).toLowerCase()
          : "",
        tertiaryCountLabel: tertiaryDim.value
          ? pluralize(tertiaryDim.value.display).toLowerCase()
          : "",
        children,
        maxChildCount: Math.max(...children.map((c) => c.count), 1),
        isCardLevel: true,
      };
    }

    const card = cards[val];
    const coverage = group ? getValueCoverage(group, val) : null;
    const count = dim?.value_counts?.[val] ?? null;
    const total = dim?.service_count ?? null;

    const streamDetails = group
      ? getValueStreamDetails(group.group_id, val)
      : [];

    // Build dimension columns (no stream columns — chart handles that)
    const relatedDimensions: {
      label: string;
      level: string;
      color: string;
      values: string[];
      groupId?: string;
    }[] = [];
    if (card && secondaryDim.value) {
      relatedDimensions.push({
        label: secondaryDim.value.display,
        level: "secondary",
        color: "teal",
        values: card.childValues,
        groupId: secondaryDim.value.group_id,
      });
      if (tertiaryDim.value) {
        // All tertiary values from this card
        const allTertiary = new Set<string>();
        for (const tvs of Object.values(card.tertiaryValues)) {
          for (const tv of tvs) allTertiary.add(tv);
        }
        relatedDimensions.push({
          label: tertiaryDim.value.display,
          level: "tertiary",
          color: "purple",
          values: [...allTertiary].sort(),
          groupId: tertiaryDim.value.group_id,
        });
      }
    }

    // Keep children for backward compat (card-level uses it)
    const children: { name: string; count: number }[] = [];
    if (card && secondaryDim.value) {
      for (const cv of card.childValues) {
        children.push({
          name: cv,
          count: card.tertiaryValues[cv]?.length ?? 0,
        });
      }
      children.sort((a, b) => b.count - a.count);
    }
    return {
      title: val,
      subtitle: group?.display ?? "",
      coverage,
      count,
      total,
      childLabel: secondaryDim.value
        ? pluralize(secondaryDim.value.display)
        : "",
      childCountLabel: tertiaryDim.value
        ? pluralize(tertiaryDim.value.display).toLowerCase()
        : "",
      children,
      maxChildCount: Math.max(...children.map((c) => c.count), 1),
      relatedDimensions,
      isCardLevel: false,
      streamTypes: group ? getValueStreamTypes(group.group_id, val) : [],
      streamDetails,
    };
  }

  if (level === "secondary") {
    const group = secondaryDim.value;
    const dim = group ? dimensionAnalytics.value[group.group_id] : null;

    if (isCardLevel) {
      // Card-level: show ALL secondary values with their tertiary counts
      const allVals = workloadSummary.value.secondaryValues;
      const children = allVals.map((sVal) => {
        const tertiaryVals = getSecondaryTertiaryValues(sVal);
        // Find which primaries contain this secondary
        let parentCount = 0;
        for (const card of Object.values(cards)) {
          if (card.childValues.includes(sVal)) parentCount++;
        }
        return { name: sVal, count: tertiaryVals.length, parentCount };
      });
      children.sort((a, b) => b.count - a.count);
      return {
        title: workloadSummary.value.secondaryLabel,
        subtitle: t("settings.serviceIdentitySetup.uniqueValuesDetected", { n: allVals.length }),
        coverage: null,
        count: null,
        total: dim?.service_count ?? null,
        childLabel: "",
        childCountLabel: tertiaryDim.value
          ? pluralize(tertiaryDim.value.display).toLowerCase()
          : "",
        parentCountLabel: primaryDim.value
          ? pluralize(primaryDim.value.display).toLowerCase()
          : "",
        children,
        maxChildCount: Math.max(...children.map((c) => c.count), 1),
        isCardLevel: true,
      };
    }

    const coverage = group ? getValueCoverage(group, val) : null;
    const count = dim?.value_counts?.[val] ?? null;
    const total = dim?.service_count ?? null;
    const parents: string[] = [];
    for (const [pVal, card] of Object.entries(cards)) {
      if (card.childValues.includes(val)) parents.push(pVal);
    }
    const tertiaryVals = getSecondaryTertiaryValues(val);

    const streamDetails = group
      ? getValueStreamDetails(group.group_id, val)
      : [];
    const relatedDimensions: {
      label: string;
      level: string;
      color: string;
      values: string[];
      groupId?: string;
    }[] = [];
    if (primaryDim.value && parents.length > 0) {
      relatedDimensions.push({
        label: primaryDim.value.display,
        level: "primary",
        color: "blue",
        values: parents.sort(),
        groupId: primaryDim.value.group_id,
      });
    }
    if (tertiaryDim.value && tertiaryVals.length > 0) {
      relatedDimensions.push({
        label: tertiaryDim.value.display,
        level: "tertiary",
        color: "purple",
        values: tertiaryVals,
        groupId: tertiaryDim.value.group_id,
      });
    }

    return {
      title: val,
      subtitle: group?.display ?? "",
      coverage,
      count,
      total,
      childLabel: primaryDim.value
        ? `Found in ${pluralize(primaryDim.value.display).toLowerCase()}`
        : "",
      childCountLabel: "",
      children: parents.map((p) => ({ name: p, count: 0 })),
      maxChildCount: 1,
      tertiaryLabel: tertiaryDim.value
        ? pluralize(tertiaryDim.value.display)
        : "",
      tertiaryValues: tertiaryVals,
      relatedDimensions,
      isCardLevel: false,
      streamTypes: group ? getValueStreamTypes(group.group_id, val) : [],
      streamDetails,
    };
  }

  // tertiary
  const group = tertiaryDim.value;
  const dim = group ? dimensionAnalytics.value[group.group_id] : null;

  if (isCardLevel) {
    // Card-level: show ALL tertiary values with their locations
    const allVals = workloadSummary.value.tertiaryValues;
    const children = allVals.map((tVal) => {
      const locs = getTertiaryLocations(tVal);
      return { name: tVal, count: locs.length };
    });
    children.sort((a, b) => b.count - a.count);
    return {
      title: workloadSummary.value.tertiaryLabel,
      subtitle: t("settings.serviceIdentitySetup.uniqueValuesDetected", { n: allVals.length }),
      coverage: null,
      count: null,
      total: dim?.service_count ?? null,
      childLabel: "",
      childCountLabel: t("settings.serviceIdentitySetup.locations"),
      children,
      maxChildCount: Math.max(...children.map((c) => c.count), 1),
      isCardLevel: true,
    };
  }

  const coverage = group ? getValueCoverage(group, val) : null;
  const count = dim?.value_counts?.[val] ?? null;
  const total = dim?.service_count ?? null;
  const locations = getTertiaryLocations(val);

  const streamDetails = group ? getValueStreamDetails(group.group_id, val) : [];
  const relatedDimensions: {
    label: string;
    level: string;
    color: string;
    values: string[];
    groupId?: string;
  }[] = [];
  if (primaryDim.value && locations.length > 0) {
    const uniquePrimaries = [
      ...new Set(locations.map((l) => l.primary)),
    ].sort();
    relatedDimensions.push({
      label: primaryDim.value.display,
      level: "primary",
      color: "blue",
      values: uniquePrimaries,
      groupId: primaryDim.value.group_id,
    });
  }
  if (secondaryDim.value && locations.length > 0) {
    const uniqueSecondaries = [
      ...new Set(locations.map((l) => l.secondary)),
    ].sort();
    relatedDimensions.push({
      label: secondaryDim.value.display,
      level: "secondary",
      color: "teal",
      values: uniqueSecondaries,
      groupId: secondaryDim.value.group_id,
    });
  }

  return {
    title: val,
    subtitle: group?.display ?? "",
    coverage,
    count,
    total,
    childLabel: "Runs in",
    childCountLabel: "",
    children: [] as { name: string; count: number }[],
    maxChildCount: 1,
    locations,
    relatedDimensions,
    isCardLevel: false,
    streamTypes: group ? getValueStreamTypes(group.group_id, val) : [],
    streamDetails,
  };
});

/** Chart data for insight dialog — stream contribution donut */
/** Dynamic panel width based on number of related dimension columns */
const insightPanelWidth = computed(() => {
  const dims = (insightData.value as any)?.relatedDimensions;
  const colCount = dims?.length ?? 0;
  if (colCount <= 2) return "480px";
  if (colCount === 3) return "640px";
  return "800px"; // 4+
});

const insightPanelWidthPct = computed(() => {
  const dims = (insightData.value as any)?.relatedDimensions;
  const colCount = dims?.length ?? 0;
  if (colCount <= 2) return 37;
  if (colCount === 3) return 50;
  return 63; // 4+
});

const STREAM_TYPE_COLORS: Record<string, string> = {
  logs: "#3b82f6",
  traces: "#f59e0b",
  metrics: "#22c55e",
};

const insightChartData = computed(() => {
  if (!insightDialogOpen.value) return { options: {} };

  const data = insightData.value;
  const streamDetails: { streamType: string; streamNames: string[] }[] =
    (data as any).streamDetails ?? [];

  // Build pie data from stream details: each slice = one stream type, value = number of streams
  const pieData = streamDetails.map((sd) => ({
    name: sd.streamType.charAt(0).toUpperCase() + sd.streamType.slice(1),
    value: sd.streamNames.length,
    streamNames: sd.streamNames,
  }));

  const totalStreams = pieData.reduce((sum, d) => sum + d.value, 0);

  return {
    options: {
      tooltip: {
        trigger: "item",
        enterable: true,
        appendToBody: true,
        confine: false,
        textStyle: {
          color: isDarkTheme.value ? "#fff" : "#000",
          fontSize: 12,
        },
        backgroundColor: isDarkTheme.value ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)",
        extraCssText: "max-height: 240px; overflow-y: auto;",
        formatter: function (params: any) {
          const names: string[] = params.data?.streamNames ?? [];
          const header = `${params.marker} ${params.name} : <b>${params.value} streams (${params.percent}%)</b>`;
          if (!names.length) return header;
          const list = names
            .map(
              (n) =>
                `<div style="padding:1px 0;padding-left:14px;font-size: var(--text-2xs);">${n}</div>`,
            )
            .join("");
          return header + '<div style="margin-top:4px;">' + list + "</div>";
        },
      },
      color: streamDetails.map(
        (sd) => STREAM_TYPE_COLORS[sd.streamType] ?? "#9ca3af",
      ),
      series: [
        {
          type: "pie",
          radius: ["50%", "78%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 4,
            borderColor: isDarkTheme.value ? "#111827" : "#fff",
            borderWidth: 2,
          },
          label: { show: false },
          emphasis: {
            label: { show: false },
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: "rgba(0, 0, 0, 0.2)",
            },
          },
          data: pieData,
        },
      ],
      graphic:
        totalStreams > 0
          ? [
              {
                type: "text",
                left: "center",
                top: "center",
                style: {
                  text: `${totalStreams}`,
                  fontSize: 22,
                  fontWeight: "bold",
                  fill: isDarkTheme.value ? "#e5e7eb" : "#1f2937",
                  textAlign: "center",
                },
                subtextStyle: {
                  text: "streams",
                  fontSize: 10,
                },
              },
            ]
          : [],
    },
  };
});

/** Unique field names actually found in data (from service_field_sources) with their stream types */
const detectedServiceFields = computed<
  { name: string; streamTypes: string[] }[]
>(() => {
  if (serviceFieldSources.value.length > 0) {
    return serviceFieldSources.value
      .map((s) => ({ name: s.field_name, streamTypes: s.stream_types }))
      .sort((a, b) => b.streamTypes.length - a.streamTypes.length);
  }
  // Fallback: derive from serviceGroup.aliases if service_field_sources not available
  const aliases = serviceGroup.value?.aliases;
  if (!aliases) return [];
  const fieldMap = new Map<string, string[]>();
  for (const [streamType, fieldName] of Object.entries(aliases)) {
    if (!fieldMap.has(fieldName)) fieldMap.set(fieldName, []);
    fieldMap.get(fieldName)!.push(streamType);
  }
  return Array.from(fieldMap.entries())
    .map(([name, streamTypes]) => ({ name, streamTypes }))
    .sort((a, b) => b.streamTypes.length - a.streamTypes.length);
});

/** All configured field names from semantic groups (includes ones not yet seen in data) */
const allServiceFieldNames = computed<string[]>(() => {
  const group = props.semanticGroups?.find((g) => g.id === "service");
  return group?.fields ?? [];
});

/** Configured fields NOT found in data — shown as grey pills in expanded view */
const unseenServiceFields = computed<string[]>(() => {
  const detectedNames = new Set(detectedServiceFields.value.map((f) => f.name));
  return allServiceFieldNames.value.filter((f) => !detectedNames.has(f));
});

/** Summary text for collapsed banner: first 2 field names + "+N more" */
const serviceFieldSummary = computed(() => {
  const fields = detectedServiceFields.value;
  const shown = fields.slice(0, 2).map((f) => f.name);
  const remaining =
    fields.length - shown.length + unseenServiceFields.value.length;
  return { shown, remaining };
});

/** Whether service name field is detected in any stream */
const serviceNameDetected = computed(
  () => detectedServiceFields.value.length > 0,
);

/** Currently selected field analytics mapping */
const selectedFieldAnalytics = computed(() => {
  if (!selectedField.value) return null;
  return dimensionAnalytics.value[selectedField.value.group_id] || null;
});

/** Columns are always rankedDims[1..n] — primary dim is shown in the title */
const popupColumns = computed<FoundGroup[]>(() => rankedDims.value.slice(1));

/** Returns the values to display in a given popup column, respecting upstream selections */
function getPopupColumnValues(colIndex: number): string[] {
  const col = popupColumns.value[colIndex];
  if (!col || !primaryDim.value) return [];

  if (colIndex === 0) {
    // Filter by primary value if selected
    if (popupPrimaryValue.value) {
      const analytics = dimensionAnalytics.value[primaryDim.value.group_id];
      return (
        analytics?.value_children?.[popupPrimaryValue.value]?.[col.group_id] ??
        []
      );
    }
    // No primary selected — union all secondary values
    const analytics = dimensionAnalytics.value[primaryDim.value.group_id];
    const all = new Set<string>();
    for (const children of Object.values(analytics?.value_children ?? {})) {
      for (const v of children[col.group_id] ?? []) all.add(v);
    }
    return [...all].sort();
  }

  const prevSelection = popupColumnSelections.value[colIndex - 1];
  const prevCol = popupColumns.value[colIndex - 1];
  const prevAnalytics = dimensionAnalytics.value[prevCol.group_id];

  if (!prevSelection) {
    const all = new Set<string>();
    for (const children of Object.values(prevAnalytics?.value_children ?? {})) {
      for (const v of children[col.group_id] ?? []) all.add(v);
    }
    return [...all].sort();
  }

  return prevAnalytics?.value_children?.[prevSelection]?.[col.group_id] ?? [];
}

function selectPopupColumnValue(colIndex: number, val: string) {
  const next = [...popupColumnSelections.value];
  // Toggle off if already selected
  next[colIndex] = next[colIndex] === val ? null : val;
  // Clear downstream selections
  for (let i = colIndex + 1; i < popupColumns.value.length; i++) next[i] = null;
  popupColumnSelections.value = next;
}

/** Calculate the total total number of services (used as denominator for coverage) */
const totalServices = computed(() => {
  const serviceDim = dimensionAnalytics.value["service"];
  if (serviceDim) return serviceDim.service_count;

  // Fallback: use the max service count across all dimensions
  let max = 0;
  for (const key in dimensionAnalytics.value) {
    if (dimensionAnalytics.value[key].service_count > max) {
      max = dimensionAnalytics.value[key].service_count;
    }
  }
  return max;
});

/**
 * Detect environment and suggest fields based on available data, driven by the
 * active environment tab.
 */
const detectedEnvironment = computed<DetectedEnvironment | null>(() => {
  if (!activeEnvironment.value) return null;

  const env = activeEnvironment.value;
  let envType = "General";
  let description = "General fields detected in your telemetry data.";
  let evidenceGroups: string[] = [];

  if (env === "kubernetes" || env === "k8s") {
    envType = "Kubernetes";
    description = "Kubernetes fields detected in your telemetry data.";
    evidenceGroups = activeEnvGroups.value
      .filter((g) => g.group_id.startsWith("k8s-"))
      .map((g) => g.group_id);
  } else if (env === "aws") {
    const isEcs = activeEnvGroups.value.some((g) =>
      g.group_id.startsWith("aws-ecs-"),
    );
    envType = isEcs ? "AWS ECS" : "AWS";
    description = `${envType} fields detected in your telemetry data.`;
    evidenceGroups = activeEnvGroups.value
      .filter((g) => g.group_id.startsWith("aws-"))
      .map((g) => g.group_id);
  } else if (env === "gcp") {
    envType = "GCP";
    description = "GCP fields detected in your telemetry data.";
    evidenceGroups = activeEnvGroups.value
      .filter((g) => g.group_id.startsWith("gcp-"))
      .map((g) => g.group_id);
  } else if (env === "azure") {
    envType = "Azure";
    description = "Azure fields detected in your telemetry data.";
    evidenceGroups = activeEnvGroups.value
      .filter((g) => g.group_id.startsWith("azure-"))
      .map((g) => g.group_id);
  }

  return {
    environment_type: envType,
    description: description,
    evidence_groups: evidenceGroups.slice(0, 3),
  };
});

/**
 * Detect environment and suggest fields based on available data, driven by the
 * active environment tab.
 */
const suggestedConfig = computed<SuggestedConfig | null>(() => {
  if (!activeEnvironment.value || suggestionDismissed.value) return null;

  const analytics = dimensionAnalytics.value;
  const envGroups = activeEnvGroups.value;

  if (envGroups.length === 0) return null;

  // Cardinality preference rank (lower = better for disambiguation)
  const CARD_RANK: Record<string, number> = {
    VeryLow: 1,
    Low: 2,
    Medium: 3,
    High: 4,
    VeryHigh: 5,
  };

  // Score each group in the active environment using actual analytics data
  const scored = envGroups
    .map((g) => {
      const a = analytics[g.group_id];
      // Prefer dimensionAnalytics cardinality_class; fall back to available_groups field
      const cardClass = a?.cardinality_class ?? g.cardinality_class ?? "Medium";
      const cardRank = CARD_RANK[cardClass] ?? 3;
      // Coverage = fraction of services that carry this field
      const coverage =
        a && totalServices.value > 0
          ? Math.round((a.service_count / totalServices.value) * 100)
          : g.recommended
            ? 100
            : 0;
      const streamCount = g.stream_types?.length ?? 0;
      return { id: g.group_id, cardRank, cardClass, coverage, streamCount };
    })
    // Exclude high-cardinality fields (they make bad disambiguation keys)
    .filter((s) => s.cardRank <= 3)
    // Prefer fields that appear across multiple stream types (more reliable for correlation)
    .sort((a, b) => {
      if (a.cardRank !== b.cardRank) return a.cardRank - b.cardRank;
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      return b.streamCount - a.streamCount;
    });

  if (scored.length === 0) return null;

  const suggested = scored.slice(0, 3).map((s) => s.id);

  // Build evidence string from actual numbers
  const top = scored.slice(0, suggested.length);
  const bestCard = top[0]?.cardClass ?? "";
  const minCoverage = Math.min(...top.map((s) => s.coverage));
  const allStreamTypes = [
    ...new Set(
      top.flatMap((s) => {
        const g = envGroups.find((g) => g.group_id === s.id);
        return g?.stream_types ?? [];
      }),
    ),
  ];

  const parts: string[] = [];
  if (bestCard) parts.push(`${bestCard} cardinality`);
  if (minCoverage > 0) parts.push(`${minCoverage}% coverage`);
  if (allStreamTypes.length > 1) {
    parts.push(
      `across ${allStreamTypes.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(", ")}`,
    );
  }

  return {
    distinguish_by: suggested,
    reason:
      parts.length > 0
        ? `${parts.join(" · ")} — ideal for service disambiguation`
        : "Recommended based on field coverage in your streams.",
  };
});

/**
 * Primary dimension for the active environment — the one with the lowest cardinality.
 * Cards are rendered once per unique value of this dimension.
 */
/**
 * Rank dimensions (f1, f2, f3) for the active environment.
 * Rank by cardinality (lowest first).
 */
const rankedDims = computed<FoundGroup[]>(() => {
  const groups = activeEnvGroups.value;
  if (!groups.length) return [];

  return [...groups].sort((a, b) => {
    // 1. Prefer dimensionAnalytics cardinality
    const aCard = dimensionAnalytics.value[a.group_id]?.cardinality;
    const bCard = dimensionAnalytics.value[b.group_id]?.cardinality;
    if (aCard !== undefined && bCard !== undefined) return aCard - bCard;

    // 2. Fallback to available_groups unique_values
    const aUV = a.unique_values ?? 999;
    const bUV = b.unique_values ?? 999;
    if (aUV !== bUV) return aUV - bUV;

    // 3. Fallback to cardinality_class heuristic
    const cardRank: Record<string, number> = {
      VeryLow: 1,
      Low: 2,
      Medium: 3,
      High: 4,
      VeryHigh: 5,
      Unknown: 6,
    };
    const aCR = cardRank[a.cardinality_class || "Unknown"] || 6;
    const bCR = cardRank[b.cardinality_class || "Unknown"] || 6;
    return aCR - bCR;
  });
});

const primaryDim = computed<FoundGroup | undefined>(() => rankedDims.value[0]);
const secondaryDim = computed<FoundGroup | undefined>(
  () => rankedDims.value[1],
);
const tertiaryDim = computed<FoundGroup | undefined>(() => rankedDims.value[2]);

/**
 * Hierarchy label, e.g. "K8S CLUSTER → K8S NAMESPACE → K8S DEPLOYMENT"
 */
const hierarchyLabel = computed<string | null>(() => {
  const p = primaryDim.value;
  const s = secondaryDim.value;
  const t = tertiaryDim.value;
  if (!p) return null;
  const pLabel = p.display.toUpperCase();
  if (!s) return pLabel;
  const sLabel = s.display.toUpperCase();
  if (!t) return `${pLabel} → ${sLabel}`;
  return `${pLabel} → ${sLabel} → ${t.display.toUpperCase()}`;
});

/**
 * One entry per unique value of the primary dim.
 * Each entry has childValues: the co-occurring values of the secondary dim.
 * Falls back to using available_groups cardinality_class/unique_values if analytics is empty.
 */
const primaryDimCards = computed<
  Record<
    string,
    { childValues: string[]; tertiaryValues: Record<string, string[]> }
  >
>(() => {
  const primary = primaryDim.value;
  if (!primary) return {};
  const analytics = dimensionAnalytics.value[primary.group_id];
  const secondary = secondaryDim.value;
  const tertiary = tertiaryDim.value;

  const result: Record<
    string,
    { childValues: string[]; tertiaryValues: Record<string, string[]> }
  > = {};

  // Find primary values to show as cards
  let primaryValues: string[] = [];
  if (
    analytics?.value_children &&
    Object.keys(analytics.value_children).length > 0
  ) {
    primaryValues = Object.keys(analytics.value_children);
  } else {
    primaryValues = getGroupValues(primary);
  }

  // If we found NO values, fall back to the display name as a single card (placeholder)
  if (primaryValues.length === 0) {
    result[primary.display] = { childValues: [], tertiaryValues: {} };
    return result;
  }

  // Sort cards by per-value coverage descending (most common value first)
  if (analytics?.value_counts) {
    const counts = analytics.value_counts;
    primaryValues = [...primaryValues].sort(
      (a, b) => (counts[b] ?? 0) - (counts[a] ?? 0),
    );
  }

  // Cap at 20 cards to prevent UI lag
  for (const val of primaryValues.slice(0, 20)) {
    const childMap = analytics?.value_children?.[val];
    const childValues = secondary
      ? (childMap?.[secondary.group_id] ?? []).slice().sort()
      : [];

    const tertiaryValues: Record<string, string[]> = {};
    if (tertiary && secondary) {
      for (const sVal of childValues) {
        const sAnalytics = dimensionAnalytics.value[secondary.group_id];
        if (sAnalytics?.value_children?.[sVal]) {
          tertiaryValues[sVal] = (
            sAnalytics.value_children[sVal][tertiary.group_id] ?? []
          )
            .slice()
            .sort();
        }
      }
    }
    result[val] = { childValues, tertiaryValues };
  }

  return result;
});

/** Default tracked alias options shown when analytics data is not yet loaded */
const DEFAULT_TRACKED_OPTIONS = [
  { label: "K8s Cluster", value: "k8s-cluster" },
  { label: "K8s Namespace", value: "k8s-namespace" },
  { label: "K8s Deployment", value: "k8s-deployment" },
  { label: "K8s StatefulSet", value: "k8s-statefulset" },
  { label: "K8s DaemonSet", value: "k8s-daemonset" },
  { label: "K8s Pod Name", value: "k8s-pod-name" },
  { label: "AWS ECS Cluster", value: "aws-ecs-cluster" },
  { label: "AWS ECS Task", value: "aws-ecs-task" },
  { label: "Cloud Account", value: "cloud-account" },
  { label: "Region", value: "region" },
  { label: "Environment", value: "environment" },
  { label: "Host", value: "host" },
  { label: "Service Namespace", value: "service-namespace" },
  { label: "Service Version", value: "service-version" },
];

/**
 * Options for the tracked field alias multi-select.
 * Uses available_groups from analytics when loaded; falls back to DEFAULT_TRACKED_OPTIONS.
 */
const trackedAliasOptions = computed(() => {
  const groups = availableGroups.value;
  if (groups.length > 0) {
    // Backend rejects "service" — it is always tracked implicitly
    return groups
      .filter((g: FoundGroup) => g.group_id !== "service")
      .map((g: FoundGroup) => ({
        label: g.display,
        value: g.group_id,
      }));
  }
  return DEFAULT_TRACKED_OPTIONS;
});

/**
 * Resolved list of tracked aliases with display labels.
 * All tracked alias IDs are included - if no label is found, uses a formatted version of the ID.
 */
const resolvedTrackedAliases = computed(() => {
  const allOptions = [...trackedAliasOptions.value, ...DEFAULT_TRACKED_OPTIONS];
  const labelMap = new Map(allOptions.map((o) => [o.value, o.label]));

  return [...trackedAliasIds.value]
    .map((id) => {
      let label = labelMap.get(id);
      if (!label) {
        // Fallback: convert ID to readable label (e.g., "k8s-cluster" → "K8s Cluster")
        label = id
          .split("-")
          .map(
            (part) =>
              part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
          )
          .join(" ");
        console.warn(
          `[ServiceIdentitySetup] No label found for tracked alias "${id}", using fallback: "${label}"`,
        );
      }
      return { id, label };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
});

/** Options for the tracked alias add-picker — excludes already-selected IDs */
const trackedAliasAddOptions = computed(() =>
  trackedAliasOptions.value.filter(
    (o) => !trackedAliasIds.value.includes(o.value),
  ),
);

function onAddTrackedAlias(value: unknown) {
  if (value && typeof value === "string" && !trackedAliasIds.value.includes(value)) {
    trackedAliasIds.value = [...trackedAliasIds.value, value];
  }
  addTrackedAliasValue.value = undefined;
  addingTrackedAlias.value = false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find a FoundGroup by its group_id value with case-insensitive and semantic-group fallbacks */
function getGroupByValue(value: string): FoundGroup | undefined {
  // First try exact match in analytics groups
  let group = availableGroups.value.find((g) => g.group_id === value);

  // If no exact match, try case-insensitive fallback
  if (!group) {
    const lowerValue = value.toLowerCase();
    group = availableGroups.value.find(
      (g) => g.group_id.toLowerCase() === lowerValue,
    );
  }

  // Fall back to semanticGroups prop for display name when not in analytics data
  if (!group && props.semanticGroups) {
    const alias = props.semanticGroups.find(
      (a) => a.id === value || a.id.toLowerCase() === value.toLowerCase(),
    );
    if (alias) {
      return {
        group_id: value,
        display: alias.display,
        stream_types: [],
        aliases: {},
        recommended: false,
      };
    }
  }

  return group;
}

/**
 * Deduplicate and consistently sort FoundGroups as frontend safety net.
 * Addresses user complaint: "it's changing order every single time"
 *
 * Deduplication: Keep first occurrence by group_id
 * Sorting: 1) Environment type, 2) Recommended first, 3) Alphabetical by group_id
 */
function deduplicateAndSortGroups(groups: FoundGroup[]): FoundGroup[] {
  if (!groups?.length) return [];

  // 1. Deduplicate by group_id (keep first occurrence)
  const seen = new Set<string>();
  const deduplicated = groups.filter((group) => {
    if (seen.has(group.group_id)) {
      return false; // Skip duplicate
    }
    seen.add(group.group_id);
    return true;
  });

  // 2. Sort consistently
  const envOrder: Record<string, number> = { k8s: 1, aws: 2, azure: 3, gcp: 4 };

  return deduplicated.sort((a, b) => {
    // Sort by environment type first
    const aEnv = groupEnvKey(a.group_id);
    const bEnv = groupEnvKey(b.group_id);
    const aEnvOrder = aEnv ? (envOrder[aEnv] ?? 999) : 999;
    const bEnvOrder = bEnv ? (envOrder[bEnv] ?? 999) : 999;

    if (aEnvOrder !== bEnvOrder) {
      return aEnvOrder - bEnvOrder;
    }

    // Within same environment, recommended groups first
    if (a.recommended !== b.recommended) {
      return b.recommended ? 1 : -1; // recommended first
    }

    // Finally, sort alphabetically by group_id for stable ordering
    return a.group_id.localeCompare(b.group_id);
  });
}

/**
 * Returns select options for the disambiguation row at `rowIndex`.
 * Excludes: the name_field, and any already-selected disambiguation groups
 * (except the one at the current row, which must remain selectable).
 */
function getDisambiguationOptions(rowIndex: number) {
  const alreadyUsed = new Set<string>([
    nameField,
    ...distinguishBy.value.filter((_, i) => i !== rowIndex),
  ]);
  return availableGroups.value
    .filter((g) => !alreadyUsed.has(g.group_id))
    .map((g) => ({
      label: g.display,
      value: g.group_id,
      streamTypes: g.stream_types,
      recommended: g.recommended,
    }));
}

/** Returns a color token for a stream type chip */
function streamTypeColor(streamType: string): string {
  const map: Record<string, string> = {
    logs: "blue",
    traces: "orange",
    metrics: "green",
  };
  return map[streamType] ?? "grey-7";
}

/** Simple pluralization helper for display labels */
function pluralize(val: string): string {
  if (!val) return "";
  if (val.toLowerCase().endsWith("y")) return val.slice(0, -1) + "ies";
  if (
    val.toLowerCase().endsWith("sh") ||
    val.toLowerCase().endsWith("ch") ||
    val.toLowerCase().endsWith("s")
  )
    return val + "es";
  return val + "s";
}

/** Returns a BadgeVariant token for a cardinality class */
function cardinalityColor(cardClass: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    VeryLow: "success",
    Low: "success",
    Medium: "warning",
    High: "error",
    VeryHigh: "error",
  };
  return map[cardClass] ?? "default";
}

/** Get the best available cardinality class for a group */
function getEffectiveCardinalityClass(group?: FoundGroup): string {
  if (!group) return "Unknown";
  return (
    dimensionAnalytics.value[group.group_id]?.cardinality_class ||
    group.cardinality_class ||
    "Unknown"
  );
}

/** Get which stream types a specific value was found in for a dimension group */
function getValueStreamTypes(groupId: string, value: string): string[] {
  const dim = dimensionAnalytics.value[groupId];
  if (!dim?.sample_values) return [];
  const foundIn: string[] = [];
  for (const [streamType, streamNames] of Object.entries(dim.sample_values)) {
    for (const vals of Object.values(streamNames)) {
      if (vals.includes(value)) {
        foundIn.push(streamType);
        break;
      }
    }
  }
  return foundIn;
}

/** Get detailed stream info: which stream type + which stream names contain this value */
function getValueStreamDetails(
  groupId: string,
  value: string,
): { streamType: string; streamNames: string[] }[] {
  const dim = dimensionAnalytics.value[groupId];
  if (!dim?.sample_values) return [];
  const result: { streamType: string; streamNames: string[] }[] = [];
  for (const [streamType, streams] of Object.entries(dim.sample_values)) {
    const names: string[] = [];
    for (const [streamName, vals] of Object.entries(streams)) {
      if (vals.includes(value)) names.push(streamName);
    }
    if (names.length > 0) {
      result.push({ streamType, streamNames: names.sort() });
    }
  }
  return result;
}

/** Get deduplicated unique values for a group across all stream types/names */
function getGroupValues(group: FoundGroup): string[] {
  const dim = dimensionAnalytics.value[group.group_id];
  if (!dim?.sample_values) return [];
  const all = new Set<string>();
  for (const typeMap of Object.values(dim.sample_values)) {
    for (const vals of Object.values(typeMap)) {
      for (const v of vals) all.add(v);
    }
  }
  return Array.from(all).sort();
}

/** Return coverage % for a group relative to total services, or null if unknown */
function getGroupCoverage(group: FoundGroup): number | null {
  const dim = dimensionAnalytics.value[group.group_id];
  if (!dim || !totalServices.value) return null;
  return Math.round((dim.service_count / totalServices.value) * 100);
}

/**
 * Per-value coverage: what fraction of THIS dimension's services carry this specific value.
 * e.g., getValueCoverage(k8s-cluster, "staging") → 70 means 70% of K8s services are in staging.
 * This is the "within-group" breakdown, not global coverage.
 */
function getValueCoverage(
  group: FoundGroup | undefined,
  value: string,
): number | null {
  if (!group) return null;
  const dim = dimensionAnalytics.value[group.group_id];
  if (!dim?.value_counts || !dim.service_count) return null;
  const count = dim.value_counts[value];
  if (count == null) return null;
  return Math.round((count / dim.service_count) * 100);
}

/** For a secondary dim value, collect all tertiary values across all primary parents */
function getSecondaryTertiaryValues(secondaryVal: string): string[] {
  const cards = primaryDimCards.value;
  const vals = new Set<string>();
  for (const card of Object.values(cards)) {
    const tVals = card.tertiaryValues[secondaryVal];
    if (tVals) {
      for (const v of tVals) vals.add(v);
    }
  }
  return Array.from(vals).sort();
}

/** For a tertiary dim value, find all cluster→namespace locations where it runs */
function getTertiaryLocations(
  tertiaryVal: string,
): { primary: string; secondary: string }[] {
  const cards = primaryDimCards.value;
  const locations: { primary: string; secondary: string }[] = [];
  for (const [pVal, card] of Object.entries(cards)) {
    for (const [sVal, tVals] of Object.entries(card.tertiaryValues)) {
      if (tVals.includes(tertiaryVal)) {
        locations.push({ primary: pVal, secondary: sVal });
      }
    }
  }
  return locations;
}

// ─── Field Management ─────────────────────────────────────────────────────────

/** Generate a unique group ID for a manually-added group */
function generateGroupId(): string {
  const existing = Object.keys(setDistinguishBy.value).filter((k) =>
    k.startsWith("custom-"),
  );
  const next = existing.length + 1;
  return `custom-${next}`;
}

/** Remove a field by its group_id from a specific env's distinguish_by */
function removeFieldByIdFromEnv(envKey: string, fieldId: string) {
  const current = setDistinguishBy.value[envKey] ?? [];
  setDistinguishBy.value = {
    ...setDistinguishBy.value,
    [envKey]: current.filter((id) => id !== fieldId),
  };
}

/** Tooltip text explaining why a field is good for disambiguation */
function getFieldCardinalityTooltip(fieldId: string): string | null {
  const dim = dimensionAnalytics.value[fieldId];
  const group = getGroupByValue(fieldId);
  const count = dim?.cardinality ?? group?.unique_values;
  const cardClass = dim?.cardinality_class ?? group?.cardinality_class;
  if (count == null) return null;
  const formatted = cardClass
    ? cardClass.replace(/([a-z])([A-Z])/g, "$1 $2")
    : "";
  const classLabel = formatted
    ? t("settings.serviceIdentitySetup.cardinalityClassLabel", {
        cardinality: formatted,
      })
    : "";
  return t("settings.serviceIdentitySetup.fieldCardinalityTooltip", {
    count,
    classLabel,
  });
}

/**
 * Whether the current fields are from auto-suggestion (no saved config existed).
 * We track this so we can show an inline hint only on first setup.
 */
const isAutoSuggested = computed(() => {
  return (
    !currentIdentityConfig.value?.sets?.length &&
    allConfiguredEnvs.value.length > 0
  );
});

/** Options for the inline "add field" select for a specific env */
function getAddFieldOptionsForEnv(envKey: string) {
  // Exclude fields already added in the current env AND all other envs
  const allUsedFields = Object.values(setDistinguishBy.value)
    .flat()
    .filter(Boolean);
  const used = new Set([nameField, ...allUsedFields]);
  return availableGroups.value
    .filter((g) => !used.has(g.group_id))
    .map((g) => {
      const dim = dimensionAnalytics.value[g.group_id];
      const cardClass = dim?.cardinality_class ?? g.cardinality_class ?? null;
      return {
        label: g.display,
        value: g.group_id,
        streamTypes: g.stream_types,
        subLabel: g.stream_types?.join(", ") || undefined,
        badge: g.recommended ? "recommended" : undefined,
        recommended: g.recommended,
        uniqueValues: dim?.cardinality ?? g.unique_values ?? null,
        cardinalityLabel: cardClass,
        cardinalityColor: cardClass ? cardinalityColor(cardClass) : "default",
      };
    });
}

/** Called when user picks a field in the inline select for a specific env */
function onAddFieldToEnv(envKey: string, val: unknown) {
  if (!val || typeof val !== "string") return;
  const current = setDistinguishBy.value[envKey] ?? [];
  setDistinguishBy.value = {
    ...setDistinguishBy.value,
    [envKey]: [...current.filter(Boolean), val],
  };
  addFieldValue.value = undefined;
  addingToEnv.value = "";
}

function applySuggestion() {
  if (suggestedConfig.value?.distinguish_by?.length) {
    distinguishBy.value = [...suggestedConfig.value.distinguish_by];
  }
  addingToEnv.value = "";
  suggestionDismissed.value = true;
  toast({
    variant: "success",
    message: t("settings.serviceIdentitySetup.recommendedConfigApplied"),
  });
}

function dismissSuggestion() {
  suggestionDismissed.value = true;
}

function updateDistinguishByField(idx: number, val: string) {
  const current = [...distinguishBy.value];
  current[idx] = val;
  distinguishBy.value = current;
}

function addDisambiguationField() {
  if (distinguishBy.value.length < 5) {
    const current = [...distinguishBy.value, ""];
    distinguishBy.value = current;
  }
}

function removeDisambiguationField(idx: number) {
  const current = [...distinguishBy.value];
  current.splice(idx, 1);
  distinguishBy.value = current;
}

function openFieldDetails(
  field: FoundGroup,
  streamType: string = "",
  value: string = "",
) {
  selectedField.value = field;
  selectedStreamType.value = streamType;
  activeStreamId.value = "";
  activeStreamType.value = streamType;
  preselectedValue.value = value;
  popupPrimaryValue.value = "";
  popupColumnSelections.value = [];

  // Determine clicked field's position in the hierarchy and pre-select accordingly
  if (value && primaryDim.value) {
    const fieldIdx = rankedDims.value.findIndex(
      (d) => d.group_id === field.group_id,
    );
    if (fieldIdx === 0) {
      // Clicked on primary dim (e.g. cluster) — set as primary value
      popupPrimaryValue.value = value;
    } else if (fieldIdx > 0) {
      // Clicked on secondary/tertiary — pre-select in the matching column (fieldIdx - 1)
      const selections: (string | null)[] = new Array(
        rankedDims.value.length - 1,
      ).fill(null);
      selections[fieldIdx - 1] = value;
      popupColumnSelections.value = selections;
    }
  }

  // Auto-select a stream — prefer one that contains the preselected value
  if (selectedFieldAnalytics.value?.sample_values) {
    const sampleValues = selectedFieldAnalytics.value.sample_values;
    const types = Object.keys(sampleValues);
    const typeToUse =
      streamType && types.includes(streamType) ? streamType : types[0];

    if (typeToUse) {
      activeStreamType.value = typeToUse;
      const streamEntries = Object.entries(sampleValues[typeToUse] ?? {});

      // If a specific value was clicked, prefer the stream that contains it
      const matchingStream = value
        ? streamEntries.find(([, vals]) => vals.includes(value))
        : null;

      const streamName = matchingStream
        ? matchingStream[0]
        : (streamEntries[0]?.[0] ?? "");

      activeStreamId.value = streamName;
    }
  }

  detailsDialogVisible.value = true;

  // Scroll the highlighted value into view after the dialog renders
  if (value) {
    nextTick(() => {
      const el = valuesScrollContainer.value?.querySelector(
        `[data-val="${CSS.escape(value)}"]`,
      );
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
}

/** True when current setDistinguishBy or trackedAliasIds differ from last saved config */
const isDirty = computed(() => {
  const saved = currentIdentityConfig.value;

  // Compare trackedAliasIds (order-insensitive)
  const savedTracked = [...(saved?.tracked_alias_ids ?? [])].sort();
  const currentTracked = [...trackedAliasIds.value].sort();
  if (savedTracked.length !== currentTracked.length) return true;
  if (savedTracked.some((id, i) => id !== currentTracked[i])) return true;

  // Compare service_optional flag
  if ((saved?.service_optional ?? false) !== serviceOptional.value) return true;

  // Compare setDistinguishBy against saved sets
  const savedSets: Record<string, string[]> = {};
  for (const set of saved?.sets ?? []) {
    savedSets[set.id] = set.distinguish_by.filter(Boolean);
  }
  const currentSets = setDistinguishBy.value;

  const allIds = new Set([
    ...Object.keys(savedSets),
    ...Object.keys(currentSets),
  ]);
  for (const id of allIds) {
    const savedFields = savedSets[id] ?? [];
    const currentFields = (currentSets[id] ?? []).filter(Boolean);
    if (savedFields.length !== currentFields.length) return true;
    if (savedFields.some((f, i) => f !== currentFields[i])) return true;
  }

  return false;
});

// ─── API Calls ────────────────────────────────────────────────────────────────

async function loadData() {
  loading.value = true;
  try {
    // 1. Load Analytics (which now includes available_groups)
    const analyticsRes = await serviceStreamsService.getDimensionAnalytics(
      props.orgIdentifier,
    );
    const summary: DimensionAnalyticsSummary = analyticsRes.data;

    // Apply frontend deduplication and consistent sorting as safety net
    const rawGroups = summary.available_groups ?? [];
    const dedupedGroups = deduplicateAndSortGroups(rawGroups);
    availableGroups.value = dedupedGroups;
    serviceFieldSources.value = summary.service_field_sources ?? [];

    if (summary.dimensions) {
      dimensionAnalytics.value = summary.dimensions.reduce(
        (acc, dim) => {
          acc[dim.dimension_name] = dim;
          return acc;
        },
        {} as Record<string, DimensionAnalytics>,
      );
    }

    // 2. Load Current Config
    const configRes = await serviceStreamsService.getIdentityConfig(
      props.orgIdentifier,
    );
    currentIdentityConfig.value = configRes.data;

    // Populate per-set distinguish_by and labels from the loaded config
    if (currentIdentityConfig.value?.sets?.length) {
      const byId: Record<string, string[]> = {};
      const labels: Record<string, string> = {};
      for (const set of currentIdentityConfig.value.sets) {
        byId[set.id] = [...set.distinguish_by];
        labels[set.id] = set.label; // Store API-provided label
      }
      setDistinguishBy.value = byId;
      setLabels.value = labels;
    }

    // Populate tracked alias IDs from loaded config
    trackedAliasIds.value =
      currentIdentityConfig.value?.tracked_alias_ids ?? [];

    // Populate service_optional flag from loaded config (defaults to false)
    serviceOptional.value =
      currentIdentityConfig.value?.service_optional ?? false;

    // 3. Initial suggestion for active env if no config exists for it
    // Guard: skip if activeEnvironment is the placeholder "all" key (set before real config loads)
    const realSetIds = new Set(
      (currentIdentityConfig.value?.sets ?? []).map((s) => s.id),
    );
    if (
      activeEnvironment.value &&
      activeEnvironment.value !== "all" &&
      realSetIds.has(activeEnvironment.value) &&
      !setDistinguishBy.value[activeEnvironment.value]?.length &&
      suggestedConfig.value?.distinguish_by?.length
    ) {
      setDistinguishBy.value[activeEnvironment.value] = [
        ...suggestedConfig.value.distinguish_by,
      ];
    }
  } catch (err: any) {
    console.error("Failed to load workload detection data:", err);
    toast({
      variant: "error",
      message: t("settings.correlation.loadRecommendationsFailed"),
    });
  } finally {
    loading.value = false;
  }
}

async function loadAnalytics() {
  try {
    const res = await serviceStreamsService.getDimensionAnalytics(
      props.orgIdentifier,
    );
    const summary: DimensionAnalyticsSummary = res.data;
    if (summary.dimensions) {
      dimensionAnalytics.value = summary.dimensions.reduce(
        (acc, dim) => {
          acc[dim.dimension_name] = dim;
          return acc;
        },
        {} as Record<string, DimensionAnalytics>,
      );
    }
  } catch (err) {
    console.error("Failed to load dimension analytics:", err);
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    // Build sets array: include only sets that have at least 1 non-empty distinguish_by field.
    // Preserve API-provided labels from loaded config, fall back to ID itself for new sets.
    // Filter out invalid IDs like "all" that can cause duplication issues.
    const sets: IdentitySet[] = Object.entries(setDistinguishBy.value)
      .filter(
        ([id, fields]) =>
          id !== "all" && id !== "" && fields.filter(Boolean).length > 0,
      )
      .map(([id, fields]) => ({
        id,
        label: setLabels.value[id] ?? id,
        distinguish_by: fields.filter(Boolean),
      }));

    if (sets.length === 0) {
      toast({
        variant: "warning",
        message: t(
          "settings.correlation.identityConfigNoSets",
          "Configure at least one identity set before saving.",
        ),
      });
      return;
    }

    if (trackedAliasIds.value.length === 0) {
      toast({
        variant: "warning",
        message: t("settings.serviceIdentitySetup.selectAtLeastOneTrackedAlias"),
      });
      return;
    }

    // "service" is always tracked implicitly by the backend; strip it to avoid 400.
    // Also drop orphan ids that no longer correspond to any known group (e.g. the
    // group was deleted from Field Mappings after being added to tracked aliases).
    const knownGroupIds = new Set([
      ...availableGroups.value.map((g) => g.group_id),
      ...trackedAliasOptions.value.map((o) => o.value),
    ]);
    const sanitizedTrackedAliasIds = trackedAliasIds.value.filter(
      (id) => id !== "service" && knownGroupIds.has(id),
    );
    const payload: ServiceIdentityConfig = {
      sets,
      tracked_alias_ids: sanitizedTrackedAliasIds,
      service_optional: serviceOptional.value,
    };

    await serviceStreamsService.saveIdentityConfig(
      props.orgIdentifier,
      payload,
    );

    // Invalidate the shared identity-config cache so other parts of the app
    // (logs/traces correlation) pick up the new config immediately instead of
    // waiting up to 5 minutes for the TTL to expire.
    clearIdentityConfigCache(props.orgIdentifier);

    // Sync baseline so isDirty resets to false
    currentIdentityConfig.value = payload;

    toast({
      variant: "success",
      message: t("settings.correlation.identityConfigSaved"),
    });
  } catch (err: any) {
    toast({
      variant: "error",
      message:
        err?.response?.data?.message ||
        err?.message ||
        t("settings.correlation.identityConfigSaveFailed"),
    });
  } finally {
    saving.value = false;
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  loadData();
});
</script>
