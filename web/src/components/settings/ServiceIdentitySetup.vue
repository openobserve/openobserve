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
  <div
    class="tw:w-full service-identity-setup q-mt-sm"
    :class="{ 'sis-dark': store.state.theme === 'dark' }"
  >
    <!-- Loading skeleton while fetching recommendations -->
    <div v-if="loading" class="tw:flex tw:flex-col tw:gap-4 tw:py-4">
      <OSkeleton class="tw:rounded-lg tw:h-14 tw:w-full" />
      <OSkeleton class="tw:rounded-lg tw:h-14 tw:w-full" />
      <OSkeleton class="tw:rounded-lg tw:h-10 tw:w-40" />
    </div>

    <div v-else>
      <!-- Section 1: Service Configuration -->
      <div
        class="tw:mb-3 tw:rounded-lg tw:overflow-hidden"
        style="border: 1px solid var(--o2-border-color)"
      >
        <div class="tw:p-3 tw:flex tw:flex-col tw:gap-3">
          <!-- Service name source banner -->
          <div
            v-if="!serviceOptional"
            class="tw:rounded-lg tw:border tw:overflow-hidden tw:transition-all"
            :class="
              serviceNameDetected
                ? store.state.theme === 'dark'
                  ? 'tw:bg-sky-900/10 tw:border-sky-300/30'
                  : 'tw:bg-sky-50/80 tw:border-sky-200'
                : store.state.theme === 'dark'
                  ? 'tw:bg-amber-900/10 tw:border-amber-800/30'
                  : 'tw:bg-amber-50/80 tw:border-amber-200'
            "
          >
            <!-- Collapsed row -->
            <div
              class="tw:flex tw:items-center tw:gap-2.5 tw:px-3 tw:py-2 tw:cursor-pointer hover:tw:opacity-80 tw:transition-opacity"
              @click="serviceNameExpanded = !serviceNameExpanded"
            >
              <OIcon
                :name="serviceNameDetected ? 'check-circle' : 'warning'"
                size="18px"
                :color="serviceNameDetected ? 'positive' : undefined"
                :class="serviceNameDetected ? '' : 'tw:text-amber-500'"
              />
              <div class="tw:flex-1 tw:min-w-0 tw:text-[13px] tw:leading-tight">
                <template v-if="serviceNameDetected">
                  Service name detected from
                  <span class="tw:font-bold tw:text-primary">Service</span>
                  field alias
                  <span class="tw:text-xs tw:opacity-60"
                    >({{
                      detectedServiceFields.length + unseenServiceFields.length
                    }})</span
                  >
                </template>
                <template v-else>
                  <span class="tw:font-semibold">{{
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
                size="18px"
                class="tw:opacity-40 tw:shrink-0"
              />
            </div>

            <!-- Expanded detail -->
            <div
              v-if="serviceNameExpanded"
              class="tw:px-3 tw:pb-3 tw:pt-2 tw:border-t"
              :class="
                serviceNameDetected
                  ? store.state.theme === 'dark'
                    ? 'tw:border-sky-300/30'
                    : 'tw:border-sky-200'
                  : store.state.theme === 'dark'
                    ? 'tw:border-amber-800/30'
                    : 'tw:border-amber-200'
              "
            >
              <!-- Inner card -->
              <div
                class="tw:rounded-lg tw:p-2.5"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:bg-grey-9/60'
                    : 'tw:bg-grey-1'
                "
              >
                <div
                  class="tw:text-xs tw:font-medium tw:mb-2"
                  :class="
                    store.state.theme === 'dark'
                      ? 'tw:text-grey-4'
                      : 'tw:text-grey-7'
                  "
                >
                  {{ t("settings.correlation.serviceNameExpandedHelp") }}
                </div>

                <!-- Field pills -->
                <div class="tw:flex tw:flex-wrap tw:gap-1.5 tw:mb-3">
                  <!-- Detected fields (with stream type dots) -->
                  <div
                    v-for="field in detectedServiceFields"
                    :key="field.name"
                    class="tw:inline-flex tw:items-center tw:gap-1.5 tw:px-2.5 tw:py-1 tw:rounded-md tw:font-mono tw:text-xs tw:font-medium"
                    style="border: 1px solid var(--o2-border-color)"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:bg-grey-8 tw:text-grey-2'
                        : 'tw:bg-white tw:text-grey-8 tw:shadow-sm'
                    "
                  >
                    <div class="tw:flex tw:items-center tw:gap-0.5 tw:mr-0.5">
                      <span
                        v-for="st in field.streamTypes"
                        :key="st"
                        class="tw:w-1.5 tw:h-1.5 tw:rounded-full"
                        :class="{
                          'tw:bg-blue-500': st === 'logs',
                          'tw:bg-orange-500': st === 'traces',
                          'tw:bg-green-500': st === 'metrics',
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
                    class="tw:inline-flex tw:items-center tw:px-2.5 tw:py-1 tw:rounded-md tw:border-dashed tw:font-mono tw:text-xs"
                    style="border: 1px dashed var(--o2-border-color)"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:text-grey-6'
                        : 'tw:text-grey-5'
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
                  class="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2"
                >
                  <div
                    class="tw:flex tw:flex-wrap tw:items-center tw:gap-3 tw:text-[10px]"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:text-grey-5'
                        : 'tw:text-grey-6'
                    "
                  >
                    <div class="tw:flex tw:items-center tw:gap-1">
                      <span
                        class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-blue-500"
                      />
                      {{ t("settings.correlation.foundInLogs") }}
                    </div>
                    <div class="tw:flex tw:items-center tw:gap-1">
                      <span
                        class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-orange-500"
                      />
                      {{ t("settings.correlation.foundInTraces") }}
                    </div>
                    <div class="tw:flex tw:items-center tw:gap-1">
                      <span
                        class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-green-500"
                      />
                      {{ t("settings.correlation.foundInMetrics") }}
                    </div>
                    <div
                      v-if="unseenServiceFields.length > 0"
                      class="tw:flex tw:items-center tw:gap-1"
                    >
                      <span
                        class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:border tw:border-dashed tw:border-grey-4"
                      />
                      {{
                        t("settings.correlation.serviceNameConfiguredNotSeen")
                      }}
                    </div>
                  </div>

                  <!-- Customize link -->
                  <a
                    class="config-link-btn tw:cursor-pointer tw:inline-flex tw:items-center tw:gap-1 tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold tw:no-underline"
                    @click.prevent="emit('navigate-to-aliases', 'service')"
                  >
                    {{ t("settings.correlation.customizeFieldMappings") }}
                  </a>
                </div>
              </div>
            </div>
          </div>

          <!-- Field Mapping Dialog -->
          <ODialog data-test="service-identity-setup-field-mapping-dialog"
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
            <TagInput
              :model-value="editableServiceFields"
              @update:model-value="editableServiceFields = $event"
              :placeholder="
                t('settings.correlation.fieldMappingPlaceholder')
              "
              label=""
            />
          </ODialog>

          <!-- Service Optional toggle -->
          <div data-test="service-identity-service-optional" class="tw:mb-3">
            <q-toggle
              data-test="service-identity-service-optional-btn"
              v-model="serviceOptional"
              :label="t('settings.correlation.serviceOptionalLabel')"
              size="sm"
              dense
              class="tw:text-[13px] tw:font-semibold"
            />
            <div
              class="tw:text-xs tw:mt-1 tw:leading-snug tw:ml-9"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:text-grey-5'
                  : 'tw:text-grey-6'
              "
            >
              {{ t("settings.correlation.serviceOptionalHelp") }}
            </div>
          </div>

          <!-- Disambiguation Fields -->
          <div>
            <div class="tw:flex tw:items-center tw:gap-2 tw:mb-1">
              <span class="tw:font-bold tw:text-sm">{{
                t("settings.correlation.distinguishByLabel")
              }}</span>
              <span class="tw:flex-1"><q-separator /></span>
            </div>
            <div
              class="tw:text-xs tw:mb-3"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:text-grey-5'
                  : 'tw:text-grey-6'
              "
            >
              {{ t("settings.correlation.distinguishByHelp") }}
            </div>

            <!-- Empty state: nothing configured anywhere -->
            <div
              v-if="allConfiguredEnvs.length === 0 && !addingToEnv"
              class="tw:flex tw:flex-col tw:items-center tw:gap-2 tw:py-3 tw:px-4 tw:rounded-md tw:border tw:border-dashed"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:border-grey-7 tw:bg-grey-9/40'
                  : 'tw:border-grey-4 tw:bg-grey-1'
              "
            >
              <OIcon name="tune" size="28px" class="tw:text-grey-5 tw:mb-1" />
              <span
                class="tw:text-sm tw:font-medium"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:text-grey-4'
                    : 'tw:text-grey-7'
                "
              >
                No fields configured yet
              </span>
              <OButton
                variant="outline"
                size="sm"
                class="tw:mt-1"
                data-test="service-identity-add-distinguish-btn"
                @click="addingToEnv = activeEnvironment"
              >
                <template #icon-left
                  ><OIcon name="add" size="xs"
                /></template>
                {{ t("settings.correlation.addField") }}
              </OButton>
            </div>

            <!-- All configured env groups -->
            <div v-else class="tw:flex tw:flex-col tw:gap-2">
              <!-- Auto-suggested banner (only when fields came from suggestion, not saved config) -->
              <div
                v-if="isAutoSuggested"
                class="tw:flex tw:items-start tw:gap-2 tw:px-3 tw:py-2 tw:rounded-md tw:text-xs"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:bg-blue-900/15 tw:text-blue-300'
                    : 'tw:bg-blue-50 tw:text-blue-700'
                "
              >
                <OIcon
                  name="auto-awesome"
                  size="xs"
                  class="tw:shrink-0 tw:mt-0.5"
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
                  class="tw:flex tw:items-center tw:gap-2 tw:mt-1"
                  :class="{ 'tw:pt-2 tw:border-t': envIdx > 0 }"
                >
                  <span
                    class="tw:text-[10px] tw:font-bold"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:text-grey-5'
                        : 'tw:text-grey-6'
                    "
                  >
                    {{ getIdentitySetLabel(envKey) }}
                  </span>
                </div>

                <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  <!-- Pills for this env's fields -->
                  <div
                    v-for="fieldId in (setDistinguishBy[envKey] ?? []).filter(
                      Boolean,
                    )"
                    :key="fieldId"
                    class="tw:flex tw:items-center tw:gap-1 tw:pl-3 tw:pr-1 tw:py-1 tw:rounded-md tw:text-xs tw:font-medium tw:transition-colors"
                    style="border: 1px solid var(--o2-border-color)"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:bg-grey-9 tw:text-grey-2 tw:shadow-sm'
                        : 'tw:bg-white tw:text-grey-8 tw:shadow-sm'
                    "
                  >
                    <span>{{
                      getGroupByValue(fieldId)?.display ?? fieldId
                    }}</span>
                    <q-tooltip
                      v-if="getFieldCardinalityTooltip(fieldId)"
                      anchor="top middle"
                      self="bottom middle"
                      class="tw:text-xs"
                    >
                      {{ getFieldCardinalityTooltip(fieldId) }}
                    </q-tooltip>
                    <OButton
                      variant="ghost"
                      size="icon-xs-sq"
                      @click="removeFieldByIdFromEnv(envKey, fieldId)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </OButton>
                  </div>

                  <!-- Inline add select for this group -->
                  <template v-if="addingToEnv === envKey">
                    <q-select
                      ref="addFieldSelectRef"
                      v-model="addFieldValue"
                      :options="getAddFieldOptionsForEnv(envKey)"
                      option-label="label"
                      option-value="value"
                      emit-value
                      map-options
                      use-input
                      input-debounce="0"
                      dense
                      borderless
                      :placeholder="t('settings.correlation.selectField')"
                      style="min-width: 220px"
                      data-test="service-identity-add-distinguish-btn"
                      @filter="onAddFieldFilter"
                      @update:model-value="onAddFieldToEnv(envKey, $event)"
                    >
                      <template #option="scope">
                        <q-item v-bind="scope.itemProps">
                          <q-item-section>
                            <q-item-label
                              class="tw:flex tw:items-center tw:gap-2"
                            >
                              {{ scope.opt.label }}
                              <q-badge
                                v-if="scope.opt.cardinalityLabel"
                                :color="scope.opt.cardinalityColor"
                                outline
                                :label="scope.opt.cardinalityLabel"
                                class="tw:text-[10px]"
                              />
                              <q-badge
                                v-if="scope.opt.recommended"
                                color="positive"
                                outline
                                label="recommended"
                                class="tw:text-[10px]"
                              />
                            </q-item-label>
                            <q-item-label
                              caption
                              class="tw:flex tw:items-center tw:gap-2"
                            >
                              <span v-if="scope.opt.uniqueValues"
                                >{{ scope.opt.uniqueValues }} unique
                                values</span
                              >
                              <span v-if="scope.opt.streamTypes">{{
                                scope.opt.streamTypes.join(", ")
                              }}</span>
                            </q-item-label>
                          </q-item-section>
                        </q-item>
                      </template>
                    </q-select>
                    <OButton
                      variant="ghost"
                      size="icon-xs-sq"
                      @click="
                        addingToEnv = '';
                        addFieldValue = '';
                      "
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
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
                    <q-tooltip
                      anchor="top middle"
                      self="bottom middle"
                      class="tw:text-xs tw:max-w-[240px]"
                    >
                      {{ t("settings.correlation.addFieldTooltip") }}
                    </q-tooltip>
                  </OButton>
                </div>
              </template>

              <!-- Adding to a new env (not yet in the list) -->
              <template
                v-if="addingToEnv && !allConfiguredEnvs.includes(addingToEnv)"
              >
                <div
                  class="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:pt-2"
                  style="border-top: 1px solid var(--o2-border-color)"
                >
                  <q-select
                    ref="addFieldSelectRef"
                    v-model="addFieldValue"
                    :options="getAddFieldOptionsForEnv(addingToEnv)"
                    option-label="label"
                    option-value="value"
                    emit-value
                    map-options
                    use-input
                    input-debounce="0"
                    dense
                    borderless
                    :placeholder="t('settings.correlation.selectField')"
                    style="min-width: 220px"
                    data-test="service-identity-add-distinguish-btn"
                    @filter="onAddFieldFilter"
                    @update:model-value="onAddFieldToEnv(addingToEnv, $event)"
                  >
                    <template #option="scope">
                      <q-item v-bind="scope.itemProps">
                        <q-item-section>
                          <q-item-label
                            class="tw:flex tw:items-center tw:gap-2"
                          >
                            {{ scope.opt.label }}
                            <q-badge
                              v-if="scope.opt.cardinalityLabel"
                              :color="scope.opt.cardinalityColor"
                              outline
                              :label="scope.opt.cardinalityLabel"
                              class="tw:text-[10px]"
                            />
                            <q-badge
                              v-if="scope.opt.recommended"
                              color="positive"
                              outline
                              label="recommended"
                              class="tw:text-[10px]"
                            />
                          </q-item-label>
                          <q-item-label
                            caption
                            class="tw:flex tw:items-center tw:gap-2"
                          >
                            <span v-if="scope.opt.uniqueValues"
                              >{{ scope.opt.uniqueValues }} unique values</span
                            >
                            <span v-if="scope.opt.streamTypes">{{
                              scope.opt.streamTypes.join(", ")
                            }}</span>
                          </q-item-label>
                        </q-item-section>
                      </q-item>
                    </template>
                  </q-select>
                  <OButton
                    variant="ghost"
                    size="icon-xs-sq"
                    @click="
                      addingToEnv = '';
                      addFieldValue = '';
                    "
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </OButton>
                </div>
              </template>

              <!-- Add group + Save — bottom row -->
              <div
                v-if="!addingToEnv"
                class="tw:flex tw:items-center tw:justify-between tw:mt-2"
              >
                <OButton
                  variant="outline"
                  size="sm"
                  @click="addingToEnv = generateGroupId()"
                  icon-left="add"
                >
                  {{ t("settings.correlation.addGroup") }}
                  <q-tooltip
                    anchor="top middle"
                    self="bottom middle"
                    class="tw:text-xs tw:max-w-[240px]"
                  >
                    {{ t("settings.correlation.addGroupTooltip") }}
                  </q-tooltip>
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
        class="tw:mb-3 tw:rounded-lg tw:overflow-hidden"
        style="border: 1px solid var(--o2-border-color)"
      >
        <!-- Section header -->
        <div
          class="tw:px-4 tw:py-3 tw:flex tw:items-center tw:gap-2"
          style="border-bottom: 1px solid var(--o2-border-color)"
        >
          <OIcon name="radar" size="sm" class="tw:text-teal-6" />
          <span class="tw:font-bold tw:text-sm">Workload Detection</span>
        </div>

        <!-- Collapsible: Workload detected using fields (N) -->
        <div
          class="tw:mx-3 tw:mt-3 tw:rounded-lg tw:border tw:overflow-hidden tw:transition-all"
          :class="
            store.state.theme === 'dark'
              ? 'tw:bg-sky-900/10 tw:border-sky-300/30'
              : 'tw:bg-sky-50/80 tw:border-sky-200'
          "
        >
          <div
            class="tw:flex tw:items-center tw:gap-2.5 tw:px-3 tw:py-2 tw:cursor-pointer hover:tw:opacity-80 tw:transition-opacity"
            @click="trackedAliasExpanded = !trackedAliasExpanded"
          >
            <OIcon name="check-circle" size="sm" />
            <div class="tw:flex-1 tw:min-w-0 tw:text-[13px] tw:leading-tight">
              Workload detected using fields
              <span class="tw:text-xs tw:opacity-60"
                >({{ trackedAliasIds.length }})</span
              >
            </div>
            <OIcon
              :name="
                trackedAliasExpanded
                  ? 'keyboard-arrow-up'
                  : 'keyboard-arrow-down'
              "
              size="18px"
              class="tw:opacity-40 tw:shrink-0"
            />
          </div>

          <div
            v-if="trackedAliasExpanded"
            class="tw:px-3 tw:pb-3 tw:pt-2 tw:border-t"
            :class="
              store.state.theme === 'dark'
                ? 'tw:border-sky-300/30'
                : 'tw:border-sky-200'
            "
          >
            <div
              class="tw:rounded-lg tw:p-2.5"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:bg-grey-9/60'
                  : 'tw:bg-grey-1'
              "
            >
              <div
                class="tw:text-xs tw:mb-3"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:text-grey-5'
                    : 'tw:text-grey-6'
                "
              >
                Only these field alias groups are used for workload detection
                and recommendations. Fields not in this list will not influence
                service discovery results. Cannot be empty.
                <a
                  class="config-link-btn tw:cursor-pointer tw:inline-block tw:mx-1 tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold tw:no-underline tw:align-middle"
                  @click.prevent="emit('navigate-to-aliases', 'service')"
                  >Go to Field Aliases</a
                >
                to configure individual field mappings.
              </div>
              <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                <!-- Pills for tracked aliases -->
                <div
                  v-for="alias in resolvedTrackedAliases"
                  :key="alias.id"
                  class="tw:flex tw:items-center tw:gap-1 tw:pl-3 tw:pr-1 tw:py-1 tw:rounded-md tw:text-xs tw:font-medium tw:transition-colors"
                  style="border: 1px solid var(--o2-border-color)"
                  :class="
                    store.state.theme === 'dark'
                      ? 'tw:bg-grey-9 tw:text-grey-2 tw:shadow-sm'
                      : 'tw:bg-white tw:text-grey-8 tw:shadow-sm'
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </OButton>
                </div>
                <!-- Inline add select -->
                <template v-if="addingTrackedAlias">
                  <q-select
                    ref="addTrackedAliasSelectRef"
                    v-model="addTrackedAliasValue"
                    :options="trackedAliasAddOptions"
                    option-label="label"
                    option-value="value"
                    emit-value
                    map-options
                    use-input
                    input-debounce="0"
                    dense
                    borderless
                    placeholder="Select alias group"
                    style="min-width: 220px"
                    @update:model-value="onAddTrackedAlias($event)"
                  />
                  <OButton
                    variant="ghost"
                    size="icon-xs-sq"
                    @click="
                      addingTrackedAlias = false;
                      addTrackedAliasValue = '';
                    "
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
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
                  Add field
                </OButton>
              </div>
              <div class="tw:flex tw:justify-end tw:mt-3">
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

        <div class="tw:px-4 tw:pt-3 tw:pb-1">
          <div
            class="tw:text-xs"
            :class="
              store.state.theme === 'dark' ? 'tw:text-grey-5' : 'tw:text-grey-6'
            "
          >
            We discovered these deployment patterns in your streams. Use them to
            configure service correlation.
            <a
              class="config-link-btn tw:cursor-pointer tw:inline-block tw:mx-1 tw:px-2 tw:py-0.5 tw:rounded tw:text-xs tw:font-semibold tw:no-underline tw:align-middle"
              @click.prevent="emit('navigate-to-services')"
              >Go to Services</a
            >
            <span>to see the actual discovered services.</span>
          </div>
        </div>

        <!-- Environment Tabs (Chrome-style) -->
        <div
          class="tw:flex tw:items-end tw:gap-0 tw:px-4"
          style="border-bottom: 1px solid var(--o2-border-color)"
        >
          <div
            v-for="env in detectedEnvironments"
            :key="env.key"
            class="tw:relative tw:px-4 tw:py-2 tw:cursor-pointer tw:transition-all tw:text-xs tw:font-medium tw:min-w-[70px] tw:text-center tw:rounded-t-lg tw:border tw:border-b-0"
            :class="
              activeEnvironment === env.key
                ? store.state.theme === 'dark'
                  ? 'tw:text-grey-1'
                  : 'tw:text-grey-9'
                : store.state.theme === 'dark'
                  ? 'tw:bg-transparent tw:text-grey-5 tw:border-transparent hover:tw:text-grey-3'
                  : 'tw:bg-transparent tw:text-grey-5 tw:border-transparent hover:tw:text-grey-7'
            "
            :style="
              activeEnvironment === env.key
                ? 'margin-bottom: -1px; padding-bottom: 9px; background-color: var(--o2-card-bg-solid); border-color: var(--o2-border-color);'
                : ''
            "
            @click="activeEnvironment = env.key"
          >
            {{ env.label }}
            <span
              v-if="
                (setDistinguishBy[env.key] ?? []).filter(Boolean).length > 0
              "
              class="tw:absolute tw:top-1 tw:right-1 tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-positive"
              :title="`${(setDistinguishBy[env.key] ?? []).filter(Boolean).length} field(s) configured`"
            />
          </div>
        </div>

        <!-- Tab content panel — connects to active tab -->
        <div
          v-if="primaryDim"
          class="tw:overflow-hidden tw:px-4 tw:pt-4 tw:pb-2"
        >
          <!-- Stat cards -->
          <div class="tw:flex tw:items-stretch tw:gap-3">
            <template v-for="(card, idx) in dimCards" :key="card.dim.group_id">
              <!-- Plus connector between cards -->
              <div v-if="idx > 0" class="tw:flex tw:items-center tw:shrink-0">
                <OIcon name="add" size="sm" class="tw:text-grey-5" />
              </div>

              <!-- Dim card -->
              <div
                class="dim-stat-card tw:flex-1 tw:min-w-0 tw:rounded-lg tw:p-3"
                :style="
                  store.state.theme === 'dark'
                    ? card.theme.borderDark
                    : card.theme.borderLight
                "
              >
                <div class="tw:flex tw:items-center tw:gap-2 tw:mb-2">
                  <OIcon
                    :name="card.theme.icon"
                    size="14px"
                    :class="card.theme.iconClass"
                  />
                  <span
                    class="tw:text-[11px] tw:font-medium"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:text-grey-4'
                        : 'tw:text-grey-6'
                    "
                    >{{ card.label }}</span
                  >
                  <span
                    class="tw:text-lg tw:font-bold tw:ml-auto"
                    :class="card.theme.countClass"
                    >{{ card.count }}</span
                  >
                </div>
                <div class="dim-stat-pills tw:flex tw:flex-wrap tw:gap-1">
                  <span
                    v-for="val in card.values.slice(0, 5)"
                    :key="val"
                    class="dim-stat-pill tw:text-[11px] tw:py-0.5 tw:px-2 tw:rounded-full tw:border tw:cursor-pointer hover:tw:opacity-70 tw:transition-opacity tw:inline-flex tw:items-center tw:gap-1"
                    :class="
                      store.state.theme === 'dark'
                        ? card.theme.pillDark
                        : card.theme.pillLight
                    "
                    :title="val"
                    @click.stop="openInsightDialogByIdx(val, idx)"
                    ><span class="tw:truncate">{{ val }}</span
                    ><span
                      v-if="card.dim"
                      class="tw:inline-flex tw:gap-0.5 tw:ml-0.5 tw:shrink-0"
                      ><span
                        v-for="st in getValueStreamTypes(
                          card.dim.group_id,
                          val,
                        )"
                        :key="st"
                        class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:inline-block"
                        :class="{
                          'tw:bg-blue-500': st === 'logs',
                          'tw:bg-orange-500': st === 'traces',
                          'tw:bg-green-500': st === 'metrics',
                        }" /></span
                  ></span>
                  <span
                    v-if="card.values.length > 5"
                    class="dim-stat-pill tw:text-[11px] tw:py-0.5 tw:px-2 tw:rounded-full tw:cursor-pointer hover:tw:opacity-70 tw:transition-opacity"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:text-grey-4'
                        : 'tw:text-grey-6'
                    "
                    >+{{ card.values.length - 5 }}
                    <q-menu anchor="bottom left" self="top left">
                      <div
                        class="tw:p-2 tw:flex tw:flex-wrap tw:gap-1 tw:max-w-[280px] tw:max-h-[200px] tw:overflow-y-auto"
                        :class="
                          store.state.theme === 'dark' ? 'tw:bg-grey-10' : ''
                        "
                      >
                        <span
                          v-for="val in card.values.slice(5)"
                          :key="val"
                          class="tw:text-[11px] tw:py-0.5 tw:px-2 tw:rounded-full tw:border tw:cursor-pointer hover:tw:opacity-70 tw:transition-opacity tw:inline-flex tw:items-center tw:gap-1"
                          :class="
                            store.state.theme === 'dark'
                              ? card.theme.pillDark
                              : card.theme.pillLight
                          "
                          :title="val"
                          v-close-popup
                          @click.stop="openInsightDialogByIdx(val, idx)"
                          ><span class="tw:truncate">{{ val }}</span
                          ><span
                            v-if="card.dim"
                            class="tw:inline-flex tw:gap-0.5 tw:ml-0.5 tw:shrink-0"
                            ><span
                              v-for="st in getValueStreamTypes(
                                card.dim.group_id,
                                val,
                              )"
                              :key="st"
                              class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:inline-block"
                              :class="{
                                'tw:bg-blue-500': st === 'logs',
                                'tw:bg-orange-500': st === 'traces',
                                'tw:bg-green-500': st === 'metrics',
                              }" /></span
                        ></span>
                      </div>
                    </q-menu>
                  </span>
                </div>
              </div>
            </template>
          </div>

          <!-- Stream type legend -->
          <div class="tw:flex tw:items-center tw:gap-3 tw:mt-2 tw:ml-1">
            <div
              class="tw:flex tw:items-center tw:gap-1 tw:text-[10px]"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:text-grey-5'
                  : 'tw:text-grey-5'
              "
            >
              <span
                class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:inline-block tw:bg-blue-500"
              />
              <span>Found in Logs</span>
            </div>
            <div
              class="tw:flex tw:items-center tw:gap-1 tw:text-[10px]"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:text-grey-5'
                  : 'tw:text-grey-5'
              "
            >
              <span
                class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:inline-block tw:bg-orange-500"
              />
              <span>Found in Traces</span>
            </div>
            <div
              class="tw:flex tw:items-center tw:gap-1 tw:text-[10px]"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:text-grey-5'
                  : 'tw:text-grey-5'
              "
            >
              <span
                class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:inline-block tw:bg-green-500"
              />
              <span>Found in Metrics</span>
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
          class="tw:flex tw:items-center tw:gap-3 tw:px-4 tw:py-2.5"
          :class="
            store.state.theme === 'dark' ? 'tw:bg-grey-9/30' : 'tw:bg-grey-1/30'
          "
        >
          <div
            class="tw:flex-1 tw:min-w-0 tw:text-xs tw:truncate"
            :class="
              store.state.theme === 'dark' ? 'tw:text-grey-4' : 'tw:text-grey-7'
            "
          >
            <span
              class="tw:font-bold"
              :class="
                store.state.theme === 'dark'
                  ? 'tw:text-grey-2'
                  : 'tw:text-grey-8'
              "
              >Recommended:</span
            >
            {{ " " }}Use
            <span class="tw:font-semibold">{{
              suggestedConfig.distinguish_by
                .map((id) => getGroupByValue(id)?.display ?? id)
                .join(" + ")
            }}</span>
            — covers {{ activeEnvCoverage ?? "–" }}% of your telemetry.
          </div>
          <div class="tw:shrink-0 tw:flex tw:items-center tw:gap-1">
            <OButton variant="outline" size="sm" @click="applySuggestion">
              Apply
            </OButton>
            <OButton
              variant="ghost"
              size="icon"
              class="tw:opacity-40 hover:tw:opacity-100"
              @click="dismissSuggestion"
            >
              <OIcon name="cancel" size="xs" />
            </OButton>
          </div>
        </div>

        <!-- Workload Insight Sidebar -->
        <ODrawer data-test="service-identity-setup-insight-drawer"
          v-model:open="insightDialogOpen"
          :width="insightPanelWidthPct"
        >
          <!-- #header kept: first line combines plain subtitle text with an inline theme-colored badge
               containing the title + tooltip; second line is a conditional coverage row with icon.
               Cannot be expressed cleanly with title + sub-title props alone. -->
          <template #header>
            <div class="tw:flex-1 tw:min-w-0">
              <div class="tw:text-[16px] tw:flex tw:items-center">
                {{ insightData.subtitle }}
                <span
                  :class="[
                    'tw:font-bold tw:px-2 tw:py-0.5 tw:rounded-md tw:ml-2 tw:max-w-xs tw:truncate tw:inline-block',
                    store.state.theme === 'dark'
                      ? 'tw:text-blue-400 tw:bg-blue-900/50'
                      : 'tw:text-blue-600 tw:bg-blue-50',
                  ]"
                >
                  {{ insightData.title }}
                  <q-tooltip
                    v-if="insightData.title.length > 25"
                    class="tw:text-xs"
                  >
                    {{ insightData.title }}
                  </q-tooltip>
                </span>
              </div>
              <div
                v-if="
                  !(insightData as any).isCardLevel &&
                  insightData.coverage !== null
                "
                class="tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:mt-1"
                :class="
                  store.state.theme === 'dark'
                    ? 'tw:text-grey-4'
                    : 'tw:text-grey-6'
                "
              >
                <OIcon
                  name="verified"
                  size="xs"
                  class="tw:text-positive"
                />
                <span
                  >{{ insightData.coverage }}% of services
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
              <template
                v-if="
                  !(insightData as any).isCardLevel &&
                  (insightData as any).streamDetails?.length > 0
                "
              >
                <div class="tw:mb-3 tw:shrink-0">
                  <div
                    class="tw:text-[11px] tw:tracking-wide tw:font-medium tw:mb-2"
                    :class="
                      store.state.theme === 'dark'
                        ? 'tw:text-grey-5'
                        : 'tw:text-grey-5'
                    "
                  >
                    Stream Sources
                  </div>
                  <div style="height: 40vh; min-height: 180px">
                    <CustomChartRenderer :data="insightChartData.options" />
                  </div>
                  <!-- Legend -->
                  <div
                    class="tw:flex tw:items-center tw:justify-center tw:gap-4 tw:mt-2"
                  >
                    <div
                      v-for="sd in (insightData as any).streamDetails"
                      :key="sd.streamType"
                      class="tw:flex tw:items-center tw:gap-1.5 tw:text-[11px]"
                      :class="
                        store.state.theme === 'dark'
                          ? 'tw:text-grey-4'
                          : 'tw:text-grey-6'
                      "
                    >
                      <span
                        class="tw:w-2 tw:h-2 tw:rounded-full"
                        :class="{
                          'tw:bg-blue-500': sd.streamType === 'logs',
                          'tw:bg-orange-500': sd.streamType === 'traces',
                          'tw:bg-green-500': sd.streamType === 'metrics',
                        }"
                      />
                      <span class="tw:capitalize">{{ sd.streamType }}</span>
                      <span class="tw:font-medium">{{
                        sd.streamNames.length
                      }}</span>
                    </div>
                  </div>
                </div>
              </template>

              <q-separator
                :class="store.state.theme === 'dark' ? 'tw:!bg-grey-8' : ''"
                class="tw:mb-3 tw:shrink-0"
              />

              <!-- Card-level: all values with bars -->
              <template
                v-if="
                  (insightData as any).isCardLevel &&
                  insightData.children.length > 0
                "
              >
                <div
                  class="tw:text-[11px] tw:font-medium tw:mb-3"
                  :class="
                    store.state.theme === 'dark'
                      ? 'tw:text-grey-5'
                      : 'tw:text-grey-5'
                  "
                >
                  All values ({{ insightData.children.length }})
                </div>
                <div class="tw:flex tw:flex-col tw:gap-2.5">
                  <div
                    v-for="child in insightData.children"
                    :key="child.name"
                    class="tw:flex tw:flex-col tw:gap-1"
                  >
                    <div
                      class="tw:flex tw:items-center tw:justify-between tw:text-xs"
                    >
                      <span class="tw:truncate tw:min-w-0 tw:font-medium">{{
                        child.name
                      }}</span>
                      <span
                        class="tw:shrink-0 tw:ml-2 tw:tabular-nums"
                        :class="
                          store.state.theme === 'dark'
                            ? 'tw:text-grey-4'
                            : 'tw:text-grey-6'
                        "
                        >{{ child.count }}
                        {{ insightData.childCountLabel }}</span
                      >
                    </div>
                    <div
                      class="tw:w-full tw:h-2 tw:rounded-full tw:overflow-hidden"
                      :class="
                        store.state.theme === 'dark'
                          ? 'tw:bg-grey-8'
                          : 'tw:bg-grey-2'
                      "
                    >
                      <div
                        class="tw:h-full tw:rounded-full tw:transition-all"
                        :class="
                          insightDialogLevel === 'primary'
                            ? 'tw:bg-blue-5'
                            : insightDialogLevel === 'secondary'
                              ? 'tw:bg-teal-5'
                              : 'tw:bg-purple-5'
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
                  class="tw:flex tw:items-center tw:gap-1.5 tw:text-[11px] tw:mb-2 tw:shrink-0 tw:py-1.5 tw:px-2.5 tw:rounded-md"
                  :class="
                    store.state.theme === 'dark'
                      ? 'tw:bg-grey-9 tw:text-grey-5'
                      : 'tw:bg-blue-1/40 tw:text-grey-6'
                  "
                >
                  <OIcon name="info" size="xs" />
                  <span
                    >These are the related
                    <strong>{{
                      formatDimLabels((insightData as any).relatedDimensions)
                    }}</strong>
                    values co-occurring with
                    <strong>{{ insightData.title }}</strong
                    >.</span
                  >
                </div>
                <div class="tw:flex tw:flex-1 tw:min-h-0 tw:py-3">
                  <div
                    v-for="(dim, dimIdx) in (insightData as any)
                      .relatedDimensions"
                    :key="dim.label + dimIdx"
                    class="tw:flex-1 tw:min-w-0 tw:flex tw:flex-col tw:px-3"
                    :class="[
                      dimIdx > 0
                        ? store.state.theme === 'dark'
                          ? 'tw:border-l tw:border-grey-8'
                          : 'tw:border-l tw:border-grey-3'
                        : '',
                    ]"
                  >
                    <div
                      class="tw:text-[13px] tw:font-bold tw:mb-2"
                      :class="
                        store.state.theme === 'dark'
                          ? 'tw:text-grey-3'
                          : 'tw:text-grey-8'
                      "
                    >
                      {{ dim.label }}
                      <span
                        class="tw:font-normal"
                        :class="
                          store.state.theme === 'dark'
                            ? 'tw:text-grey-5'
                            : 'tw:text-grey-5'
                        "
                        >({{ dim.values.length }})</span
                      >
                    </div>
                    <div
                      class="tw:flex tw:flex-col tw:gap-1 tw:flex-1 tw:overflow-y-auto tw:min-h-0"
                    >
                      <span
                        v-for="dVal in dim.values"
                        :key="dVal"
                        class="tw:text-[13px] tw:py-1 tw:px-2.5 tw:rounded-md tw:border tw:truncate tw:shrink-0"
                        :class="{
                          'tw:bg-teal-10/30 tw:border-teal-9/50 tw:text-teal-3':
                            dim.color === 'teal' &&
                            store.state.theme === 'dark',
                          'tw:bg-teal-1/50 tw:border-teal-2 tw:text-teal-8':
                            dim.color === 'teal' &&
                            store.state.theme !== 'dark',
                          'tw:bg-purple-10/30 tw:border-purple-9/50 tw:text-purple-3':
                            dim.color === 'purple' &&
                            store.state.theme === 'dark',
                          'tw:bg-purple-1/50 tw:border-purple-2 tw:text-purple-8':
                            dim.color === 'purple' &&
                            store.state.theme !== 'dark',
                          'tw:bg-blue-10/30 tw:border-blue-9/50 tw:text-blue-3':
                            dim.color === 'blue' &&
                            store.state.theme === 'dark',
                          'tw:bg-blue-1/50 tw:border-blue-2 tw:text-blue-8':
                            dim.color === 'blue' &&
                            store.state.theme !== 'dark',
                        }"
                        :title="dVal"
                        >{{ dVal }}</span
                      >
                      <span
                        v-if="dim.values.length === 0"
                        class="tw:text-xs tw:italic"
                        :class="
                          store.state.theme === 'dark'
                            ? 'tw:text-grey-6'
                            : 'tw:text-grey-5'
                        "
                        >No values</span
                      >
                    </div>
                  </div>
                </div>
              </template>
          </ODrawer>
      </div>

      <!-- Section 3: Warnings -->
      <div v-if="warnings.length > 0" class="tw:mb-6">
        <q-banner
          rounded
          class="tw:bg-amber-50 dark:tw:bg-amber-900/20 tw:border tw:border-amber-300 dark:tw:border-amber-700"
          data-test="service-identity-warnings-banner"
        >
          <template #avatar>
            <OIcon name="warning" size="sm" />
          </template>
          <div class="tw:flex tw:flex-col tw:gap-1">
            <div v-for="(warn, idx) in warnings" :key="idx" class="tw:text-sm">
              {{ warn }}
            </div>
          </div>
        </q-banner>
      </div>

      <!-- Field Details Dialog -->
      <ODialog data-test="service-identity-setup-details-dialog"
        v-model:open="detailsDialogVisible"
        @update:open="(v) => { if (!v) { preselectedValue = ''; popupPrimaryValue = ''; popupColumnSelections = []; } }"
        size="md"
        :title="primaryDim?.display"
        :sub-title="popupPrimaryValue ? `: ${popupPrimaryValue}` : undefined"
      >

          <q-card-section
            class="tw:flex tw:flex-col tw:gap-4 tw:p-0 tw:border-t"
          >
            <!-- Header section with cardinality details -->
            <div class="tw:flex tw:items-center tw:gap-3 tw:p-4 tw:border-b">
              <span class="tw:font-medium">Cardinality:</span>
              <q-badge
                :color="
                  cardinalityColor(
                    dimensionAnalytics[primaryDim?.group_id]
                      ?.cardinality_class || 'Unknown',
                  )
                "
                rounded
                class="tw:px-2"
              >
                {{
                  dimensionAnalytics[primaryDim?.group_id]?.cardinality || 0
                }}
                unique values
              </q-badge>
              <q-badge
                outline
                :color="
                  cardinalityColor(
                    dimensionAnalytics[primaryDim?.group_id]
                      ?.cardinality_class || 'Unknown',
                  )
                "
              >
                {{
                  dimensionAnalytics[primaryDim?.group_id]?.cardinality_class ||
                  "Unknown"
                }}
              </q-badge>
            </div>

            <!-- Two-pane Layout for Streams and Values -->
            <div
              v-if="
                selectedFieldAnalytics?.sample_values &&
                Object.keys(selectedFieldAnalytics.sample_values).length
              "
              class="tw:flex tw:h-[300px]"
            >
              <!-- Left Pane: Streams List -->
              <div
                class="tw:w-1/3 tw:border-r tw:bg-grey-1 dark:tw:bg-dark tw:flex tw:flex-col"
              >
                <!-- Static column header — never scrolls, never gets covered -->
                <div
                  class="tw:px-4 tw:py-2 tw:font-medium tw:text-xs tw:uppercase tw:text-grey-7 tw:border-b tw:flex tw:items-center tw:justify-between tw:shrink-0"
                  :style="{
                    backgroundColor:
                      store.state.theme === 'dark' ? '#1d1d1d' : '#eeeeee',
                  }"
                >
                  <span>{{
                    selectedStreamType ||
                    ["logs", "metrics", "traces"].find(
                      (t) => selectedFieldAnalytics.sample_values[t],
                    )
                  }}</span>
                  <span class="tw:text-grey-5">Streams</span>
                </div>

                <!-- Scrollable content -->
                <div class="tw:overflow-y-auto tw:flex-1">
                  <!-- Filtered to one type: no section header needed -->
                  <template
                    v-if="
                      selectedStreamType &&
                      selectedFieldAnalytics.sample_values[selectedStreamType]
                    "
                  >
                    <div
                      v-for="streamName in Object.keys(
                        selectedFieldAnalytics.sample_values[
                          selectedStreamType
                        ],
                      )"
                      :key="streamName"
                      class="tw:px-4 tw:py-3 tw:cursor-pointer tw:transition-colors tw:text-sm tw:font-mono tw:truncate hover:tw:bg-primary/10"
                      :class="{
                        'tw:bg-primary/20 tw:text-primary tw:font-medium':
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
                        class="tw:px-4 tw:py-1 tw:text-[10px] tw:font-bold tw:uppercase tw:text-grey-5 tw:sticky tw:top-0 tw:z-10 tw:border-b tw:border-t"
                        :style="{
                          backgroundColor:
                            store.state.theme === 'dark'
                              ? '#1d1d1d'
                              : '#eeeeee',
                        }"
                      >
                        {{ typeName }}
                      </div>
                      <div
                        v-for="streamName in Object.keys(
                          selectedFieldAnalytics.sample_values[typeName],
                        )"
                        :key="typeName + '-' + streamName"
                        class="tw:px-4 tw:py-3 tw:cursor-pointer tw:transition-colors tw:text-sm tw:font-mono tw:truncate hover:tw:bg-primary/10"
                        :class="{
                          'tw:bg-primary/20 tw:text-primary tw:font-medium':
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
                class="tw:flex-1 tw:flex tw:overflow-x-auto"
                :style="{
                  backgroundColor:
                    store.state.theme === 'dark' ? '#1d1d1d' : '#ffffff',
                }"
              >
                <div
                  v-for="(col, colIdx) in popupColumns"
                  :key="col.group_id"
                  class="tw:min-w-[160px] tw:flex-1 tw:overflow-y-auto"
                  :class="{ 'tw:border-l': colIdx > 0 }"
                >
                  <div
                    class="tw:px-4 tw:py-2 tw:font-medium tw:text-xs tw:uppercase tw:text-grey-7 tw:sticky tw:top-0 tw:z-10 tw:border-b"
                    :style="{
                      backgroundColor:
                        store.state.theme === 'dark' ? '#1d1d1d' : '#eeeeee',
                    }"
                  >
                    {{ col.display }}
                  </div>
                  <div class="tw:p-4 tw:flex tw:flex-col tw:gap-2">
                    <div
                      v-for="val in getPopupColumnValues(colIdx)"
                      :key="val"
                      class="tw:px-3 tw:py-2 tw:rounded tw:border tw:transition-colors tw:cursor-pointer tw:font-mono tw:truncate"
                      :style="
                        popupColumnSelections[colIdx] === val
                          ? {}
                          : {
                              backgroundColor:
                                store.state.theme === 'dark'
                                  ? '#2d2d2d'
                                  : '#f5f5f5',
                              borderColor:
                                store.state.theme === 'dark'
                                  ? '#444'
                                  : '#e0e0e0',
                            }
                      "
                      :class="
                        popupColumnSelections[colIdx] === val
                          ? 'tw:bg-primary/15 tw:border-primary/40 tw:text-primary tw:ring-1 tw:ring-primary/30'
                          : ''
                      "
                      @click="selectPopupColumnValue(colIdx, val)"
                    >
                      {{ val }}
                    </div>
                    <div
                      v-if="getPopupColumnValues(colIdx).length === 0"
                      class="tw:text-grey-5 tw:text-xs tw:italic tw:p-2"
                    >
                      No values
                    </div>
                  </div>
                </div>
                <!-- Fallback when no ranked dims beyond the selected field -->
                <div
                  v-if="popupColumns.length === 0"
                  class="tw:flex tw:items-center tw:justify-center tw:flex-1 tw:text-grey-5 tw:text-sm tw:italic"
                >
                  No additional dimensions detected.
                </div>
              </div>
            </div>

            <div v-else class="text-grey tw:italic tw:p-4 tw:text-center">
              No sample data available for this field.
            </div>
          </q-card-section>
      </ODialog>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import CustomChartRenderer from "@/components/dashboards/panels/CustomChartRenderer.vue";
import TagInput from "@/components/alerts/TagInput.vue";
import serviceStreamsService from "@/services/service_streams";
import { clearIdentityConfigCache } from "@/utils/identityConfig";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
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
const $q = useQuasar();
const { t } = useI18n();

// ─── State ────────────────────────────────────────────────────────────────────

const loading = ref(true);
const saving = ref(false);
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
const addFieldValue = ref("");
const addingTrackedAlias = ref(false);
const addTrackedAliasValue = ref("");
const addTrackedAliasSelectRef = ref<any>(null);
const addFieldFilter = ref("");

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
  addFieldValue.value = "";
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
    iconClass: "tw:text-blue-5",
    countClass: "tw:text-blue-6",
    borderDark:
      "border: 1px solid rgba(59,130,246,0.4); background: rgba(59,130,246,0.06)",
    borderLight:
      "border: 1px solid rgba(59,130,246,0.3); background: rgba(59,130,246,0.05)",
    pillDark: "tw:bg-blue-10/30 tw:border-blue-9/50 tw:text-blue-3",
    pillLight: "tw:bg-blue-1/50 tw:border-blue-2 tw:text-blue-8",
  },
  {
    // teal
    icon: "folder_open",
    iconClass: "tw:text-teal-5",
    countClass: "tw:text-teal-6",
    borderDark:
      "border: 1px solid rgba(20,184,166,0.4); background: rgba(20,184,166,0.06)",
    borderLight:
      "border: 1px solid rgba(20,184,166,0.3); background: rgba(20,184,166,0.05)",
    pillDark: "tw:bg-teal-10/30 tw:border-teal-9/50 tw:text-teal-3",
    pillLight: "tw:bg-teal-1/50 tw:border-teal-2 tw:text-teal-8",
  },
  {
    // purple
    icon: "widgets",
    iconClass: "tw:text-purple-5",
    countClass: "tw:text-purple-6",
    borderDark:
      "border: 1px solid rgba(168,85,247,0.4); background: rgba(168,85,247,0.06)",
    borderLight:
      "border: 1px solid rgba(168,85,247,0.3); background: rgba(168,85,247,0.05)",
    pillDark: "tw:bg-purple-10/30 tw:border-purple-9/50 tw:text-purple-3",
    pillLight: "tw:bg-purple-1/50 tw:border-purple-2 tw:text-purple-8",
  },
  {
    // amber
    icon: "lan",
    iconClass: "tw:text-amber-5",
    countClass: "tw:text-amber-6",
    borderDark:
      "border: 1px solid rgba(245,158,11,0.4); background: rgba(245,158,11,0.06)",
    borderLight:
      "border: 1px solid rgba(245,158,11,0.3); background: rgba(245,158,11,0.05)",
    pillDark: "tw:bg-amber-10/30 tw:border-amber-9/50 tw:text-amber-3",
    pillLight: "tw:bg-amber-1/50 tw:border-amber-2 tw:text-amber-8",
  },
  {
    // rose
    icon: "hub",
    iconClass: "tw:text-red-4",
    countClass: "tw:text-red-5",
    borderDark:
      "border: 1px solid rgba(244,63,94,0.4); background: rgba(244,63,94,0.06)",
    borderLight:
      "border: 1px solid rgba(244,63,94,0.3); background: rgba(244,63,94,0.05)",
    pillDark: "tw:bg-red-10/30 tw:border-red-9/50 tw:text-red-3",
    pillLight: "tw:bg-red-1/50 tw:border-red-2 tw:text-red-8",
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
  const isDark = store.state.theme === "dark";
  return {
    backgroundColor: isDark ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.1)",
    borderColor: isDark ? "rgba(59,130,246,0.5)" : "rgba(59,130,246,0.4)",
    color: isDark ? "#93c5fd" : "#1d4ed8",
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
        subtitle: `${allValues.length} unique values detected`,
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
        subtitle: `${allVals.length} unique values detected`,
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
      subtitle: `${allVals.length} unique values detected`,
      coverage: null,
      count: null,
      total: dim?.service_count ?? null,
      childLabel: "",
      childCountLabel: "locations",
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

  const isDark = store.state.theme === "dark";
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
          color: isDark ? "#fff" : "#000",
          fontSize: 12,
        },
        backgroundColor: isDark ? "rgba(0,0,0,1)" : "rgba(255,255,255,1)",
        extraCssText: "max-height: 240px; overflow-y: auto;",
        formatter: function (params: any) {
          const names: string[] = params.data?.streamNames ?? [];
          const header = `${params.marker} ${params.name} : <b>${params.value} streams (${params.percent}%)</b>`;
          if (!names.length) return header;
          const list = names
            .map(
              (n) =>
                `<div style="padding:1px 0;padding-left:14px;font-size:11px;">${n}</div>`,
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
            borderColor: isDark ? "#111827" : "#fff",
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
                  fill: isDark ? "#e5e7eb" : "#1f2937",
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
 * Logic previously on backend: Detect environment and suggest fields based on available data.
 * Now dynamic based on the active environment tab.
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
 * Logic previously on backend: Detect environment and suggest fields based on available data.
 * Now dynamic based on the active environment tab.
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

function onAddTrackedAlias(value: string) {
  if (value && !trackedAliasIds.value.includes(value)) {
    trackedAliasIds.value = [...trackedAliasIds.value, value];
  }
  addTrackedAliasValue.value = "";
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

/** Returns a Quasar color token for a stream type chip */
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

/** Returns a Quasar color token for a cardinality class */
function cardinalityColor(cardClass: string): string {
  const map: Record<string, string> = {
    VeryLow: "positive",
    Low: "positive",
    Medium: "warning",
    High: "negative",
    VeryHigh: "negative",
  };
  return map[cardClass] ?? "grey";
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
  const classLabel = formatted ? ` (${formatted} cardinality)` : "";
  return `${count} unique values${classLabel} — fewer values = better for grouping`;
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
  const needle = addFieldFilter.value.toLowerCase();
  return availableGroups.value
    .filter((g) => !used.has(g.group_id))
    .filter(
      (g) =>
        !needle ||
        g.display.toLowerCase().includes(needle) ||
        g.group_id.toLowerCase().includes(needle),
    )
    .map((g) => {
      const dim = dimensionAnalytics.value[g.group_id];
      const cardClass = dim?.cardinality_class ?? g.cardinality_class ?? null;
      return {
        label: g.display,
        value: g.group_id,
        streamTypes: g.stream_types,
        recommended: g.recommended,
        uniqueValues: dim?.cardinality ?? g.unique_values ?? null,
        cardinalityLabel: cardClass,
        cardinalityColor: cardClass ? cardinalityColor(cardClass) : "grey",
      };
    });
}

function onAddFieldFilter(val: string, update: (fn: () => void) => void) {
  update(() => {
    addFieldFilter.value = val;
  });
}

/** Called when user picks a field in the inline select for a specific env */
function onAddFieldToEnv(envKey: string, val: string) {
  if (!val) return;
  addFieldFilter.value = "";
  const current = setDistinguishBy.value[envKey] ?? [];
  setDistinguishBy.value = {
    ...setDistinguishBy.value,
    [envKey]: [...current.filter(Boolean), val],
  };
  addFieldValue.value = "";
  addingToEnv.value = "";
}

function applySuggestion() {
  if (suggestedConfig.value?.distinguish_by?.length) {
    distinguishBy.value = [...suggestedConfig.value.distinguish_by];
  }
  addingToEnv.value = "";
  suggestionDismissed.value = true;
  $q.notify({
    type: "positive",
    message:
      'Recommended configuration applied. Click "Save Configuration" to save.',
    timeout: 3000,
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
    $q.notify({
      type: "negative",
      message: t("settings.correlation.loadRecommendationsFailed"),
      timeout: 3000,
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
      $q.notify({
        type: "warning",
        message: t(
          "settings.correlation.identityConfigNoSets",
          "Configure at least one identity set before saving.",
        ),
        timeout: 3000,
      });
      return;
    }

    if (trackedAliasIds.value.length === 0) {
      $q.notify({
        type: "warning",
        message: "Select at least one tracked alias group.",
        timeout: 3000,
      });
      return;
    }

    // "service" is always tracked implicitly by the backend; strip it to avoid 400.
    // Also drop orphan ids that no longer correspond to any known group (e.g. the
    // group was deleted from Field Mappings after being added to tracked aliases).
    const knownGroupIds = new Set([
      ...availableGroups.value.map(g => g.group_id),
      ...trackedAliasOptions.value.map(o => o.value),
    ]);
    const sanitizedTrackedAliasIds = trackedAliasIds.value.filter(id =>
      id !== "service" && knownGroupIds.has(id)
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

    $q.notify({
      type: "positive",
      message: t("settings.correlation.identityConfigSaved"),
      timeout: 2000,
    });
  } catch (err: any) {
    $q.notify({
      type: "negative",
      message:
        err?.response?.data?.message ||
        err?.message ||
        t("settings.correlation.identityConfigSaveFailed"),
      timeout: 3000,
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

<style scoped lang="scss">
.service-identity-setup {
  .setup-section {
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--o2-border-color);

    &:last-of-type {
      border-bottom: none;
    }
  }
}

.dim-stat-card {
  display: flex;
  flex-direction: column;
}

.dim-stat-pills {
  overflow: hidden;
}

.dim-stat-pill {
  max-width: calc(50% - 4px);
  height: 22px;
  box-sizing: border-box;
}

.config-link-btn {
  border: 1px solid #3b82f6;
  color: #2563eb;
  background: rgba(59, 130, 246, 0.08);
  transition: background 0.15s;
  &:hover {
    background: rgba(59, 130, 246, 0.18);
  }
}

.sis-dark .config-link-btn {
  border-color: #60a5fa;
  color: #93c5fd;
  background: rgba(96, 165, 250, 0.12);
  &:hover {
    background: rgba(96, 165, 250, 0.22);
  }
}
</style>
