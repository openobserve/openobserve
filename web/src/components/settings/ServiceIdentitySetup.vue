<!-- Copyright 2025 OpenObserve Inc.

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
  <div class="tw:w-full service-identity-setup q-mt-sm">
    <!-- Loading skeleton while fetching recommendations -->
    <div v-if="loading" class="tw:flex tw:flex-col tw:gap-4 tw:py-4">
      <q-skeleton type="rect" height="56px" class="tw:rounded-lg" />
      <q-skeleton type="rect" height="56px" class="tw:rounded-lg" />
      <q-skeleton type="rect" height="40px" width="160px" class="tw:rounded-lg" />
    </div>

    <div v-else>
      <!-- Section 1: Service name source (fixed, compact) -->
      <div class="setup-section tw:mb-6 tw:text-sm tw:flex tw:items-center tw:gap-1">
        <span>{{ t("settings.correlation.serviceNameDerivedPrefix") }} {{ t("settings.correlation.serviceNameFields") }}</span>
        <q-btn
          flat round dense size="xs" color="primary"
          icon="open_in_new"
          @click="$emit('navigate-to-aliases', 'service')"
        />
      </div>

      <!-- Section 2: Disambiguation Fields -->
      <div class="setup-section tw:mb-6">
        <GroupHeader
          :title="t('settings.correlation.distinguishByLabel')"
          :showIcon="false"
          class="tw:mb-1"
        />
        <div class="text-body2 tw:mb-3 tw:opacity-70">
          {{ t("settings.correlation.distinguishByHelp") }}
        </div>

        <!-- Empty state: nothing configured anywhere -->
        <div
          v-if="allConfiguredEnvs.length === 0 && !addingToEnv"
          class="tw:flex tw:items-center tw:gap-3 tw:py-1"
        >
          <span class="tw:text-sm tw:text-grey-6">
            No identity fields configured yet.
          </span>
          <q-btn
            flat no-caps dense size="sm" color="primary" icon="add" label="Add field"
            data-test="service-identity-add-distinguish-btn"
            @click="addingToEnv = activeEnvironment"
          />
        </div>

        <!-- All configured env groups -->
        <div v-else class="tw:flex tw:flex-col">
          <!-- One row per configured env -->
          <template v-for="(envKey, envIdx) in allConfiguredEnvs" :key="envKey">
            <!-- Divider between groups -->
            <div
              v-if="envIdx > 0"
              class="tw:border-t tw:my-2"
              :class="store.state.theme === 'dark' ? 'tw:border-grey-8' : 'tw:border-grey-3'"
            />
            <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:py-1">
              <!-- Pills for this env's fields -->
              <div
                v-for="fieldId in (setDistinguishBy[envKey] ?? []).filter(Boolean)"
                :key="fieldId"
                class="tw:flex tw:items-center tw:gap-1.5 tw:pl-3 tw:pr-1.5 tw:py-1.5 tw:rounded-lg tw:border tw:text-xs tw:font-semibold tw:transition-colors"
                :class="store.state.theme === 'dark'
                  ? 'tw:bg-primary/15 tw:border-primary/30 tw:text-primary'
                  : 'tw:bg-primary/10 tw:border-primary/20 tw:text-primary'"
              >
                {{ getGroupByValue(fieldId)?.display ?? fieldId }}
                <q-btn
                  flat round dense size="xs" icon="close" color="primary"
                  @click="removeFieldByIdFromEnv(envKey, fieldId)"
                />
              </div>

              <!-- Inline add select for this group -->
              <template v-if="addingToEnv === envKey">
                <q-select
                  ref="addFieldSelectRef"
                  v-model="addFieldValue"
                  :options="getAddFieldOptionsForEnv(envKey)"
                  option-label="label"
                  option-value="value"
                  emit-value map-options
                  dense outlined
                  placeholder="Select field…"
                  style="min-width: 200px"
                  data-test="service-identity-add-distinguish-btn"
                  @update:model-value="onAddFieldToEnv(envKey, $event)"
                >
                  <template #option="scope">
                    <q-item v-bind="scope.itemProps">
                      <q-item-section>
                        <q-item-label class="tw:flex tw:items-center tw:gap-2">
                          {{ scope.opt.label }}
                          <q-badge v-if="scope.opt.recommended" color="positive" outline label="recommended" class="tw:text-xs" />
                        </q-item-label>
                        <q-item-label caption>{{ scope.opt.streamTypes?.join(', ') }}</q-item-label>
                      </q-item-section>
                    </q-item>
                  </template>
                </q-select>
                <q-btn flat round dense icon="close" size="sm" color="grey-6" @click="addingToEnv = ''; addFieldValue = ''" />
              </template>

              <!-- + Add chip (when not adding to this group and under limit) -->
              <div
                v-else-if="(setDistinguishBy[envKey] ?? []).filter(Boolean).length < 5"
                class="tw:flex tw:items-center tw:gap-1 tw:px-3 tw:py-1.5 tw:rounded-lg tw:border tw:border-dashed tw:border-grey-4 tw:text-xs tw:text-grey-5 tw:cursor-pointer hover:tw:border-primary hover:tw:text-primary tw:transition-colors"
                @click="addingToEnv = envKey"
              >
                <q-icon name="add" size="12px" />
                Add
              </div>
            </div>
          </template>

          <!-- Adding to a new env (not yet in the list) -->
          <template v-if="addingToEnv && !allConfiguredEnvs.includes(addingToEnv)">
            <div
              v-if="allConfiguredEnvs.length > 0"
              class="tw:border-t tw:my-2"
              :class="store.state.theme === 'dark' ? 'tw:border-grey-8' : 'tw:border-grey-3'"
            />
            <div class="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:py-1">
              <q-select
                ref="addFieldSelectRef"
                v-model="addFieldValue"
                :options="getAddFieldOptionsForEnv(addingToEnv)"
                option-label="label"
                option-value="value"
                emit-value map-options
                dense outlined
                placeholder="Select field…"
                style="min-width: 200px"
                data-test="service-identity-add-distinguish-btn"
                @update:model-value="onAddFieldToEnv(addingToEnv, $event)"
              >
                <template #option="scope">
                  <q-item v-bind="scope.itemProps">
                    <q-item-section>
                      <q-item-label class="tw:flex tw:items-center tw:gap-2">
                        {{ scope.opt.label }}
                        <q-badge v-if="scope.opt.recommended" color="positive" outline label="recommended" class="tw:text-xs" />
                      </q-item-label>
                      <q-item-label caption>{{ scope.opt.streamTypes?.join(', ') }}</q-item-label>
                    </q-item-section>
                  </q-item>
                </template>
              </q-select>
              <q-btn flat round dense icon="close" size="sm" color="grey-6" @click="addingToEnv = ''; addFieldValue = ''" />
            </div>
          </template>

          <!-- Add new group chip -->
          <template v-if="!addingToEnv">
            <div
              class="tw:border-t tw:my-2"
              :class="store.state.theme === 'dark' ? 'tw:border-grey-8' : 'tw:border-grey-3'"
            />
            <div class="tw:flex tw:items-center tw:gap-2 tw:py-1">
              <div
                class="tw:flex tw:items-center tw:gap-1 tw:px-3 tw:py-1.5 tw:rounded-lg tw:border tw:border-dashed tw:border-grey-4 tw:text-xs tw:text-grey-5 tw:cursor-pointer hover:tw:border-primary hover:tw:text-primary tw:transition-colors"
                @click="addingToEnv = generateGroupId()"
              >
                <q-icon name="add" size="12px" />
                Group
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Save button: lives with the fields it saves, not below detection -->
      <div class="tw:flex tw:justify-start tw:mb-6">
        <q-btn
          :label="t('settings.correlation.saveIdentityConfig')"
          :loading="saving"
          :disable="saving"
          no-caps
          class="o2-primary-button tw:h-[36px]"
          :class="
            store.state.theme === 'dark'
              ? 'o2-primary-button-dark'
              : 'o2-primary-button-light'
          "
          data-test="service-identity-save-btn"
          @click="saveConfig"
        />
      </div>

      <!-- Section 2.5: Workload Detection -->
      <div v-if="availableGroups.length > 0" class="setup-section tw:mb-6">
        <div class="tw:flex tw:items-start tw:justify-between tw:mb-1">
          <GroupHeader
            :title="t('settings.correlation.availableFieldsPreviewLabel', 'Workload Detection')"
            :showIcon="false"
          />
        </div>
        <div class="text-body2 tw:mb-4 tw:opacity-70">
          {{ t('settings.correlation.availableFieldsPreviewHelp', 'We discovered these deployment patterns in your streams. Use them to configure service correlation.') }}
        </div>

        <!-- Environment Tabs + global coverage -->
        <div class="tw:flex tw:items-center tw:gap-4 tw:mb-6">
          <div class="tw:flex tw:gap-2">
            <div
              v-for="env in detectedEnvironments"
              :key="env.key"
              class="tw:relative tw:px-4 tw:py-2 tw:rounded-md tw:border tw:cursor-pointer tw:transition-all tw:text-sm tw:font-medium tw:min-w-[80px] tw:text-center"
              :class="activeEnvironment === env.key
                ? 'tw:bg-white dark:tw:bg-grey-8 tw:text-grey-10 dark:tw:text-grey-1 tw:border-grey-9 dark:tw:border-white tw:shadow-sm'
                : 'tw:bg-grey-1 dark:tw:bg-grey-9 tw:text-grey-6 dark:tw:text-grey-5 tw:border-grey-3 dark:tw:border-grey-8'
              "
              @click="activeEnvironment = env.key"
            >
              {{ env.label }}
              <!-- Dot badge: shows green when this env has configured distinguish_by fields -->
              <span
                v-if="(setDistinguishBy[env.key] ?? []).filter(Boolean).length > 0"
                class="tw:absolute tw:top-1 tw:right-1 tw:w-2 tw:h-2 tw:rounded-full tw:bg-positive"
                :title="`${(setDistinguishBy[env.key] ?? []).filter(Boolean).length} field(s) configured`"
              />
            </div>
          </div>

        </div>

        <!-- Hierarchy label + coverage -->
        <div v-if="hierarchyLabel" class="tw:flex tw:items-baseline tw:gap-3 tw:mb-4">
          <span class="tw:text-[11px] tw:font-bold tw:uppercase tw:tracking-[0.1em] tw:text-grey-6">
            {{ hierarchyLabel }}
          </span>
          <span v-if="activeEnvCoverage !== null" class="tw:text-xs tw:text-grey-6">
            (covers {{ activeEnvCoverage }}% of your total telemetry)
          </span>
        </div>        <!-- Per-value cards for the primary (lowest cardinality) dimension -->
        <div class="tw:flex tw:flex-col tw:gap-4">
          <div
            v-for="(cardData, valueKey) in primaryDimCards"
            :key="valueKey"
            class="tw:border tw:rounded-lg tw:overflow-hidden tw:shadow-sm tw:bg-white dark:tw:bg-grey-10"
            :class="store.state.theme === 'dark' ? 'tw:border-grey-9' : 'tw:border-grey-2'"
          >
            <!-- Card Header: vertical accent + field type label + value + cardinality + coverage -->
            <div class="tw:flex tw:items-center tw:gap-4 tw:px-5 tw:py-4">
              <div class="tw:w-[3px] tw:h-10 tw:bg-primary tw:rounded-full tw:shrink-0" />
              <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
                <span class="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-wider tw:text-primary tw:opacity-70">
                  {{ primaryDim?.display }}
                </span>
                <span class="tw:font-bold tw:text-xl tw:text-grey-9 dark:tw:text-grey-2">{{ valueKey }}</span>
              </div>
              <div class="tw:flex tw:items-center tw:gap-3 tw:shrink-0">
                <q-badge
                  v-if="getEffectiveCardinalityClass(primaryDim) !== 'Unknown'"
                  :color="cardinalityColor(getEffectiveCardinalityClass(primaryDim))"
                  unelevated
                  class="tw:px-3 tw:py-1 tw:rounded-md tw:text-[10px] tw:font-bold"
                >
                  {{ getEffectiveCardinalityClass(primaryDim) }}
                </q-badge>
                <!-- Per-value coverage: fraction of env services in THIS specific value -->
                <span
                  v-if="getValueCoverage(primaryDim, valueKey) !== null"
                  class="tw:text-xs tw:font-medium tw:opacity-50"
                >
                  • {{ getValueCoverage(primaryDim, valueKey) }}% of {{ activeEnvironment.toUpperCase() }}
                </span>
              </div>
            </div>

            <!-- Card Body: hierarchical dimensions (f2/f3) -->
            <div class="tw:px-5 tw:pb-4 tw:pt-0 tw:flex tw:flex-col tw:gap-4">
              <!-- Nested secondary and tertiary dimensions as cloud of pills -->
              <template v-if="secondaryDim && cardData.childValues.length > 0">
                <div class="tw:flex tw:flex-col tw:gap-2 tw:pl-[17px]">
                  <span class="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-widest tw:text-grey-5">
                    {{ pluralize(secondaryDim.display) }}
                  </span>
                  <div class="tw:flex tw:flex-wrap tw:gap-2">
                    <div
                      v-for="sVal in cardData.childValues.slice(0, 10)"
                      :key="sVal"
                      class="tw:flex tw:flex-col tw:gap-1.5 tw:px-3 tw:py-2 tw:rounded-lg tw:bg-grey-1 dark:tw:bg-grey-9 tw:border tw:border-grey-2 dark:tw:border-grey-8 tw:cursor-pointer tw:transition-colors hover:tw:border-primary/40 hover:tw:bg-primary/5"
                      :title="`View details for ${secondaryDim?.display}: ${sVal}`"
                      @click.stop="secondaryDim && openFieldDetails(secondaryDim, '', sVal)"
                    >
                      <div class="tw:flex tw:items-center tw:gap-1.5 tw:text-xs tw:font-semibold">
                        <div class="tw:w-1.5 tw:h-1.5 tw:rounded-full tw:bg-primary" />
                        {{ sVal }}
                      </div>
                      
                      <!-- Tertiary samples (f3) -->
                      <div v-if="tertiaryDim && cardData.tertiaryValues[sVal]?.length" class="tw:flex tw:flex-wrap tw:gap-1 tw:pl-3">
                        <span 
                          v-for="tVal in cardData.tertiaryValues[sVal].slice(0, 3)" 
                          :key="tVal"
                          class="tw:text-[9px] tw:px-1.5 tw:py-0.5 tw:rounded-md tw:bg-primary/5 tw:text-primary/70 tw:border tw:border-primary/10"
                        >
                          {{ tVal }}
                        </span>
                        <span v-if="cardData.tertiaryValues[sVal].length > 3" class="tw:text-[9px] tw:text-grey-5">
                          +{{ cardData.tertiaryValues[sVal].length - 3 }}
                        </span>
                      </div>
                    </div>
                    <div
                      v-if="cardData.childValues.length > 10"
                      class="tw:text-xs tw:text-primary tw:font-medium tw:cursor-pointer hover:tw:underline tw:self-center"
                      @click="primaryDim && openFieldDetails(primaryDim)"
                    >
                      +{{ cardData.childValues.length - 10 }} more
                    </div>
                  </div>
                </div>
              </template>

              <!-- Found In stream chips -->
              <div class="tw:flex tw:items-center tw:gap-4 tw:mt-1 tw:pl-[17px] tw:border-t tw:pt-4 dark:tw:border-grey-9">
                <span class="tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-widest tw:text-grey-4">Found in</span>
                <div class="tw:flex tw:items-center tw:gap-2">
                  <div
                    v-for="st in (primaryDim?.stream_types ?? [])"
                    :key="st"
                    class="tw:flex tw:items-center tw:gap-1.5 tw:px-2 tw:py-1 tw:rounded tw:text-[10px] tw:font-bold tw:uppercase tw:tracking-tighter tw:cursor-pointer tw:transition-opacity hover:tw:opacity-80"
                    :class="{
                      'tw:bg-blue-1 tw:text-blue-7': st === 'logs',
                      'tw:bg-orange-1 tw:text-orange-7': st === 'traces',
                      'tw:bg-green-1 tw:text-green-7': st === 'metrics'
                    }"
                    @click.stop="primaryDim && openFieldDetails(primaryDim, st)"
                  >
                    <q-icon :name="st === 'logs' ? 'description' : st === 'traces' ? 'timeline' : 'insights'" size="12px" />
                    {{ st }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Recommendation Banner -->
        <div
          v-if="suggestedConfig && activeEnvGroups.length > 0"
          class="tw:mt-6 tw:flex tw:items-center tw:gap-4 tw:px-5 tw:py-4 tw:rounded-xl tw:border tw:shadow-sm"
          :class="store.state.theme === 'dark' ? 'tw:bg-grey-9 tw:border-grey-8' : 'tw:bg-white tw:border-grey-2'"
        >
          <div class="tw:bg-positive/10 tw:p-2 tw:rounded-full">
            <q-icon name="check" color="positive" size="sm" />
          </div>
          <div class="tw:flex tw:flex-col tw:flex-1 tw:min-w-0">
            <div class="tw:flex tw:items-baseline tw:gap-2">
              <span class="tw:font-bold tw:text-sm tw:text-grey-9 dark:tw:text-grey-2">
                {{ suggestedConfig.distinguish_by.map(id => getGroupByValue(id)?.display ?? id).join(' + ') }}
              </span>
              <span class="tw:text-xs tw:font-bold tw:text-positive tw:uppercase tw:tracking-tight">recommended for service disambiguation</span>
            </div>
            <span class="tw:text-xs tw:text-grey-6 tw:mt-0.5">{{ suggestedConfig.reason }}</span>
          </div>
          <div class="tw:flex tw:gap-3 tw:shrink-0">
            <q-btn
              no-caps
              unelevated
              size="sm"
              color="primary"
              label="Use Recommended"
              class="tw:px-4 tw:py-2 tw:rounded-lg tw:font-bold"
              @click="applySuggestion"
            />
          </div>
        </div>
      </div>

      <!-- Section 3: Warnings -->
      <div v-if="warnings.length > 0" class="tw:mb-6">
        <q-banner
          rounded
          class="tw:bg-amber-50 dark:tw:bg-amber-900/20 tw:border tw:border-amber-300 dark:tw:border-amber-700"
          data-test="service-identity-warnings-banner"
        >
          <template #avatar>
            <q-icon name="warning" color="warning" />
          </template>
          <div class="tw:flex tw:flex-col tw:gap-1">
            <div
              v-for="(warn, idx) in warnings"
              :key="idx"
              class="tw:text-sm"
            >
              {{ warn }}
            </div>
          </div>
        </q-banner>
      </div>


      <!-- Field Details Dialog -->
      <q-dialog v-model="detailsDialogVisible" @hide="preselectedValue = ''; popupPrimaryValue = ''; popupColumnSelections = []">
        <q-card style="width: 760px; max-width: 95vw;">
          <q-card-section class="row items-center q-pb-none">
            <div class="text-h6 tw:flex tw:items-center tw:gap-2">
              {{ primaryDim?.display }}
              <span v-if="popupPrimaryValue" class="text-subtitle2 text-grey">: {{ popupPrimaryValue }}</span>
            </div>
            <q-space />
            <q-btn icon="close" flat round dense v-close-popup />
          </q-card-section>

          <q-card-section class="tw:flex tw:flex-col tw:gap-4 tw:p-0 tw:border-t">
            <!-- Header section with cardinality details -->
            <div class="tw:flex tw:items-center tw:gap-3 tw:p-4 tw:border-b">
              <span class="tw:font-medium">Cardinality:</span>
              <q-badge :color="cardinalityColor(dimensionAnalytics[primaryDim?.group_id]?.cardinality_class || 'Unknown')" rounded class="tw:px-2">
                {{ dimensionAnalytics[primaryDim?.group_id]?.cardinality || 0 }} unique values
              </q-badge>
              <q-badge outline :color="cardinalityColor(dimensionAnalytics[primaryDim?.group_id]?.cardinality_class || 'Unknown')">
                {{ dimensionAnalytics[primaryDim?.group_id]?.cardinality_class || 'Unknown' }}
              </q-badge>
            </div>
            
            <!-- Two-pane Layout for Streams and Values -->
            <div 
              v-if="selectedFieldAnalytics?.sample_values && Object.keys(selectedFieldAnalytics.sample_values).length" 
              class="tw:flex tw:h-[300px]"
            >
              <!-- Left Pane: Streams List -->
              <div class="tw:w-1/3 tw:border-r tw:bg-grey-1 dark:tw:bg-dark tw:flex tw:flex-col">
                <!-- Static column header — never scrolls, never gets covered -->
                <div
                  class="tw:px-4 tw:py-2 tw:font-medium tw:text-xs tw:uppercase tw:text-grey-7 tw:border-b tw:flex tw:items-center tw:justify-between tw:shrink-0"
                  :style="{ backgroundColor: store.state.theme === 'dark' ? '#1d1d1d' : '#eeeeee' }"
                >
                  <span>{{ selectedStreamType || ['logs', 'metrics', 'traces'].find(t => selectedFieldAnalytics.sample_values[t]) }}</span>
                  <span class="tw:text-grey-5">Streams</span>
                </div>

                <!-- Scrollable content -->
                <div class="tw:overflow-y-auto tw:flex-1">
                  <!-- Filtered to one type: no section header needed -->
                  <template v-if="selectedStreamType && selectedFieldAnalytics.sample_values[selectedStreamType]">
                    <div
                      v-for="streamName in Object.keys(selectedFieldAnalytics.sample_values[selectedStreamType])"
                      :key="streamName"
                      class="tw:px-4 tw:py-3 tw:cursor-pointer tw:transition-colors tw:text-sm tw:font-mono tw:truncate hover:tw:bg-primary/10"
                      :class="{ 'tw:bg-primary/20 tw:text-primary tw:font-medium': activeStreamId === streamName }"
                      @click="activeStreamId = streamName"
                    >
                      {{ streamName }}
                    </div>
                  </template>

                  <!-- All types: sticky section labels for 2nd+ types only; first is already in the static header -->
                  <template v-else>
                    <template
                      v-for="(typeName, typeIdx) in ['logs', 'metrics', 'traces'].filter(t => selectedFieldAnalytics.sample_values[t])"
                      :key="typeName"
                    >
                      <div
                        v-if="typeIdx > 0"
                        class="tw:px-4 tw:py-1 tw:text-[10px] tw:font-bold tw:uppercase tw:text-grey-5 tw:sticky tw:top-0 tw:z-10 tw:border-b tw:border-t"
                        :style="{ backgroundColor: store.state.theme === 'dark' ? '#1d1d1d' : '#eeeeee' }"
                      >
                        {{ typeName }}
                      </div>
                      <div
                        v-for="streamName in Object.keys(selectedFieldAnalytics.sample_values[typeName])"
                        :key="typeName + '-' + streamName"
                        class="tw:px-4 tw:py-3 tw:cursor-pointer tw:transition-colors tw:text-sm tw:font-mono tw:truncate hover:tw:bg-primary/10"
                        :class="{ 'tw:bg-primary/20 tw:text-primary tw:font-medium': activeStreamId === streamName && activeStreamType === typeName }"
                        @click="activeStreamId = streamName; activeStreamType = typeName"
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
                :style="{ backgroundColor: store.state.theme === 'dark' ? '#1d1d1d' : '#ffffff' }"
              >
                <div
                  v-for="(col, colIdx) in popupColumns"
                  :key="col.group_id"
                  class="tw:min-w-[160px] tw:flex-1 tw:overflow-y-auto"
                  :class="{ 'tw:border-l': colIdx > 0 }"
                >
                  <div
                    class="tw:px-4 tw:py-2 tw:font-medium tw:text-xs tw:uppercase tw:text-grey-7 tw:sticky tw:top-0 tw:z-10 tw:border-b"
                    :style="{ backgroundColor: store.state.theme === 'dark' ? '#1d1d1d' : '#eeeeee' }"
                  >
                    {{ col.display }}
                  </div>
                  <div class="tw:p-4 tw:flex tw:flex-col tw:gap-2">
                    <div
                      v-for="val in getPopupColumnValues(colIdx)"
                      :key="val"
                      class="tw:px-3 tw:py-2 tw:rounded tw:border tw:transition-colors tw:cursor-pointer tw:font-mono tw:truncate"
                      :style="popupColumnSelections[colIdx] === val
                        ? {}
                        : { backgroundColor: store.state.theme === 'dark' ? '#2d2d2d' : '#f5f5f5', borderColor: store.state.theme === 'dark' ? '#444' : '#e0e0e0' }"
                      :class="popupColumnSelections[colIdx] === val
                        ? 'tw:bg-primary/15 tw:border-primary/40 tw:text-primary tw:ring-1 tw:ring-primary/30'
                        : ''"
                      @click="selectPopupColumnValue(colIdx, val)"
                    >
                      {{ val }}
                    </div>
                    <div v-if="getPopupColumnValues(colIdx).length === 0" class="tw:text-grey-5 tw:text-xs tw:italic tw:p-2">
                      No values
                    </div>
                  </div>
                </div>
                <!-- Fallback when no ranked dims beyond the selected field -->
                <div v-if="popupColumns.length === 0" class="tw:flex tw:items-center tw:justify-center tw:flex-1 tw:text-grey-5 tw:text-sm tw:italic">
                  No additional dimensions detected.
                </div>
              </div>
            </div>
            
            <div v-else class="text-grey tw:italic tw:p-4 tw:text-center">
              No sample data available for this field.
            </div>
          </q-card-section>
        </q-card>
      </q-dialog>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from "vue";
import { useStore } from "vuex";
import { useQuasar } from "quasar";
import { useI18n } from "vue-i18n";
import GroupHeader from "@/components/common/GroupHeader.vue";
import serviceStreamsService from "@/services/service_streams";
import type {
  ServiceIdentityConfig,
  IdentitySet,
  DimensionAnalytics,
  DimensionAnalyticsSummary,
  FoundGroup,
} from "@/services/service_streams";

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
const warnings = ref<string[]>([]);
const suggestionDismissed = ref(false);

/** Detailed analytics data mapped by dimension name */
const dimensionAnalytics = ref<Record<string, DimensionAnalytics>>({});

/** Section 2: pill-based field configuration */
const addingToEnv = ref<string>('');
const addFieldValue = ref('');

/** All env keys that have at least one configured field, ordered by detected env order */
const allConfiguredEnvs = computed(() => {
  const envOrder = detectedEnvironments.value.map(e => e.key);
  const configured = new Set(
    Object.entries(setDistinguishBy.value)
      .filter(([, fields]) => fields.filter(Boolean).length > 0)
      .map(([key]) => key)
  );
  // Sort by detected environment order, then append any not in that list
  return [
    ...envOrder.filter(k => configured.has(k)),
    ...[...configured].filter(k => !envOrder.includes(k)),
  ];
});

const addFieldSelectRef = ref<any>(null);

/** Configured fields for the active env (non-empty IDs only) */
const configuredFields = computed(() => distinguishBy.value.filter(Boolean));

/** Display label for the active environment tab */
const activeEnvLabel = computed(() =>
  ENV_SEGMENTS[activeEnvironment.value]?.label ?? activeEnvironment.value ?? ''
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

/** Display labels for well-known identity set IDs */
const SET_LABELS: Record<string, string> = {
  k8s: "Kubernetes",
  aws: "AWS",
  gcp: "GCP",
  azure: "Azure",
};

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

// Computed value for the right pane based on selected stream
const activeStreamValues = computed(() => {
  if (!selectedFieldAnalytics.value?.sample_values || !activeStreamId.value || !activeStreamType.value) {
    return [];
  }
  return selectedFieldAnalytics.value.sample_values[activeStreamType.value]?.[activeStreamId.value] || [];
});

/** Active environment tab - auto-selects first detected environment */
const activeEnvironment = ref<string>("");

/** Map of group_id first segment -> environment key */
const ENV_SEGMENTS: Record<string, { key: string; label: string }> = {
  k8s:    { key: "k8s",   label: "K8s" },
  aws:    { key: "aws",   label: "AWS" },
  azure:  { key: "azure", label: "Azure" },
  gcp:    { key: "gcp",   label: "GCP" },
};

/** Gets the environment key for a group_id using its first dash-separated segment */
function groupEnvKey(groupId: string): string | null {
  const seg = groupId.split('-')[0];
  return ENV_SEGMENTS[seg]?.key ?? null;
}

/** Coverage % for any given environment key (used for sorting tabs) */
function getEnvCoverage(envKey: string): number {
  if (!totalServices.value) return 0;
  const groups = envKey === "all"
    ? availableGroups.value
    : availableGroups.value.filter(g => groupEnvKey(g.group_id) === envKey);
  const coverages = groups
    .map(g => {
      const dim = dimensionAnalytics.value[g.group_id];
      return dim ? Math.round((dim.service_count / totalServices.value) * 100) : null;
    })
    .filter((v): v is number => v !== null);
  if (!coverages.length) return 0;
  return Math.round(coverages.reduce((a, b) => a + b, 0) / coverages.length);
}

/** Detected environments from available groups, sorted by decreasing coverage */
const detectedEnvironments = computed(() => {
  const seen = new Set<string>();
  const envs: { key: string; label: string }[] = [];
  for (const group of availableGroups.value) {
    const key = groupEnvKey(group.group_id);
    if (key && !seen.has(key)) {
      seen.add(key);
      envs.push(ENV_SEGMENTS[group.group_id.split('-')[0]]);
    }
  }
  if (envs.length === 0) return [{ key: "all", label: "All" }];
  // Sort by coverage descending so most-used environment appears first
  return envs.sort((a, b) => getEnvCoverage(b.key) - getEnvCoverage(a.key));
});

/** Groups visible in the currently active environment tab */
const activeEnvGroups = computed(() => {
  if (!activeEnvironment.value || activeEnvironment.value === "all") return availableGroups.value;
  return availableGroups.value.filter(g => groupEnvKey(g.group_id) === activeEnvironment.value);
});

/** Auto-select first detected environment when data loads */
watch(detectedEnvironments, (envs) => {
  if (envs.length > 0 && !envs.some(e => e.key === activeEnvironment.value)) {
    activeEnvironment.value = envs[0].key;
  }
}, { immediate: true });

/** Reset suggestion + add state when switching tabs */
watch(activeEnvironment, () => {
  suggestionDismissed.value = false;
  addingToEnv.value = '';
  addFieldValue.value = '';
});

/** Coverage % badge value for the active environment tab */
const activeEnvCoverage = computed(() => {
  if (!totalServices.value || activeEnvGroups.value.length === 0) return null;
  const coverages = activeEnvGroups.value
    .map(g => {
      const dim = dimensionAnalytics.value[g.group_id];
      return dim ? Math.round((dim.service_count / totalServices.value) * 100) : null;
    })
    .filter((v): v is number => v !== null);
  if (!coverages.length) return null;
  return Math.round(coverages.reduce((a, b) => a + b, 0) / coverages.length);
});



// ─── Emits ────────────────────────────────────────────────────────────────────

const emit = defineEmits<{
  (e: "navigate-to-aliases", groupId: string): void;
}>();

// ─── Computed ─────────────────────────────────────────────────────────────────

/** The FoundGroup for the "service" group (used for stream type chips) */
const serviceGroup = computed<FoundGroup | undefined>(() =>
  availableGroups.value.find((g) => g.group_id === "service")
);
const serviceGroupDisplay = computed(() => serviceGroup.value?.display ?? "Service");
const serviceGroupStreamTypes = computed(() => serviceGroup.value?.stream_types ?? []);

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
      return analytics?.value_children?.[popupPrimaryValue.value]?.[col.group_id] ?? [];
    }
    // No primary selected — union all secondary values
    const analytics = dimensionAnalytics.value[primaryDim.value.group_id];
    const all = new Set<string>();
    for (const children of Object.values(analytics?.value_children ?? {})) {
      for (const v of (children[col.group_id] ?? [])) all.add(v);
    }
    return [...all].sort();
  }

  const prevSelection = popupColumnSelections.value[colIndex - 1];
  const prevCol = popupColumns.value[colIndex - 1];
  const prevAnalytics = dimensionAnalytics.value[prevCol.group_id];

  if (!prevSelection) {
    const all = new Set<string>();
    for (const children of Object.values(prevAnalytics?.value_children ?? {})) {
      for (const v of (children[col.group_id] ?? [])) all.add(v);
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
  const serviceDim = dimensionAnalytics.value['service'];
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

  if (env === "k8s") {
    envType = "Kubernetes";
    description = "Kubernetes fields detected in your telemetry data.";
    evidenceGroups = activeEnvGroups.value.filter(g => g.group_id.startsWith('k8s-')).map(g => g.group_id);
  } else if (env === "aws") {
    const isEcs = activeEnvGroups.value.some(g => g.group_id.startsWith('aws-ecs-'));
    envType = isEcs ? "AWS ECS" : "AWS";
    description = `${envType} fields detected in your telemetry data.`;
    evidenceGroups = activeEnvGroups.value.filter(g => g.group_id.startsWith('aws-')).map(g => g.group_id);
  } else if (env === "gcp") {
    envType = "GCP";
    description = "GCP fields detected in your telemetry data.";
    evidenceGroups = activeEnvGroups.value.filter(g => g.group_id.startsWith('gcp-')).map(g => g.group_id);
  } else if (env === "azure") {
    envType = "Azure";
    description = "Azure fields detected in your telemetry data.";
    evidenceGroups = activeEnvGroups.value.filter(g => g.group_id.startsWith('azure-')).map(g => g.group_id);
  }

  return {
    environment_type: envType,
    description: description,
    evidence_groups: evidenceGroups.slice(0, 3)
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
    VeryLow: 1, Low: 2, Medium: 3, High: 4, VeryHigh: 5,
  };

  // Score each group in the active environment using actual analytics data
  const scored = envGroups
    .map(g => {
      const a = analytics[g.group_id];
      // Prefer dimensionAnalytics cardinality_class; fall back to available_groups field
      const cardClass = a?.cardinality_class ?? g.cardinality_class ?? "Medium";
      const cardRank = CARD_RANK[cardClass] ?? 3;
      // Coverage = fraction of services that carry this field
      const coverage = a && totalServices.value > 0
        ? Math.round((a.service_count / totalServices.value) * 100)
        : (g.recommended ? 100 : 0);
      const streamCount = g.stream_types?.length ?? 0;
      return { id: g.group_id, cardRank, cardClass, coverage, streamCount };
    })
    // Exclude high-cardinality fields (they make bad disambiguation keys)
    .filter(s => s.cardRank <= 3)
    // Prefer fields that appear across multiple stream types (more reliable for correlation)
    .sort((a, b) => {
      if (a.cardRank !== b.cardRank) return a.cardRank - b.cardRank;
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      return b.streamCount - a.streamCount;
    });

  if (scored.length === 0) return null;

  const suggested = scored.slice(0, 3).map(s => s.id);

  // Build evidence string from actual numbers
  const top = scored.slice(0, suggested.length);
  const bestCard = top[0]?.cardClass ?? "";
  const minCoverage = Math.min(...top.map(s => s.coverage));
  const allStreamTypes = [...new Set(top.flatMap(s => {
    const g = envGroups.find(g => g.group_id === s.id);
    return g?.stream_types ?? [];
  }))];

  const parts: string[] = [];
  if (bestCard) parts.push(`${bestCard} cardinality`);
  if (minCoverage > 0) parts.push(`${minCoverage}% coverage`);
  if (allStreamTypes.length > 1) {
    parts.push(`across ${allStreamTypes.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')}`);
  }

  return {
    distinguish_by: suggested,
    reason: parts.length > 0 ? `${parts.join(' · ')} — ideal for service disambiguation` : "Recommended based on field coverage in your streams.",
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
    const cardRank: Record<string, number> = { "VeryLow": 1, "Low": 2, "Medium": 3, "High": 4, "VeryHigh": 5, "Unknown": 6 };
    const aCR = cardRank[a.cardinality_class || "Unknown"] || 6;
    const bCR = cardRank[b.cardinality_class || "Unknown"] || 6;
    return aCR - bCR;
  });
});

const primaryDim = computed<FoundGroup | undefined>(() => rankedDims.value[0]);
const secondaryDim = computed<FoundGroup | undefined>(() => rankedDims.value[1]);
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
const primaryDimCards = computed<Record<string, { childValues: string[]; tertiaryValues: Record<string, string[]> }>>(() => {
  const primary = primaryDim.value;
  if (!primary) return {};
  const analytics = dimensionAnalytics.value[primary.group_id];
  const secondary = secondaryDim.value;
  const tertiary = tertiaryDim.value;

  const result: Record<string, { childValues: string[]; tertiaryValues: Record<string, string[]> }> = {};

  // Find primary values to show as cards
  let primaryValues: string[] = [];
  if (analytics?.value_children && Object.keys(analytics.value_children).length > 0) {
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
    primaryValues = [...primaryValues].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
  }

  // Cap at 20 cards to prevent UI lag
  for (const val of primaryValues.slice(0, 20)) {
    const childMap = analytics?.value_children?.[val];
    const childValues = secondary ? (childMap?.[secondary.group_id] ?? []).slice().sort() : [];
    
    const tertiaryValues: Record<string, string[]> = {};
    if (tertiary && secondary) {
      for (const sVal of childValues) {
        const sAnalytics = dimensionAnalytics.value[secondary.group_id];
        if (sAnalytics?.value_children?.[sVal]) {
           tertiaryValues[sVal] = (sAnalytics.value_children[sVal][tertiary.group_id] ?? []).slice().sort();
        }
      }
    }
    result[val] = { childValues, tertiaryValues };
  }
  
  return result;
});


// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Find a FoundGroup by its group_id value */
function getGroupByValue(value: string): FoundGroup | undefined {
  return availableGroups.value.find((g) => g.group_id === value);
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
  if (val.toLowerCase().endsWith("sh") || val.toLowerCase().endsWith("ch") || val.toLowerCase().endsWith("s")) return val + "es";
  return val + "s";
}

/** Returns a Quasar color token for a cardinality class */
function cardinalityColor(cardClass: string): string {
  const map: Record<string, string> = {
    VeryLow: "positive",
    Low: "positive",
    Medium: "warning",
    High: "negative",
    VeryHigh: "negative"
  };
  return map[cardClass] ?? "grey";
}

/** Get the best available cardinality class for a group */
function getEffectiveCardinalityClass(group?: FoundGroup): string {
  if (!group) return "Unknown";
  return dimensionAnalytics.value[group.group_id]?.cardinality_class || group.cardinality_class || "Unknown";
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
function getValueCoverage(group: FoundGroup | undefined, value: string): number | null {
  if (!group) return null;
  const dim = dimensionAnalytics.value[group.group_id];
  if (!dim?.value_counts || !dim.service_count) return null;
  const count = dim.value_counts[value];
  if (count == null) return null;
  return Math.round((count / dim.service_count) * 100);
}

// ─── Field Management ─────────────────────────────────────────────────────────

/** Generate a unique group ID for a manually-added group */
function generateGroupId(): string {
  const existing = Object.keys(setDistinguishBy.value).filter(k => k.startsWith('custom-'));
  const next = existing.length + 1;
  return `custom-${next}`;
}

/** Remove a field by its group_id from a specific env's distinguish_by */
function removeFieldByIdFromEnv(envKey: string, fieldId: string) {
  const current = setDistinguishBy.value[envKey] ?? [];
  setDistinguishBy.value = {
    ...setDistinguishBy.value,
    [envKey]: current.filter(id => id !== fieldId),
  };
}

/** Options for the inline "add field" select for a specific env */
function getAddFieldOptionsForEnv(envKey: string) {
  const envFields = setDistinguishBy.value[envKey] ?? [];
  const used = new Set([nameField, ...envFields.filter(Boolean)]);
  return availableGroups.value
    .filter(g => !used.has(g.group_id))
    .map(g => ({
      label: g.display,
      value: g.group_id,
      streamTypes: g.stream_types,
      recommended: g.recommended,
    }));
}

/** Called when user picks a field in the inline select for a specific env */
function onAddFieldToEnv(envKey: string, val: string) {
  if (!val) return;
  const current = setDistinguishBy.value[envKey] ?? [];
  setDistinguishBy.value = {
    ...setDistinguishBy.value,
    [envKey]: [...current.filter(Boolean), val],
  };
  addFieldValue.value = '';
  addingToEnv.value = '';
}

function applySuggestion() {
  if (suggestedConfig.value?.distinguish_by?.length) {
    distinguishBy.value = [...suggestedConfig.value.distinguish_by];
  }
  addingToEnv.value = '';
  suggestionDismissed.value = true;
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

function openFieldDetails(field: FoundGroup, streamType: string = "", value: string = "") {
  selectedField.value = field;
  selectedStreamType.value = streamType;
  activeStreamId.value = "";
  activeStreamType.value = streamType;
  preselectedValue.value = value;
  popupPrimaryValue.value = "";
  popupColumnSelections.value = [];

  // Determine clicked field's position in the hierarchy and pre-select accordingly
  if (value && primaryDim.value) {
    const fieldIdx = rankedDims.value.findIndex(d => d.group_id === field.group_id);
    if (fieldIdx === 0) {
      // Clicked on primary dim (e.g. cluster) — set as primary value
      popupPrimaryValue.value = value;
    } else if (fieldIdx > 0) {
      // Clicked on secondary/tertiary — pre-select in the matching column (fieldIdx - 1)
      const selections: (string | null)[] = new Array(rankedDims.value.length - 1).fill(null);
      selections[fieldIdx - 1] = value;
      popupColumnSelections.value = selections;
    }
  }

  // Auto-select a stream — prefer one that contains the preselected value
  if (selectedFieldAnalytics.value?.sample_values) {
    const sampleValues = selectedFieldAnalytics.value.sample_values;
    const types = Object.keys(sampleValues);
    const typeToUse = streamType && types.includes(streamType) ? streamType : types[0];

    if (typeToUse) {
      activeStreamType.value = typeToUse;
      const streamEntries = Object.entries(sampleValues[typeToUse] ?? {});

      // If a specific value was clicked, prefer the stream that contains it
      const matchingStream = value
        ? streamEntries.find(([, vals]) => vals.includes(value))
        : null;

      const streamName = matchingStream
        ? matchingStream[0]
        : streamEntries[0]?.[0] ?? "";

      activeStreamId.value = streamName;
    }
  }

  detailsDialogVisible.value = true;

  // Scroll the highlighted value into view after the dialog renders
  if (value) {
    nextTick(() => {
      const el = valuesScrollContainer.value?.querySelector(`[data-val="${CSS.escape(value)}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function loadData() {
  loading.value = true;
  try {
    // 1. Load Analytics (which now includes available_groups)
    const analyticsRes = await serviceStreamsService.getDimensionAnalytics(props.orgIdentifier);
    const summary: DimensionAnalyticsSummary = analyticsRes.data;
    
    availableGroups.value = summary.available_groups ?? [];
    
    if (summary.dimensions) {
      dimensionAnalytics.value = summary.dimensions.reduce((acc, dim) => {
        acc[dim.dimension_name] = dim;
        return acc;
      }, {} as Record<string, DimensionAnalytics>);
    }

    // 2. Load Current Config
    const configRes = await serviceStreamsService.getIdentityConfig(props.orgIdentifier);
    currentIdentityConfig.value = configRes.data;

    // Populate per-set distinguish_by from the loaded config
    if (currentIdentityConfig.value?.sets?.length) {
      const byId: Record<string, string[]> = {};
      for (const set of currentIdentityConfig.value.sets) {
        byId[set.id] = [...set.distinguish_by];
      }
      setDistinguishBy.value = byId;
    }

    // 3. Initial suggestion for active env if no config exists for it
    if (
      activeEnvironment.value &&
      !setDistinguishBy.value[activeEnvironment.value]?.length &&
      suggestedConfig.value?.distinguish_by?.length
    ) {
      setDistinguishBy.value[activeEnvironment.value] = [...suggestedConfig.value.distinguish_by];
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
    const res = await serviceStreamsService.getDimensionAnalytics(props.orgIdentifier);
    const summary: DimensionAnalyticsSummary = res.data;
    if (summary.dimensions) {
      dimensionAnalytics.value = summary.dimensions.reduce((acc, dim) => {
        acc[dim.dimension_name] = dim;
        return acc;
      }, {} as Record<string, DimensionAnalytics>);
    }
  } catch (err) {
    console.error("Failed to load dimension analytics:", err);
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    // Build sets array: include only sets that have at least 1 non-empty distinguish_by field.
    // Set label uses SET_LABELS lookup for known IDs, falls back to the ID itself.
    const sets: IdentitySet[] = Object.entries(setDistinguishBy.value)
      .map(([id, fields]) => ({
        id,
        label: SET_LABELS[id] ?? id,
        distinguish_by: fields.filter(Boolean),
      }))
      .filter((s) => s.distinguish_by.length > 0);

    if (sets.length === 0) {
      $q.notify({
        type: "warning",
        message: t(
          "settings.correlation.identityConfigNoSets",
          "Configure at least one identity set before saving."
        ),
        timeout: 3000,
      });
      return;
    }

    const payload: ServiceIdentityConfig = { sets };

    await serviceStreamsService.saveIdentityConfig(props.orgIdentifier, payload);

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
</style>
