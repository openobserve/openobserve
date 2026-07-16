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
  <ODrawer
    data-test="schema-drawer"
    :open="open"
    :width="60"
    :title="indexData.name"
    :title-data-test="'schema-title-text'"
    :sub-title="t('logStream.schemaHeader')"
    @update:open="$emit('update:open', $event)"
  >
    <!-- Timeline / time-range chip sits at the right of the header, next to the
         close button; the stream name is the title and "Stream Detail" the
         subtitle (structured ODrawer header). -->
    <template #header-right>
      <div
        v-if="indexData.name"
        :class="[
          'flex items-center gap-1.5 px-2 py-1 rounded-md border',
          store.state.theme === 'dark'
            ? 'bg-gray-800/50 border-gray-600'
            : 'bg-gray-50 border-gray-200',
        ]"
      >
        <img
          :src="getTimelineIcon"
          alt="Timeline Icon"
          class="w-[14px] h-[14px] opacity-70"
        />
        <div class="flex items-center gap-1.5">
          <span
            :class="[
              'text-[10px] font-medium px-1.5 py-0.5 rounded',
              store.state.theme === 'dark'
                ? 'text-gray-300 bg-gray-700/50'
                : 'text-gray-600 bg-gray-100',
            ]"
          >
            UTC
          </span>
          <div
            :class="[
              'text-xs font-semibold',
              store.state.theme === 'dark' ? 'text-gray-200' : 'text-gray-800',
            ]"
          >
            {{ indexData.stats.doc_time_min }}
            <span class="text-base leading-none">→</span>
            {{ indexData.stats.doc_time_max }}
          </div>
        </div>
      </div>
    </template>

    <div v-if="indexData.schema">
      <div class="m-0 p-0">
        <div @submit.prevent="onSubmit">
          <!-- we will show loading state here -->
          <div
            v-if="loadingState"
            class="flex items-center justify-center w-full h-full"
            style="min-height: calc(100vh - 3.75rem)"
          >
            <OSpinner size="md" />
          </div>
          <!-- if we have data and no loading then we will show the data otherwise we will show the loading state -->
          <div
            v-else
            class="indexDetailsContainer w-full flex flex-col min-h-0"
            style="height: calc(100vh - 3.75rem)"
          >
            <!-- this the grid section the tiles section -->
            <div class="stats-grid grid grid-cols-4 gap-2 mb-2">
              <!-- Docs Count Tile -->
              <div
                v-if="store.state.zoConfig.show_stream_stats_doc_num"
                class="tile"
                data-test="docs-count-tile"
              >
                <div
                  class="tile-content rounded-lg p-3 text-center border shadow-sm h-20 flex flex-col justify-between"
                  :class="
                    store.state.theme === 'dark'
                      ? 'tile-content-dark border-gray-700'
                      : 'tile-content-light border-gray-200'
                  "
                >
                  <div
                    class="tile-header flex justify-between items-start"
                  >
                    <div
                      class="tile-title text-xs font-bold text-left"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-gray-400'
                          : 'text-gray-500'
                      "
                    >
                      Events
                    </div>
                    <div class="tile-icon opacity-80">
                      <img
                        src="@/assets/images/home/records.svg"
                        alt="Records Icon"
                        class="h-6 w-6"
                      />
                    </div>
                  </div>
                  <div
                    class="tile-value text-lg flex items-end justify-start"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-white'
                        : 'text-gray-900'
                    "
                  >
                    {{
                      parseInt(indexData.stats.doc_num).toLocaleString("en-US")
                    }}
                  </div>
                </div>
              </div>
              <!-- Storage Size Tile -->
              <div class="tile" data-test="storage-size-tile">
                <div
                  class="tile-content rounded-lg p-3 text-center border shadow-sm h-20 flex flex-col justify-between"
                  :class="
                    store.state.theme === 'dark'
                      ? 'tile-content-dark border-gray-700'
                      : 'tile-content-light border-gray-200'
                  "
                >
                  <div
                    class="tile-header flex justify-between items-start"
                  >
                    <div
                      class="tile-title text-xs font-bold text-left"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-gray-400'
                          : 'text-gray-500'
                      "
                    >
                      {{ t("logStream.storageSize") }}
                    </div>
                    <div class="tile-icon opacity-80">
                      <img
                        src="@/assets/images/home/ingested_size.svg"
                        alt="Ingested Size Icon"
                        class="h-6 w-6"
                      />
                    </div>
                  </div>
                  <div
                    class="tile-value text-lg flex items-end justify-start"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-white'
                        : 'text-gray-900'
                    "
                  >
                    {{ formatSizeFromMB(indexData.stats.storage_size) }}
                  </div>
                </div>
              </div>
              <!-- Compressed Size Tile -->
              <div
                v-if="isCloud !== 'true'"
                class="tile"
                data-test="compressed-size-tile"
              >
                <div
                  class="tile-content rounded-lg p-3 text-center border shadow-sm h-20 flex flex-col justify-between"
                  :class="
                    store.state.theme === 'dark'
                      ? 'tile-content-dark border-gray-700'
                      : 'tile-content-light border-gray-200'
                  "
                >
                  <div
                    class="tile-header flex justify-between items-start"
                  >
                    <div
                      class="tile-title text-xs font-bold text-left"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-gray-400'
                          : 'text-gray-500'
                      "
                    >
                      {{ t("logStream.compressedSize") }}
                    </div>
                    <div class="tile-icon opacity-80">
                      <img
                        src="@/assets/images/home/compressed_size.svg"
                        alt="Compressed Size Icon"
                        class="h-6 w-6"
                      />
                    </div>
                  </div>
                  <div
                    class="tile-value text-lg flex items-end justify-start"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-white'
                        : 'text-gray-900'
                    "
                  >
                    {{ formatSizeFromMB(indexData.stats.compressed_size) }}
                  </div>
                </div>
              </div>
              <!-- Index Size Tile -->
              <div
                v-if="isCloud !== 'true'"
                class="tile"
                data-test="index-size-tile"
              >
                <div
                  class="tile-content rounded-lg p-3 text-center border shadow-sm h-20 flex flex-col justify-between"
                  :class="
                    store.state.theme === 'dark'
                      ? 'tile-content-dark border-gray-700'
                      : 'tile-content-light border-gray-200'
                  "
                >
                  <div
                    class="tile-header flex justify-between items-start"
                  >
                    <div
                      class="tile-title text-xs font-bold text-left"
                      :class="
                        store.state.theme === 'dark'
                          ? 'text-gray-400'
                          : 'text-gray-500'
                      "
                    >
                      {{ t("logStream.indexSize") }}
                    </div>
                    <div class="tile-icon opacity-80">
                      <img
                        src="@/assets/images/home/index_size.svg"
                        alt="Index Size Icon"
                        class="h-6 w-6"
                      />
                    </div>
                  </div>
                  <div
                    class="tile-value text-lg flex items-end justify-start"
                    :class="
                      store.state.theme === 'dark'
                        ? 'text-white'
                        : 'text-gray-900'
                    "
                  >
                    {{ formatSizeFromMB(indexData.stats.index_size) }}
                  </div>
                </div>
              </div>
            </div>
            <div class="w-full flex flex-1 min-h-0 gap-2">
              <!--  left section(includes tabs and schema settings) -->
              <div
                :class="[
                  'w-[100%] h-full min-h-0 rounded-lg border shadow-sm p-2 flex flex-col overflow-hidden',
                  store.state.theme === 'dark'
                    ? 'bg-[#181A1B] border-gray-700'
                    : 'bg-white border-gray-200',
                ]"
              >
                <div>
                  <div class="flex justify-start">
                    <OTabs v-model="activeMainTab" dense>
                      <!-- Schema Settings Tab with conditional class -->
                      <OTab
                        name="schemaSettings"
                        icon="settings"
                        label="Schema Settings"
                        data-test="schema-settings-tab"
                      />

                      <!-- Red Button Tab -->
                      <OTab
                        name="redButton"
                        icon="backup"
                        label="Extended Retention"
                        data-test="schema-extended-retention-tab"
                      />

                      <!-- Configuration Tab -->
                      <OTab
                        name="configuration"
                        icon="tune"
                        label="Configuration"
                        data-test="schema-configuration-tab"
                      />
                      <!-- Cross-Linking Tab -->
                      <OTab
                        v-if="
                          isCrossLinkingEnabledForStream(
                            store.state.zoConfig,
                            indexData.stream_type,
                          )
                        "
                        name="crossLinking"
                        icon="link"
                        :label="t('crossLinks.header')"
                        data-test="schema-cross-linking-tab"
                      />
                    </OTabs>
                  </div>
                </div>
                <!-- Tab content wrapper — fills remaining height, pushes the footer to the bottom -->
                <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
                <!-- schema settings tab -->
                <div v-if="activeMainTab == 'schemaSettings'" class="flex flex-col h-full min-h-0 overflow-hidden">
                  <div
                    class="flex justify-between items-center"
                    data-test="schema-log-stream-mapping-title-text"
                  >
                    <div
                      v-if="indexData.defaultFts"
                      style="font-weight: 400"
                      class="mt-[12px]"
                    >
                      <label
                        style="font-weight: 600"
                        class="bg-[#f9f290] py-1 px-4 rounded border border-[#f5a623] text-[#865300]"
                      >
                        {{ t("logStream.mapping") }} Default FTS keys used (no
                        custom keys set).</label
                      >
                    </div>
                  </div>
                  <div class="flex justify-between items-center w-full">
                    <div class="flex items-center">
                      <div class="app-tabs-container">
                        <OToggleGroup
                          v-if="isSchemaUDSEnabled"
                          data-test="schema-fields-tabs"
                          :model-value="activeTab"
                          @update:model-value="updateActiveTab"
                        >
                          <OToggleGroupItem
                            v-if="hasUserDefinedSchema"
                            value="schemaFields"
                            size="sm"
                          >
                            <template #icon-left
                              ><OIcon name="verified-user" size="sm"
                            /></template>
                            User Defined Schema ({{
                              indexData.defined_schema_fields.length
                            }})
                          </OToggleGroupItem>
                          <OToggleGroupItem value="allFields" size="sm">
                            <template #icon-left
                              ><OIcon name="format-list-bulleted" size="sm"
                            /></template>
                            {{ computedSchemaFieldsName }} ({{
                              indexData.schema.length
                            }})
                          </OToggleGroupItem>
                        </OToggleGroup>
                      </div>

                      <div v-if="hasUserDefinedSchema" class="ml-2 flex items-center">
                        <OIcon
                          name="info"
                          size="sm"
                          style="color: #f5a623; cursor: pointer"
                        />
                        <OTooltip
                          side="right"
                          content="Other fields show only the schema fields that existed before the stream was configured to use a user-defined schema."
                        />
                      </div>
                    </div>

                    <div class="flex items-center gap-2">
                      <OSearchInput
                        data-test="schema-field-search-input"
                        v-model="filterField"
                        data-cy="schema-index-field-search-input"
                        class="ml-auto no-border o2-search-input"
                        :placeholder="t('search.searchField')"
                      />
                      <OButton
                        v-if="isSchemaUDSEnabled"
                        data-test="schema-add-fields-title"
                        :disabled="isDialogOpen"
                        variant="outline"
                        size="icon-sm"
                        class="my-2"
                        @click.stop="openDialog"
                        title="Add Field(s)"
                        icon-left="add"
                      />
                    </div>
                  </div>

                  <div class="mb-3" v-if="isDialogOpen">
                    <OCard class="add-fields-card">
                      <!-- Header Section -->
                      <OCardSection
                        class="p-0"
                        style="padding: 4px 16px 4px 16px"
                      >
                        <div class="flex justify-between items-center">
                          <div class="text-xl font-semibold">Add Field(s)</div>
                          <div>
                            <OButton
                              data-test="add-stream-cancel-btn"
                              variant="ghost"
                              size="icon-sm"
                              @click="closeDialog"
                              icon-left="close"
                            />
                          </div>
                        </div>
                      </OCardSection>
                      <!-- Main Content (Scrollable if necessary) -->
                      <OCardSection
                        class="p-0"
                        style="
                          flex: 1;
                          overflow-y: auto;
                          padding: 0px 16px 0px 16px;
                          margin-bottom: 2px;
                        "
                      >
                        <OForm
                          :form="newSchemaFieldsForm"
                          @keyup="onAddFieldsKeyup"
                        >
                          <StreamFieldsInputs
                            form-field-name="newSchemaFields"
                            :showHeader="false"
                            :visibleInputs="{
                              name: true,
                              data_type: true,
                              index_type: false,
                            }"
                          />
                        </OForm>
                      </OCardSection>
                    </OCard>
                  </div>

                  <!-- OTable fills the remaining height inside the schemaSettings flex column -->
                  <div
                    :class="[
                      'flex-1 min-h-0 flex flex-col overflow-hidden',
                      store.state.theme === 'dark'
                        ? 'dark-theme-table'
                        : 'light-theme-table',
                    ]"
                  >
                    <OTable
                      data-test="schema-log-stream-field-mapping-table"
                      :data="filteredSchemaData"
                      :columns="columns"
                      row-key="name"
                      selection="multiple"
                      :selected-ids="selectedSchemaIds"
                      :is-row-selectable="isSchemaRowSelectable"
                      @update:selected-ids="handleSchemaSelectedIdsUpdate"
                      @selection-change="handleSchemaSelectionChange"
                      pagination="client"
                      :page-size="selectedPerPage"
                      :page-size-options="perPageOptionsList"
                      :show-global-filter="false"
                      :default-columns="false"
                      dense
                      class="o2-schema-table"
                      :style="{ height: '100%', width: '100%' }"
                    >
                      <template #cell-name="{ row }">
                        <div class="flex items-center">
                          <span class="field-name-text" :data-test="`schema-field-name-cell-${row.name}`">
                            {{ row.name }}
                          </span>
                          <span
                            v-if="isEnvQuickModeField(row.name)"
                            class="flex items-center ml-1"
                          >
                            <img
                              :src="quickModeIcon"
                              :alt="t('logStream.envQuickModeMsg')"
                              class="w-[20px] h-[20px]"
                            />
                            <OTooltip class="text-[12px] w-[200px]">
                              {{ t("logStream.envQuickModeMsg") }}
                            </OTooltip>
                          </span>
                        </div>
                      </template>
                      <template #cell-settings="{ row }">
                        <template v-if="row.isUserDefined">
                          <OIcon name="person" size="xs" />
                          <OIcon name="schema" size="xs" />
                        </template>
                      </template>
                      <template #cell-type="{ row }">
                        <OTag type="fieldType" :value="row.type" />
                      </template>
                      <template #cell-index_type="{ row }">
                        <div
                          v-if="
                            !(
                              row.name ==
                                store.state.zoConfig.timestamp_column ||
                              row.name == allFieldsName
                            )
                          "
                          class="flex items-center gap-1"
                        >
                          <OSelect
                            :model-value="computedIndexType({ row }).value"
                            :options="indexTypeOptionsForRow(row)"
                            label-key="label"
                            value-key="value"
                            class="min-h-[24px]! max-h-[24px]! h-[24px]! text-[0.813rem]"
                            multiple
                            clearable
                            size="sm"
                            :data-test="`schema-field-${row.name}-index-type-select`"
                            style="width: 190px;"
                            @update:model-value="(val) => updateIndexType({ row }, enforceMaxIndexTypes(val))"
                          />
                          <OTooltip
                            v-if="row.index_type && row.index_type.length > 0"
                            :content="streamIndexType.filter(opt => row.index_type.includes(opt.value)).map(opt => opt.label).join(', ')"
                          />
                        </div>
                      </template>
                      <template #cell-patterns="{ row }">
                        <template
                          v-if="
                            config.isEnterprise == 'true' &&
                            !(
                              row.name == store.state.zoConfig.timestamp_column
                            ) &&
                            (row.type == 'Utf8' || row.type == 'utf8')
                          "
                        >
                          <span
                            class="text-[#5960B2] cursor-pointer"
                            :data-test="`schema-field-${row.name}-pattern-action`"
                            @click="openPatternAssociationDialog(row.name)"
                          >
                            {{
                              patternAssociations[row.name]?.length
                                ? `View ${patternAssociations[row.name]?.length} Patterns`
                                : "Add Pattern"
                            }}
                            <OIcon name="arrow-forward" size="xs" />
                          </span>
                        </template>
                      </template>
                    </OTable>
                  </div>
                </div>

                <!-- Configuration tab -->
                <div v-if="activeMainTab == 'configuration'">
                  <div class="w-full h-full overflow-y-auto p-4 flex flex-col gap-4">
                    <!-- Configuration Settings Card -->
                    <div class="rounded-lg border border-[var(--o2-border-color)] divide-y divide-[var(--o2-border-color)]">

                      <!-- Data Retention -->
                      <div v-if="showDataRetention" class="flex flex-col gap-1 p-3">
                        <label class="text-[0.8125rem] font-[500]" style="color: var(--o2-text-heading)">
                          Data Retention (days)
                        </label>
                        <OInput
                          data-test="stream-details-data-retention-input"
                          v-model="dataRetentionDays"
                          type="number"
                          min="1"
                          class="max-w-[220px]"
                          @update:model-value="markFormDirty"
                        />
                        <small v-if="dataRetentionDays > 0 && dataRetentionDays != ''">
                          Global retention is {{ store.state.zoConfig.data_retention_days }} days
                        </small>
                        <small v-if="dataRetentionDays <= 0 || dataRetentionDays == ''" class="text-[var(--o2-status-error-text)]">
                          Retention period must be at least 1 day
                        </small>
                      </div>

                      <!-- Max Query Range -->
                      <div class="flex flex-col gap-1 p-3">
                        <label class="text-[0.8125rem] font-[500]" style="color: var(--o2-text-heading)">
                          Max Query Range (hours)
                        </label>
                        <OInput
                          data-test="stream-details-max-query-range-input"
                          v-model="maxQueryRange"
                          type="number"
                          min="0"
                          class="max-w-[220px]"
                          @update:model-value="markFormDirty"
                        />
                        <small>Maximum time range allowed for queries. Set 0 for unlimited range.</small>
                      </div>

                      <!-- Flatten Level -->
                      <div class="flex flex-col gap-1 p-3">
                        <label class="text-[0.8125rem] font-[500]" style="color: var(--o2-text-heading)">
                          {{ t("logStream.flattenLevel") }}
                        </label>
                        <OInput
                          data-test="stream-details-flatten-level-input"
                          v-model="flattenLevel"
                          type="number"
                          min="0"
                          class="max-w-[220px]"
                          @update:model-value="markFormDirty"
                        />
                        <small>Global is {{ store.state.zoConfig.ingest_flatten_level || 3 }}</small>
                      </div>

                      <!-- Toggles -->
                      <div class="flex items-center justify-between px-3 py-2.5 text-[13px]">
                        <span>Use Stream Stats for Partitioning</span>
                        <OSwitch
                          data-test="log-stream-use_approx-toggle-btn"
                          v-model="approxPartition"
                          @update:model-value="formDirtyFlag = true"
                        />
                      </div>

                      <div v-if="showStoreOriginalDataToggle" class="flex items-center justify-between px-3 py-2.5 text-[13px]">
                        <span>Store Original Data</span>
                        <OSwitch
                          data-test="log-stream-store-original-data-toggle-btn"
                          v-model="storeOriginalData"
                          @update:model-value="formDirtyFlag = true"
                        />
                      </div>

                      <div class="flex items-center justify-between px-3 py-2.5 text-[13px]">
                        <span>Enable Distinct Values</span>
                        <OSwitch
                          data-test="log-stream-enabled-distinct-values-toggle-btn"
                          v-model="enableDistinctFields"
                          @update:model-value="formDirtyFlag = true"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <!-- red button tab -->
                <div
                  v-else-if="activeMainTab == 'redButton'"
                  class="flex flex-col h-full min-h-0 overflow-hidden"
                >
                  <div
                    class="bg-[#f9f290] py-1 px-4 rounded border border-[#f5a623] text-[#865300] mt-2"
                    style="width: fit-content"
                  >
                    <span style="font-weight: 600">
                      <OIcon name="info" class="mr-1" size="sm" />

                      Additional
                      {{
                        store.state.zoConfig.extended_data_retention_days
                      }}
                      days of extension will be applied to the selected date
                      ranges</span
                    >
                  </div>
                  <div class="mt-2 flex flex-col flex-1 min-h-0">
                    <div class="text-center mt-2 flex items-center">
                      <div class="flex items-center">
                        <span class="font-bold"> Select Date</span>
                        <date-time
                          class="mx-2"
                          @on:date-change="dateChangeValue"
                          disable-relative
                          hide-relative-time
                          hide-relative-timezone
                          :minDate="minDate"
                        />
                      </div>
                      <span class="font-bold"> (UTC Timezone) </span>
                    </div>

                    <div class="mt-2 flex-1 min-h-0 flex flex-col">
                      <OTable
                        data-test="schema-log-stream-field-mapping-table"
                        :data="redBtnRows"
                        :columns="redBtnColumns"
                        row-key="index"
                        selection="multiple"
                        v-model:selected-ids="selectedDateIds"
                        @selection-change="handleDateSelectionChange"
                        pagination="client"
                        :page-size="selectedPerPage"
                        :page-size-options="perPageOptionsList"
                        :show-global-filter="false"
                        :default-columns="false"
                        dense
                        :class="
                          store.state.theme == 'dark'
                            ? 'o2-last-row-border-dark o2-schema-table-header-sticky-dark'
                            : 'o2-last-row-border-light o2-schema-table-header-sticky-light'
                        "
                        :style="{ height: '100%' }"
                      />
                    </div>
                  </div>
                </div>

                <!-- cross-linking tab -->
                <div v-if="activeMainTab == 'crossLinking'">
                  <div class="p-4">
                    <!-- Stream-level cross-links (editable) -->
                    <CrossLinkManager
                      v-model="streamCrossLinks"
                      :title="t('crossLinks.streamCrossLinks')"
                      :subtitle="t('crossLinks.streamCrossLinksSubtitle')"
                      :availableFields="streamFieldNames"
                      @change="formDirtyFlag = true"
                    />

                    <!-- Organization-level cross-links (read-only, hidden when empty) -->
                    <template v-if="orgCrossLinks.length > 0">
                      <OSeparator class="my-4" />
                      <CrossLinkManager
                        :modelValue="orgCrossLinks"
                        :title="t('crossLinks.orgCrossLinks')"
                        :subtitle="t('crossLinks.orgCrossLinksSubtitle')"
                        readonly
                      />
                    </template>
                  </div>
                </div>

                </div>
                <!-- floating footer for the table -->
                <div class="floating-buttons flex-shrink-0 px-2 py-1">
                  <div
                    v-if="indexData.schema.length > 0"
                    class="flex items-center justify-between"
                  >
                    <div class="flex items-center gap-2">
                      <span
                        v-if="activeMainTab == 'schemaSettings'"
                        class="px-2 py-2"
                        ><strong> {{ selectedFields.length }}</strong> fields
                        selected</span
                      >
                      <OButton
                        v-if="
                          isSchemaUDSEnabled &&
                          activeMainTab == 'schemaSettings'
                        "
                        data-test="schema-add-field-button"
                        variant="outline"
                        size="sm-action"
                        :disabled="
                          !selectedFields.length || hasUDSFieldInSelection
                        "
                        @click="updateDefinedSchemaFields"
                      >
                        <span
                          class="flex items-center justify-start gap-1 mr-1"
                        >
                          <OIcon name="verified-user" size="sm" />
                          <OIcon name="format-list-bulleted" size="sm" />
                        </span>
                        {{
                          activeTab === "schemaFields"
                            ? t("logStream.removeSchemaField")
                            : t("logStream.addSchemaField")
                        }}
                        <OTooltip
                          v-if="hasUDSFieldInSelection"
                          :content="t('logStream.udsFieldAlreadyInSchema')"
                          side="top"
                        />
                      </OButton>
                      <OButton
                        v-if="
                          activeMainTab != 'configuration' &&
                          activeMainTab != 'crossLinking'
                        "
                        :disabled="
                          !selectedFields.length && !selectedDateFields.length
                        "
                        data-test="schema-delete-button"
                        variant="outline"
                        size="sm-action"
                        @click="
                          activeMainTab == 'schemaSettings'
                            ? (confirmQueryModeChangeDialog = true)
                            : (confirmDeleteDatesDialog = true)
                        "
                        icon-left="delete"
                      >
                        {{ t("logStream.delete") }}
                      </OButton>
                    </div>
                    <div class="flex justify-end gap-2">
                      <OButton
                        data-test="schema-cancel-button"
                        variant="outline"
                        size="sm-action"
                        @click="$emit('close')"
                      >
                        {{ t("logStream.cancel") }}
                      </OButton>
                      <OButton
                        :disabled="!formDirtyFlag"
                        data-test="schema-update-settings-button"
                        variant="primary"
                        size="sm-action"
                        @click="onSubmit"
                      >
                        {{ t("logStream.updateSettings") }}
                      </OButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="p-3">
      <h5>Wait while loading...</h5>
    </div>
  </ODrawer>
  <ODrawer
    data-test="schema-pattern-association-drawer"
    v-model:open="patternAssociationDialog.show"
    :width="60"
    :show-close="false"
  >
    <AssociatedRegexPatterns
      ref="assocPatternsRef"
      :data="patternAssociationDialog.data"
      :fieldName="patternAssociationDialog.fieldName"
      @closeDialog="patternAssociationDialog.show = false"
      @addPattern="handleAddPattern"
      @removePattern="handleRemovePattern"
      @updateSettings="onSubmit"
      @updateAppliedPattern="handleUpdateAppliedPattern"
    />
    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <OButton
          variant="outline"
          size="sm-action"
          data-test="schema-pattern-association-cancel-btn"
          @click="patternAssociationDialog.show = false"
        >
          Cancel
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          data-test="schema-pattern-association-update-btn"
          :disabled="!assocPatternsRef?.isFormDirty"
          @click="assocPatternsRef?.updateRegexPattern()"
        >
          Update Changes
        </OButton>
      </div>
    </template>
  </ODrawer>

  <ConfirmDialog
    title="Delete Action"
    :message="t('logStream.deleteActionMessage')"
    @update:ok="deleteFields()"
    @update:cancel="confirmQueryModeChangeDialog = false"
    v-model="confirmQueryModeChangeDialog"
  />
  <ConfirmDialog
    title="Delete Dates"
    :message="t('logStream.deleteDatesMessage')"
    @update:ok="deleteDates()"
    @update:cancel="confirmDeleteDatesDialog = false"
    v-model="confirmDeleteDatesDialog"
  />
  <PerformanceFieldsDialog
    v-model="confirmAddPerformanceFieldsDialog"
    :missing-fields="missingPerformanceFields"
    @add-fields="addPerformanceFields"
    @skip="skipPerformanceFields"
    @remove-field="removeFieldFromList"
  />
</template>

<script lang="ts">
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
// @ts-nocheck
import {
  computed,
  defineComponent,
  onBeforeMount,
  reactive,
  ref,
  onMounted,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import {
  convertUnixToDateFormat as convertUnixToFormat,
  formatTimestamp,
} from "@/utils/date";
import streamService from "../../services/stream";
import segment from "../../services/segment_analytics";
import {
  formatSizeFromMB,
  getImageURL,
  timestampToTimezoneDate,
  convertDateToTimestamp,
} from "@/utils/zincutils";
import config from "@/aws-exports";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import useStreams from "@/composables/useStreams";
import { useRouter } from "vue-router";
import StreamFieldsInputs from "@/components/logstream/StreamFieldInputs.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import { COL } from "@/lib/core/Table/OTable.types";
import CrossLinkManager from "@/components/cross-linking/CrossLinkManager.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

import DateTime from "@/components/DateTime.vue";

import AssociatedRegexPatterns from "./AssociatedRegexPatterns.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import PerformanceFieldsDialog from "./PerformanceFieldsDialog.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSearchInput from "@/lib/forms/SearchInput/OSearchInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import { useOForm } from "@/lib/forms/Form/useOForm";
import { makeSchemaFieldsSchema } from "./Schema.schema";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSeparator from '@/lib/core/Separator/OSeparator.vue';
import { isCrossLinkingEnabledForStream } from "@/utils/crossLinking";

const defaultValue: any = () => {
  return {
    name: "",
    schema: [],
    stats: {},
    defaultFts: false,
    defined_schema_fields: [],
  };
};

export default defineComponent({
  name: "SchemaIndex",
  emits: ["close", "update:open"],
  props: {
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
    open: {
      type: Boolean,
      default: false,
    },
  },
  components: {
    OSeparator,
    OTabs,
    OTab,
    ConfirmDialog,
    StreamFieldsInputs,
    OToggleGroup,
    OToggleGroupItem,
    OTable,
    OTag,
    DateTime,
    AssociatedRegexPatterns,
    ODrawer,
    PerformanceFieldsDialog,
    CrossLinkManager,
    OButton,
    OIcon,
    OSpinner,
    OInput,
    OSearchInput,
    OSelect,
    OSwitch,
    OTooltip,
    OCheckbox,
    OCard,
    OCardSection,
    OForm,
  },
  setup({ modelValue }) {
    type PatternAssociation = {
      field: string;
      pattern_name: string;
      pattern_id: string;
      policy: string;
      apply_at: string;
    };
    const { t } = useI18n();
    const store = useStore();
    const indexData: any = ref(defaultValue());
    const updateSettingsForm: any = ref(null);
    const isCloud = config.isCloud;
    const dataRetentionDays = ref(0);
    const storeOriginalData = ref(false);
    const enableDistinctFields = ref(false);
    const maxQueryRange = ref(0);
    const flattenLevel = ref(null);
    const confirmQueryModeChangeDialog = ref(false);
    const confirmDeleteDatesDialog = ref(false);
    const confirmAddPerformanceFieldsDialog = ref(false);
    const missingPerformanceFields = ref([]);
    const pendingSelectedFields = ref([]);
    const formDirtyFlag = ref(false);
    const loadingState = ref(true);
    const rowsPerPage = ref(20);
    const filterField = ref("");
    const router = useRouter();
    const qTable = ref(null);
    const minDate = ref(null);
    const selectedDateFields = ref([]);
    const IsdeleteBtnVisible = ref(false);
    const redBtnRows = ref([]);

    const patternIdToApplyAtMap = new Map();

    // The "Add Field(s)" rows are owned by a small TanStack form (StreamFieldInputs
    // is form-only now). Writes go through the form (push/remove/reset); reads use
    // the reactive `newSchemaFields` view below — single source of truth, no mirror.
    const newSchemaFieldsForm = useOForm<{ newSchemaFields: any[] }>({
      defaultValues: { newSchemaFields: [] },
      schema: makeSchemaFieldsSchema(t),
    });
    const newSchemaFields = newSchemaFieldsForm.useStore(
      (s: any) => s.values.newSchemaFields ?? [],
    );
    const activeMainTab = ref("schemaSettings");
    let previousSchemaVersion: any = null;
    const approxPartition = ref(false);

    const streamCrossLinks = ref<any[]>([]);
    const orgCrossLinks = computed(
      () =>
        store.state?.organizationData?.organizationSettings?.cross_links || [],
    );
    const streamFieldNames = computed(() =>
      (indexData.value.schema || []).map((f: any) => f.name).sort(),
    );
    const isDialogOpen = ref(false);
    // The child (StreamFieldInputs) owns row deletion now and no longer emits a
    // @remove event, so the parent can't run "close the dialog when the last row
    // is deleted" inline. Observe the row count instead: whenever the rows drain
    // to empty while the dialog is open, close it (restores main's behavior).
    watch(
      () => newSchemaFields.value.length,
      (len) => {
        if (isDialogOpen.value && len === 0) {
          isDialogOpen.value = false;
        }
      },
    );
    const patternAssociations = ref([]);
    const redDaysList = ref([]);
    const resultTotal = ref<number>(0);
    const perPageOptions: any = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 },
    ];

    const perPageOptionsList = [20, 50, 100, 250, 500];

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
    };

    const selectedPerPage = ref<number>(20);
    const pagination: any = ref({
      rowsPerPage: 20,
    });
    const patternAssociationDialog = ref({
      show: false,
      data: [],
      fieldName: "",
    });

    const assocPatternsRef = ref<any>(null);

    const selectedFields = ref([]);

    const filteredSchemaData = computed(() => {
      const rows = indexData.value.schema || [];
      if (!filterField.value && activeTab.value !== "schemaFields") return rows;

      const searchTerm = filterField.value?.toLowerCase() || "";
      const labelToValueMap: Record<string, string> = {};
      streamIndexType.forEach(({ label, value }: any) => {
        labelToValueMap[label.toLowerCase()] = value;
      });

      return rows.filter((row: any) => {
        if (activeTab.value === "schemaFields") {
          if (!indexData.value.defined_schema_fields.includes(row.name))
            return false;
        }
        if (!searchTerm) return true;
        if (row.name.toLowerCase().includes(searchTerm)) return true;
        return (row.index_type || []).some(
          (t: string) =>
            t.toLowerCase().includes(searchTerm) ||
            labelToValueMap[searchTerm] === t,
        );
      });
    });

    const selectedSchemaIds = computed({
      get: () => selectedFields.value.map((f: any) => f.name),
      set: (ids: string[]) => {
        const filteredIds = ids.filter(
          (id) =>
            id !== store.state.zoConfig.timestamp_column &&
            id !== allFieldsName.value,
        );
        selectedFields.value = (indexData.value.schema || []).filter(
          (row: any) => filteredIds.includes(row.name),
        );
      },
    });

    // The _timestamp and allFields rows are never part of the selection (they
    // are filtered out below). Tell the table they are non-selectable so the
    // header "Select All" toggle only considers real rows — otherwise it can
    // never reach a fully-selected state and stays stuck in select-only mode,
    // breaking deselect-all.
    const isSchemaRowSelectable = (row: any) =>
      row.name !== store.state.zoConfig.timestamp_column &&
      row.name !== allFieldsName.value;

    const handleSchemaSelectedIdsUpdate = (ids: string[]) => {
      selectedSchemaIds.value = ids;
    };

    const handleSchemaSelectionChange = (rows: any[]) => {
      selectedFields.value = rows.filter(
        (row: any) =>
          row.name !== store.state.zoConfig.timestamp_column &&
          row.name !== allFieldsName.value,
      );
    };

    const selectedDateIds = computed({
      get: () => selectedDateFields.value.map((f: any) => f.index),
      set: (ids: any[]) => {
        selectedDateFields.value = redBtnRows.value.filter((row: any) =>
          ids.includes(row.index),
        );
      },
    });

    const handleDateSelectionChange = (rows: any[]) => {
      selectedDateFields.value = rows;
    };

    const hasUserDefinedSchema = computed(() => {
      return !!indexData.value.defined_schema_fields?.length;
    });

    const hasUDSFieldInSelection = computed(() => {
      return (
        activeTab.value === "allFields" &&
        selectedFields.value.some((field: any) => field.isUserDefined)
      );
    });

    const allFieldsName = computed(() => {
      return store.state.zoConfig.all_fields_name;
    });
    //here we are setting the active tab based on the user defined schema
    //1. if there is UDS then it should be schemaFields
    //2. if there is no UDS then it should be allFields
    const activeTab = ref(
      hasUserDefinedSchema.value ? "schemaFields" : "allFields",
    );

    const tabs = computed(() => [
      {
        value: "schemaFields",
        label: `User Defined Schema (${indexData.value.defined_schema_fields.length})`,
        disabled: !hasUserDefinedSchema.value,
        hide: !hasUserDefinedSchema.value,
      },
      {
        value: "allFields",
        label: `${computedSchemaFieldsName} (${indexData.value.schema.length})`,
        disabled: false,
        hide: false,
      },
    ]);
    const mainTabs = computed(() => [
      {
        value: "schemaSettings",
        label: `Schema Settings`,
        disabled: false,
      },
      {
        value: "redButton",
        label: `Extended Retention`,
        disabled: false,
      },
    ]);
    // here we are setting the schema field name always be "All Fields"
    const computedSchemaFieldsName =  "All Fields";

    const streamIndexType = [
      { label: "Full text search", value: "fullTextSearchKey" },
      { label: "Secondary index", value: "secondaryIndexKey" },
      { label: "Bloom filter", value: "bloomFilterKey" },
      { label: "KeyValue partition", value: "keyPartition" },
      { label: "Prefix partition", value: "prefixPartition" },

      { label: "Hash partition (8 Buckets)", value: "hashPartition_8" },
      { label: "Hash partition (16 Buckets)", value: "hashPartition_16" },
      { label: "Hash partition (32 Buckets)", value: "hashPartition_32" },
      { label: "Hash partition (64 Buckets)", value: "hashPartition_64" },
      { label: "Hash partition (128 Buckets)", value: "hashPartition_128" },
    ];
    const { getStream, getUpdatedSettings } = useStreams();

    onBeforeMount(() => {
      dataRetentionDays.value = store.state.zoConfig.data_retention_days || 0;
      maxQueryRange.value = 0;
      storeOriginalData.value = false;
      enableDistinctFields.value = false;
      approxPartition.value = false;
    });

    const showStoreOriginalDataToggle = computed(() => {
      return modelValue.stream_type !== "traces";
    });
    //here we added a watcher to
    //1. if user defined schema is enabled then we need to show the schema fields tab and also need to make sure that it would be the active tab
    //2. if user defined schema is disabled then we need to show the all fields tab and also need to make sure that it would be the active tab
    watch(hasUserDefinedSchema, (newVal) => {
      if (newVal) {
        activeTab.value = "schemaFields";
      } else {
        activeTab.value = "allFields";
      }
    });

    // Watch activeTab and update resultTotal accordingly
    // This ensures resultTotal is always in sync with the active tab
    // If selected tab is schemaFields we will show the uds length otherwise we will show the actual schema length
    watch(
      activeTab,
      (newTab) => {
        if (newTab === "schemaFields") {
          resultTotal.value =
            indexData.value.defined_schema_fields?.length || 0;
        } else {
          resultTotal.value = indexData.value.schema?.length || 0;
        }
      },
      { immediate: true },
    );

    const isSchemaUDSEnabled = computed(() => {
      return store.state.zoConfig.user_defined_schemas_enabled;
    });

    const markFormDirty = () => {
      formDirtyFlag.value = true;
    };
    const deleteFields = async () => {
      loadingState.value = true;
      await streamService
        .deleteFields(
          store.state.selectedOrganization.identifier,
          indexData.value.name,
          indexData.value.stream_type,
          selectedFields.value.map((field) => field.name),
        )
        .then(async (res) => {
          loadingState.value = false;
          if (res.data.code == 200) {
            toast({
              message: "Field(s) deleted successfully.",
              variant: "success",
            });
            confirmQueryModeChangeDialog.value = false;
            selectedFields.value = [];
            await getStream(
              indexData.value.name,
              indexData.value.stream_type,
              true,
              true,
            );
            getSchema();
          } else {
            toast({
              message: res.data.message,
              variant: "error",
            });
          }
        })
        .catch((err: any) => {
          loadingState.value = false;
          toast({
            message: err.message,
            variant: "error",
          });
        });
    };

    const getFieldIndices = (property, settings) => {
      const fieldIndices = [];
      if (
        settings.full_text_search_keys.length > 0 &&
        settings.full_text_search_keys.includes(property.name)
      ) {
        fieldIndices.push("fullTextSearchKey");
      }

      if (
        settings.index_fields.length > 0 &&
        settings.index_fields.includes(property.name)
      ) {
        fieldIndices.push("secondaryIndexKey");
      }

      if (
        settings.bloom_filter_fields.length > 0 &&
        settings.bloom_filter_fields.includes(property.name)
      ) {
        fieldIndices.push("bloomFilterKey");
      }

      property["delete"] = false;

      if (
        settings.partition_keys &&
        Object.values(settings.partition_keys).some(
          (v) => !v.disabled && v.field === property.name,
        )
      ) {
        const [level, partition] = Object.entries(settings.partition_keys).find(
          ([, partition]) => partition["field"] === property.name,
        );

        property.level = level;

        if (partition.types === "value") fieldIndices.push("keyPartition");
        if (partition.types === "prefix") fieldIndices.push("prefixPartition");

        if (partition.types?.hash)
          fieldIndices.push(`hashPartition_${partition.types.hash}`);
      }

      property.index_type = [...fieldIndices];

      return fieldIndices;
    };

    const setSchema = (streamResponse) => {
      const schemaMapping = new Set([]);

      //here lets add the pattern associations to the streamResponse
      streamResponse.settings.pattern_associations =
        streamResponse.pattern_associations;
      if (streamResponse?.settings) {
        previousSchemaVersion = JSON.parse(
          JSON.stringify(streamResponse.settings),
        );
      }
      //after this we need to have a map of pattern_id and according to field as well
      //so that we can easily access the apply_at value for a pattern if it is undefined or null
      previousSchemaVersion.pattern_associations &&
        previousSchemaVersion.pattern_associations.forEach(
          (pattern: PatternAssociation) => {
            patternIdToApplyAtMap.set(
              pattern.field + pattern.pattern_id,
              pattern,
            );
          },
        );
      if (!streamResponse.schema?.length) {
        streamResponse.schema = [];
        if (streamResponse.settings.defined_schema_fields?.length)
          streamResponse.settings.defined_schema_fields.forEach((field) => {
            streamResponse.schema.push({
              name: field,
              delete: false,
              index_type: [],
            });
          });
      }
      if (Array.isArray(streamResponse.settings.extended_retention_days)) {
        redBtnRows.value = [];
        indexData.value.extended_retention_days =
          streamResponse.settings.extended_retention_days;
        streamResponse.settings.extended_retention_days.forEach(
          (field, index) => {
            redBtnRows.value.push({
              index: String(index),
              original_start: field.start,
              original_end: field.end,
              start: convertUnixToDateFormat(field.start),
              end: convertUnixToDateFormat(field.end),
            });
          },
        );
      }
      if (streamResponse.pattern_associations) {
        patternAssociations.value = groupPatternAssociationsByField(
          streamResponse.pattern_associations,
        );
        // Now you can quickly access patterns by field
      }

      if (
        streamResponse.settings.full_text_search_keys.length == 0 &&
        (showFullTextSearchColumn.value || showPartitionColumn.value)
      ) {
        indexData.value.defaultFts = true;
      } else {
        indexData.value.defaultFts = false;
      }

      indexData.value.schema = streamResponse.schema || [];
      indexData.value.stats = JSON.parse(JSON.stringify(streamResponse.stats));

      indexData.value.stats.original_doc_time_max =
        streamResponse.stats.doc_time_max;
      indexData.value.stats.original_doc_time_min =
        streamResponse.stats.doc_time_min;

      indexData.value.stats.doc_time_max = formatTimestamp(
        parseInt(streamResponse.stats.doc_time_max),
        "YYYY-MM-DDTHH:mm:ss:SS",
      );
      indexData.value.stats.doc_time_min = formatTimestamp(
        parseInt(streamResponse.stats.doc_time_min),
        "YYYY-MM-DDTHH:mm:ss:SS",
      );

      indexData.value.defined_schema_fields =
        streamResponse.settings.defined_schema_fields || [];

      // Populate stream-level cross-links
      streamCrossLinks.value = streamResponse.settings?.cross_links || [];

      if (showDataRetention.value)
        dataRetentionDays.value =
          streamResponse.settings.data_retention ||
          store.state.zoConfig.data_retention_days;
      calculateDateRange();

      maxQueryRange.value = streamResponse.settings.max_query_range || 0;
      flattenLevel.value = streamResponse.settings.flatten_level || null;
      storeOriginalData.value =
        streamResponse.settings.store_original_data || false;
      enableDistinctFields.value =
        streamResponse.settings.enable_distinct_fields || false;
      approxPartition.value = streamResponse.settings.approx_partition || false;

      if (!streamResponse.schema) {
        loadingState.value = false;
        dismiss();
        return;
      }

      let fieldIndices = [];
      for (var property of streamResponse.schema) {
        schemaMapping.add(property.name);

        fieldIndices = getFieldIndices(property, streamResponse.settings);

        property.index_type = [...fieldIndices];

        fieldIndices.length = 0;
      }

      indexData.value.defined_schema_fields.forEach((field) => {
        if (!schemaMapping.has(field)) {
          const property = {
            name: field,
            delete: false,
            index_type: [],
          };

          fieldIndices = getFieldIndices(property, streamResponse.settings);

          property.index_type = [...fieldIndices];

          fieldIndices.length = 0;
          indexData.value.schema.push(property);
        }
      });
    };

    const getSchema = async () => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading stats...",
              timeout: 0,
});

      await getStream(indexData.value.name, indexData.value.stream_type, true)
        .then((streamResponse) => {
          streamResponse = updateStreamResponse(streamResponse);
          setSchema(streamResponse);
          if (activeTab.value === "schemaFields") {
            resultTotal.value =
              streamResponse.settings?.defined_schema_fields?.length;
          } else {
            resultTotal.value = streamResponse.schema?.length;
          }
          loadingState.value = false;
          dismiss();
        })
        .catch((err) => {
          loadingState.value = false;
        });
    };

    const onSubmit = async () => {
      // Gate the save on the "Add Field(s)" rows (parity with AddStream): when the
      // dialog has rows, they must pass the schema (name required + valid chars
      // after normalization, data type required) before we merge them into
      // settings. handleSubmit() reveals the inline row errors (which are the
      // user-facing feedback — no toast needed) and an invalid row blocks the
      // save instead of silently pushing an invalid name (e.g. "user!id") into
      // defined_schema_fields. Empty when the dialog is closed, so a normal
      // settings save is unaffected.
      if (newSchemaFields.value.length > 0) {
        await newSchemaFieldsForm.handleSubmit();
        if (!newSchemaFieldsForm.state.isValid) {
          return;
        }
      }
      patternAssociations.value = ungroupPatternAssociations(
        patternAssociations.value,
      );
      let settings = {
        fields: [], // only used for add new fields
        partition_keys: [],
        index_fields: [],
        full_text_search_keys: [],
        bloom_filter_fields: [],
        defined_schema_fields: [...indexData.value.defined_schema_fields],
        extended_retention_days: [...indexData.value.extended_retention_days],
        pattern_associations: [...patternAssociations.value],
      };

      if (showDataRetention.value && dataRetentionDays.value < 1) {
        toast({
          message:
            "Invalid Data Retention Period: Retention period must be at least 1 day.",
          variant: "error",
        });
        return;
      }
      if (Number(maxQueryRange.value) > 0) {
        settings["max_query_range"] = Number(maxQueryRange.value);
      } else {
        settings["max_query_range"] = 0;
      }

      if (showDataRetention.value) {
        settings["data_retention"] = Number(dataRetentionDays.value);
        calculateDateRange();
      }

      settings["store_original_data"] = storeOriginalData.value;
      settings["enable_distinct_fields"] = enableDistinctFields.value;
      settings["approx_partition"] = approxPartition.value;

      if (flattenLevel.value !== null) {
        settings["flatten_level"] = Number(flattenLevel.value);
      }

      const newSchemaFieldSet = new Set(
        newSchemaFields.value.map((field) => {
          return {
            name: field.name
              .trim()
              .toLowerCase()
              .replace(/ /g, "_")
              .replace(/-/g, "_"),
            type: field.type,
          };
        }),
      );
      const newSchemaFieldNameSet = new Set(
        newSchemaFields.value.map((field) =>
          field.name.trim().toLowerCase().replace(/ /g, "_").replace(/-/g, "_"),
        ),
      );
      // Push unique and normalized field names to settings.defined_schema_fields
      settings.fields.push(...newSchemaFieldSet);
      settings.defined_schema_fields.push(...newSchemaFieldNameSet);
      redDaysList.value.forEach((field) => {
        settings.extended_retention_days.push({
          start: field.start,
          end: field.end,
        });
      });
      if (selectedDateFields.value.length > 0) {
        selectedDateFields.value.forEach((field) => {
          // Filter out the items only if both start and end match
          settings.extended_retention_days =
            settings.extended_retention_days.filter((item) => {
              return !(item.start === field.start && item.end === field.end);
            });
        });
      }

      let added_part_keys = [];
      for (var property of indexData.value.schema) {
        property.index_type?.forEach((index: string) => {
          if (index === "fullTextSearchKey") {
            settings.full_text_search_keys.push(property.name);
          }

          if (index === "secondaryIndexKey") {
            settings.index_fields.push(property.name);
          }

          if (property.level && index === "keyPartition") {
            settings.partition_keys.push({
              field: property.name,
              types: "value",
            });
          } else if (index === "keyPartition") {
            added_part_keys.push({
              field: property.name,
              types: "value",
            });
          }

          if (property.level && index === "prefixPartition") {
            settings.partition_keys.push({
              field: property.name,
              types: "prefix",
            });
          } else if (index === "prefixPartition") {
            added_part_keys.push({
              field: property.name,
              types: "prefix",
            });
          }

          if (index?.includes("hashPartition")) {
            const [, buckets] = index.split("_");

            if (property.level) {
              settings.partition_keys.push({
                field: property.name,
                types: {
                  hash: Number(buckets),
                },
              });
            } else {
              added_part_keys.push({
                field: property.name,
                types: {
                  hash: Number(buckets),
                },
              });
            }
          }

          if (index === "bloomFilterKey") {
            settings.bloom_filter_fields.push(property.name);
          }
        });
      }
      if (added_part_keys.length > 0) {
        settings.partition_keys =
          settings.partition_keys.concat(added_part_keys);
      }
      loadingState.value = true;

      newSchemaFieldsForm.reset({ newSchemaFields: [] });

      redDaysList.value = [];

      selectedDateFields.value = [];

      let modifiedSettings = getUpdatedSettings(
        previousSchemaVersion,
        settings,
      );

      // Add cross_links diff
      const prevCrossLinks = previousSchemaVersion?.cross_links || [];
      const currCrossLinks = streamCrossLinks.value || [];
      const prevCrossLinkNames = new Set(
        prevCrossLinks.map((l: any) => l.name),
      );
      const currCrossLinkNames = new Set(
        currCrossLinks.map((l: any) => l.name),
      );

      const crossLinksToAdd = currCrossLinks.filter(
        (l: any) => !prevCrossLinkNames.has(l.name),
      );
      const crossLinksToRemove = prevCrossLinks.filter(
        (l: any) => !currCrossLinkNames.has(l.name),
      );

      // Check for modified links (same name but different url or fields)
      for (const curr of currCrossLinks) {
        if (prevCrossLinkNames.has(curr.name)) {
          const prev = prevCrossLinks.find((l: any) => l.name === curr.name);
          if (prev && JSON.stringify(prev) !== JSON.stringify(curr)) {
            crossLinksToRemove.push(prev);
            crossLinksToAdd.push(curr);
          }
        }
      }

      if (crossLinksToAdd.length > 0 || crossLinksToRemove.length > 0) {
        modifiedSettings.cross_links = {
          add: crossLinksToAdd,
          remove: crossLinksToRemove,
        };
      }

      await streamService
        .updateSettings(
          store.state.selectedOrganization.identifier,
          indexData.value.name,
          indexData.value.stream_type,
          modifiedSettings,
        )
        .then(async (res) => {
          if (
            store.state.logs?.logs?.data?.stream?.selectedStream?.includes(
              indexData.value.name,
            )
          ) {
            store.dispatch("logs/setIsInitialized", false);
          }

          await getStream(
            indexData.value.name,
            indexData.value.stream_type,
            true,
            true,
          ).then((streamResponse) => {
            formDirtyFlag.value = false;
            streamResponse = updateStreamResponse(streamResponse);
            setSchema(streamResponse);
            loadingState.value = false;
            isDialogOpen.value = false;
            toast({
              variant: "success",
              message: "Stream settings updated successfully.",
            });
          });

          segment.track("Button Click", {
            button: "Update Settings",
            user_org: store.state.selectedOrganization.identifier,
            user_id: store.state.userInfo.email,
            stream_name: indexData.value.name,
            page: "Schema Details",
          });
        })
        .catch((err: any) => {
          loadingState.value = false;
          toast({
            variant: "error",
            message: err.response.data.message,
          });
        });
    };

    // Enter inside the "Add Field(s)" card triggers the settings save (Update
    // Settings), matching normal form behavior. Needed because the nested <OForm>
    // renders a real <form> with no submit button inside it, so the browser never
    // implicitly submits on Enter once there are 2+ text inputs (multiple rows).
    // Scoped to the field-NAME input (matched by its form `name`) so Enter used to
    // pick a Data Type option in the dropdown does NOT submit.
    const onAddFieldsKeyup = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const el = e.target as HTMLInputElement | null;
      if (
        el?.tagName === "INPUT" &&
        /^newSchemaFields\[\d+\]\.name$/.test(el.name || "")
      ) {
        // Return the promise so the save is awaitable (the @keyup handler ignores
        // the return value; tests await it).
        return onSubmit();
      }
    };

    const showPartitionColumn = computed(() => {
      return (
        isCloud != "true" && modelValue.stream_type !== "enrichment_tables"
      );
    });

    const showFullTextSearchColumn = computed(
      () => modelValue.stream_type !== "enrichment_tables",
    );

    const showDataRetention = computed(
      () =>
        !!(store.state.zoConfig.data_retention_days || false) &&
        modelValue.stream_type !== "enrichment_tables",
    );

    const disableOptions = (schema, option) => {
      let selectedHashPartition = "";

      let selectedIndices = "";

      for (let i = 0; i < (schema?.index_type || []).length; i++) {
        if (schema.index_type[i].includes("hashPartition")) {
          selectedHashPartition = schema.index_type[i];
        }
        selectedIndices += schema.index_type[i];
      }

      if (
        selectedIndices.includes("prefixPartition") &&
        option.value.includes("keyPartition")
      ) {
        return true;
      }
      if (
        selectedIndices.includes("keyPartition") &&
        option.value.includes("prefixPartition")
      ) {
        return true;
      }
      if (
        selectedIndices.includes("hashPartition") &&
        selectedHashPartition !== option.value &&
        (option.value.includes("hashPartition") ||
          option.value.includes("keyPartition") ||
          option.value.includes("prefixPartition"))
      )
        return true;
      if (
        (selectedIndices.includes("keyPartition") ||
          selectedIndices.includes("prefixPartition")) &&
        option.value.includes("hashPartition")
      )
        return true;
      //handle if fulltextsearchkey or secondaryindexkey is selected by env then we need to disable the option
      if (
        store.state.zoConfig.default_fts_keys.includes(schema.name) &&
        option.value.includes("fullTextSearchKey")
      ) {
        return true;
      }
      if (
        store.state.zoConfig.default_secondary_index_fields.includes(
          schema.name,
        ) &&
        option.value.includes("secondaryIndexKey")
      ) {
        return true;
      }
      return false;
    };

    const filterFieldFn = (rows: any, terms: any) => {
      let [field, fieldType] = terms.split("@");

      var filtered = [];
      const searchTerm = field?.toLowerCase() || "";

      // Map labels -> values for index types
      const labelToValueMap = {};
      streamIndexType.forEach(({ label, value }) => {
        labelToValueMap[label.toLowerCase()] = value;
      });

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let match = false;

        if (fieldType === "schemaFields") {
          if (indexData.value.defined_schema_fields.includes(row.name)) {
            // If no search field given, include directly
            if (!searchTerm) {
              match = true;
            } else {
              // Match by name
              if (row.name.toLowerCase().includes(searchTerm)) {
                match = true;
              }
              // Match by index_type (convert search label to value)
              else if (
                row.index_type.some((t) => {
                  // check if search is label
                  return (
                    t.toLowerCase().includes(searchTerm) || // direct match with stored value
                    labelToValueMap[searchTerm] === t // label ? value match
                  );
                })
              ) {
                match = true;
              }
            }
          }
        } else {
          if (!searchTerm) {
            match = true;
          } else {
            // Match by name
            if (row.name.toLowerCase().includes(searchTerm)) {
              match = true;
            }
            // Match by index_type
            else if (
              row.index_type.some((t) => {
                return (
                  t.toLowerCase().includes(searchTerm) ||
                  labelToValueMap[searchTerm] === t
                );
              })
            ) {
              match = true;
            }
          }
        }

        if (match) {
          filtered.push(row);
        }
      }

      return filtered;
    };

    const columns = [
      {
        id: "name",
        header: t("logStream.propertyName"),
        accessorKey: "name",
        sortable: true,
        size: COL.name,
        meta: { align: "left", autoWidth: true },
      },
      {
        id: "settings",
        accessorFn: (row: any) => (row.isUserDefined ? 0 : 1),
        sortable: true,
        size: COL.method,
        meta: { align: "left" },
      },
      {
        id: "type",
        header: t("logStream.propertyType"),
        accessorKey: "type",
        sortable: true,
        size: COL.type,
        meta: { align: "left" },
      },
      {
        id: "index_type",
        header: t("logStream.indexType"),
        accessorKey: "index_type",
        sortable: false,
        size: 220,
        meta: { align: "left" },
      },
      // Only show patterns column for enterprise builds
      ...(config.isEnterprise == "true"
        ? [
            {
              id: "patterns",
              header: t("logStream.regexPatterns"),
              accessorKey: "patterns",
              sortable: false,
              size: COL.template,
              meta: { align: "left" },
            },
          ]
        : []),
    ];

    const redBtnColumns = [
      {
        id: "start",
        header: t("logStream.extendedStartDate"),
        accessorKey: "start",
        sortable: true,
        size: COL.date,
        meta: { align: "left", autoWidth: true },
      },
      {
        id: "end",
        header: t("logStream.extendedEndDate"),
        accessorKey: "end",
        sortable: true,
        size: COL.date,
        meta: { align: "left" },
      },
    ];

    // NOTE: adding/removing "Add Field(s)" rows is owned by the child
    // (StreamFieldInputs) via form.pushFieldValue / form.removeFieldValue. The
    // parent seeds the first row in openDialog and closes the dialog when the
    // rows drain to empty via the watch above — so no add/remove handlers live
    // here anymore.

    const scrollToAddFields = () => {
      const el = document.getElementById("schema-add-fields-section");
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
    };

    const updateActiveTab = (tab) => {
      activeTab.value = tab;
      if (tab === "schemaFields") {
        resultTotal.value = indexData.value.defined_schema_fields.length;
      } else {
        resultTotal.value = indexData.value.schema.length;
      }
    };

    const updateActiveMainTab = (tab) => {
      activeMainTab.value = tab;
    };

    // Function to get missing FTS and Secondary Index fields
    const getMissingPerformanceFields = (selectedFieldsSet) => {
      const missingFields = [];
      const currentSchema = indexData.value.schema;
      const currentSchemaFieldNames = new Set(
        currentSchema.map((field) => field.name),
      );

      // Get FTS fields from settings
      const ftsFieldsFromSettings = new Set();
      currentSchema.forEach((field) => {
        if (field.index_type?.includes("fullTextSearchKey")) {
          ftsFieldsFromSettings.add(field.name);
        }
      });

      // Get Secondary Index fields from settings
      const secondaryIndexFieldsFromSettings = new Set();
      currentSchema.forEach((field) => {
        if (field.index_type?.includes("secondaryIndexKey")) {
          secondaryIndexFieldsFromSettings.add(field.name);
        }
      });

      // Get default FTS keys from BE config (only if they exist in schema)
      // iterate over all the be default fts keys and check if they pressent in currentschemafieldnames if they are there
      // we should add them to ftsfields from settings
      const defaultFtsKeys = store.state.zoConfig.default_fts_keys || [];
      defaultFtsKeys.forEach((key) => {
        if (currentSchemaFieldNames.has(key)) {
          ftsFieldsFromSettings.add(key);
        }
      });

      // Get default Secondary Index keys from BE config (only if they exist in schema)
      // iterate over all the be default secondary keys and check if they pressent in currentschemafieldnames if they are there
      // we should add them to secondarykeys from settings
      const defaultSecondaryIndexKeys =
        store.state.zoConfig.default_secondary_index_fields || [];
      defaultSecondaryIndexKeys.forEach((key) => {
        if (currentSchemaFieldNames.has(key)) {
          secondaryIndexFieldsFromSettings.add(key);
        }
      });

      // Check which FTS fields are missing from selected fields
      ftsFieldsFromSettings.forEach((field) => {
        if (!selectedFieldsSet.has(field)) {
          missingFields.push({
            name: field,
            type: "Full Text Search",
          });
        }
      });

      // Check which Secondary Index fields are missing from selected fields
      secondaryIndexFieldsFromSettings.forEach((field) => {
        if (!selectedFieldsSet.has(field)) {
          missingFields.push({
            name: field,
            type: "Secondary Index",
          });
        }
      });

      return missingFields;
    };

    // Function to handle Add fields click on performance fields dialog
    const addPerformanceFields = () => {
      confirmAddPerformanceFieldsDialog.value = false;

      // Add missing performance fields to the selected fields
      const combinedFieldsSet = new Set([
        ...pendingSelectedFields.value,
        ...missingPerformanceFields.value.map((f) => f.name),
      ]);

      // Proceed with adding fields
      proceedWithAddingFields(combinedFieldsSet);

      // Clear temporary variables
      missingPerformanceFields.value = [];
      pendingSelectedFields.value = [];
    };

    // Function to handle Cancel/No click on performance fields dialog
    const skipPerformanceFields = () => {
      confirmAddPerformanceFieldsDialog.value = false;

      // Proceed without adding missing performance fields
      proceedWithAddingFields(new Set(pendingSelectedFields.value));

      // Clear temporary variables
      missingPerformanceFields.value = [];
      pendingSelectedFields.value = [];
    };

    // Function to remove a specific field from the missing fields list
    const removeFieldFromList = (
      type: "fts" | "secondaryIndex",
      fieldName: string,
    ) => {
      // Remove from missingPerformanceFields
      missingPerformanceFields.value = missingPerformanceFields.value.filter(
        (field) => field.name !== fieldName,
      );

      // If no more fields left, close the dialog and proceed
      if (missingPerformanceFields.value.length === 0) {
        confirmAddPerformanceFieldsDialog.value = false;
        proceedWithAddingFields(new Set(pendingSelectedFields.value));
        pendingSelectedFields.value = [];
      }
    };

    // Function to proceed with adding fields
    const proceedWithAddingFields = (selectedFieldsSet) => {
      markFormDirty();

      if (selectedFieldsSet.has(allFieldsName.value))
        selectedFieldsSet.delete(allFieldsName.value);

      if (selectedFieldsSet.has(store.state.zoConfig.timestamp_column))
        selectedFieldsSet.delete(store.state.zoConfig.timestamp_column);

      indexData.value.defined_schema_fields = [
        ...new Set([
          ...indexData.value.defined_schema_fields,
          ...selectedFieldsSet,
        ]),
      ];

      selectedFields.value = [];
    };

    const updateDefinedSchemaFields = () => {
      const selectedFieldsSet = new Set(
        selectedFields.value.map((field) => field.name),
      );

      //  Check max limit when adding fields
      //  We need to check store.state.zoConfig.user_defined_schema_max_fields this config value before adding to UDS
      //  Because it should not exceed this value
      if (activeTab.value !== "schemaFields") {
        const maxFieldsLength =
          store.state.zoConfig?.user_defined_schema_max_fields;
        const currentDefinedSchemaLength =
          indexData.value.defined_schema_fields.length;
        const newSchemaFieldLength =
          currentDefinedSchemaLength + selectedFieldsSet.size;

        if (maxFieldsLength && newSchemaFieldLength > maxFieldsLength) {
          toast({
            variant: "error",
            message: `Cannot add fields. Maximum allowed fields in User Defined Schema is ${maxFieldsLength}. Current: ${currentDefinedSchemaLength}, Attempting to add: ${selectedFieldsSet.size}`,
          });
          selectedFields.value = [];
          return;
        }

        // Check if UDS is being enabled for the first time (no existing defined_schema_fields)
        // and if there are any missing FTS or Secondary Index fields
        if (currentDefinedSchemaLength === 0) {
          const missing = getMissingPerformanceFields(selectedFieldsSet);

          if (missing.length > 0) {
            // Store the pending fields and missing fields
            pendingSelectedFields.value = Array.from(selectedFieldsSet);
            missingPerformanceFields.value = missing;

            // Show the confirmation dialog
            confirmAddPerformanceFieldsDialog.value = true;
            return; // Don't proceed yet, wait for user response
          }
        }
      }

      markFormDirty();

      if (selectedFieldsSet.has(allFieldsName.value))
        selectedFieldsSet.delete(allFieldsName.value);

      if (selectedFieldsSet.has(store.state.zoConfig.timestamp_column))
        selectedFieldsSet.delete(store.state.zoConfig.timestamp_column);

      if (activeTab.value === "schemaFields") {
        indexData.value.defined_schema_fields =
          indexData.value.defined_schema_fields.filter(
            (field) => !selectedFieldsSet.has(field),
          );

        if (!indexData.value.defined_schema_fields.length) {
          activeTab.value = "allFields";
        }
      } else {
        indexData.value.defined_schema_fields = [
          ...new Set([
            ...indexData.value.defined_schema_fields,
            ...selectedFieldsSet,
          ]),
        ];
      }

      selectedFields.value = [];
    };

    const updateStreamResponse = (streamResponse) => {
      if (streamResponse.settings.hasOwnProperty("defined_schema_fields")) {
        const userDefinedSchema = streamResponse.settings.defined_schema_fields;

        // Map through the schema and add `isUserDefined` field
        const updatedSchema = streamResponse.schema.map((field) => ({
          ...field,
          isUserDefined: userDefinedSchema.includes(field.name), // Mark true if in userDefinedSchema
        }));

        // Find fields in userDefinedSchema that are not in the schema
        const additionalFields = userDefinedSchema
          .filter(
            (name) =>
              !streamResponse.schema.some((field) => field.name === name),
          )
          .map((name) => ({
            name,
            isUserDefined: true,
            // Optionally, add default values for other properties (e.g., type, index_type, etc.)
          }));
        // Combine the updated schema with additional fields
        streamResponse.schema = [...updatedSchema, ...additionalFields];
      }
      updateResultTotal(streamResponse);
      return streamResponse;
    };

    const closeDialog = () => {
      isDialogOpen.value = false;
      // reset() clears the rows AND submit-state → no stale "required" flash.
      newSchemaFieldsForm.reset({ newSchemaFields: [] });
    };

    const openDialog = () => {
      isDialogOpen.value = true;
      formDirtyFlag.value = true;
      newSchemaFieldsForm.reset({
        newSchemaFields: [
          {
            name: "",
            type: "",
            index_type: [],
          },
        ],
      });
    };
    const updateResultTotal = (streamResponse) => {
      if (activeTab.value === "schemaFields") {
        resultTotal.value =
          streamResponse.settings?.defined_schema_fields?.length;
      } else {
        resultTotal.value = streamResponse.schema?.length;
      }
    };
    // Date only: this column shows a retention window, not an instant.
    const convertUnixToDateFormat = (unixMicroseconds: any) =>
      convertUnixToFormat(unixMicroseconds, "DD-MM-YYYY");
    function formatDate(dateString) {
      const date = new Date(dateString); // Convert to Date object
      const day = String(date.getDate()).padStart(2, "0"); // Get day with leading zero
      const month = String(date.getMonth() + 1).padStart(2, "0"); // Get month with leading zero
      const year = date.getFullYear(); // Get the full year

      return `${day}-${month}-${year}`; // Return formatted date
    }

    const dateChangeValue = (value) => {
      // Ignore programmatic / mount-replay emits from <date-time>. On mount (and
      // on every remount triggered by loadingState toggling), DateTime emits an
      // `on:date-change` for its default range with `userChangedValue: false`.
      // Acting on it here would push today's date into redDaysList and call
      // onSubmit(), which toggles loadingState → remounts <date-time> → emits
      // again → infinite updateSettings/getStream loop. Only a genuine user
      // Apply carries `userChangedValue: true`.
      if (value.userChangedValue === false) return;
      const selectedFromDate =
        value.hasOwnProperty("selectedDate") &&
        formatDate(value.selectedDate.from);
      const selectedToDate =
        value.hasOwnProperty("selectedDate") &&
        formatDate(value.selectedDate.to);
      if (value.relativeTimePeriod == null) {
        try {
          const startTimestamp = convertDateToTimestamp(
            selectedFromDate,
            "00:00",
            "UTC",
          ).timestamp;
          const endTimestamp = convertDateToTimestamp(
            selectedToDate,
            "00:00",
            "UTC",
          ).timestamp;

          if (startTimestamp && endTimestamp) {
            redDaysList.value.push({
              start: startTimestamp,
              end: endTimestamp,
            });
            onSubmit();
          }
        } catch (error) {
          console.error("Error processing date selection:", error);
        }
      }
    };
    const calculateDateRange = () => {
      const today = new Date();
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() - (dataRetentionDays.value - 1)); // Adjust to the desired number of days (dataRetentionDays of  days in this case)

      const formattedDate = timestampToTimezoneDate(
        new Date().getTime(), // Current timestamp
        store.state.timezone, // Get the timezone from the store
        "yyyy/MM/dd", // Desired format
      );
      // Format minDate using timestampToTimezoneDate for a custom format
      minDate.value = timestampToTimezoneDate(
        currentDate.getTime(),
        store.state.timezone,
        "yyyy/MM/dd", // Desired format
      );
    };

    const deleteDates = () => {
      selectedDateFields.value = selectedDateFields.value.map((field) => {
        return {
          start: field.original_start,
          end: field.original_end,
        };
      });
      formDirtyFlag.value = true;
      onSubmit();
    };

    const groupPatternAssociationsByField = (
      associations: PatternAssociation[],
    ): Record<string, PatternAssociation[]> => {
      return associations.reduce(
        (acc, item) => {
          if (!acc[item.field]) {
            acc[item.field] = [];
          }
          acc[item.field].push(item);
          return acc;
        },
        {} as Record<string, PatternAssociation[]>,
      );
    };
    const ungroupPatternAssociations = (
      grouped: Record<string, PatternAssociation[]>,
    ): PatternAssociation[] => {
      return Object.values(grouped).flat();
    };

    const openPatternAssociationDialog = (field: string) => {
      patternAssociationDialog.value.show = true;
      patternAssociationDialog.value.data =
        patternAssociations.value[field] || [];
      patternAssociationDialog.value.fieldName = field;
    };
    //this is used to add a new pattern to the field
    //completely new pattern not an update
    const handleAddPattern = (pattern: PatternAssociation) => {
      formDirtyFlag.value = true;
      if (patternAssociations.value[pattern.field]) {
        patternAssociations.value[pattern.field].push(pattern);
      } else {
        patternAssociations.value[pattern.field] = [pattern];
      }
      patternAssociationDialog.value.data =
        patternAssociations.value[pattern.field];
    };

    //this is used to remove a pattern from the field
    const handleRemovePattern = (patternId: string, fieldName: string) => {
      formDirtyFlag.value = true;
      let filteredData =
        patternAssociations.value[fieldName] &&
        patternAssociations.value[fieldName].filter(
          (pattern: PatternAssociation) => {
            return pattern.pattern_id !== patternId;
          },
        );
      patternAssociations.value[fieldName] = [...filteredData];
      patternAssociationDialog.value.data = [...filteredData];
    };

    //this is used to update an already applied pattern in the field
    //for suppose user wants to update policy or apply_at for a pattern
    const handleUpdateAppliedPattern = (
      pattern: PatternAssociation,
      fieldName: string,
      patternId: string,
      attribute: string,
    ) => {
      patternAssociations.value[pattern.field] &&
        patternAssociations.value[fieldName].forEach(
          (p: PatternAssociation) => {
            if (
              p.pattern_id === pattern.pattern_id &&
              p.pattern_name === pattern.pattern_name
            ) {
              if (attribute === "policy") {
                p.policy = pattern.policy;
              } else if (attribute === "apply_at") {
                if (pattern.apply_at != undefined && pattern.apply_at != null) {
                  p.apply_at = pattern.apply_at;
                } else {
                  p.apply_at = patternIdToApplyAtMap.get(
                    fieldName + patternId,
                  )?.apply_at;
                }
              }
            }
          },
        );
      if (patternAssociations.value[fieldName]) {
        patternAssociationDialog.value.data = [
          ...patternAssociations.value[fieldName],
        ];
      }
    };

    //this is used to compute the index_type value based on the env
    //so instead of directly showing the value of the index_type we will add the values of fulltextsearchkey and secondaryindexkey if it is set by the env
    //and if it is not set by the env then we will not add the values of fulltextsearchkey and secondaryindexkey becuase those will be already there and we don't want to show them twice
    const computedIndexType = (props) => {
      return computed(() => {
        let keysToBeDisplayed = props.row.index_type || [];
        // return the actual index_type value from the row
        //merge env fts and secondary index keys
        //check for the props.row.name is in the env fts and secondary index keys
        if (
          store.state.zoConfig.default_fts_keys.indexOf(props.row.name) > -1
        ) {
          keysToBeDisplayed = [
            ...new Set([...keysToBeDisplayed, "fullTextSearchKey"]),
          ];
        }
        if (
          store.state.zoConfig.default_secondary_index_fields.indexOf(
            props.row.name,
          ) > -1
        ) {
          keysToBeDisplayed = [
            ...new Set([...keysToBeDisplayed, "secondaryIndexKey"]),
          ];
        }
        return keysToBeDisplayed || [];
      });
    };
    //this function is used to check if the option is present in the default env
    //if present then we will return true else false
    //this is used to show the tooltip in the q-select for disabled options
    //why there are disabled
    const checkIfOptionPresentInDefaultEnv = (name, option) => {
      if (
        store.state.zoConfig.default_fts_keys.indexOf(name) > -1 &&
        option.value == "fullTextSearchKey"
      ) {
        return true;
      }
      if (
        store.state.zoConfig.default_secondary_index_fields.indexOf(name) >
          -1 &&
        option.value == "secondaryIndexKey"
      ) {
        return true;
      }
      return false;
    };
    //this is used to upate the model value of the index_type
    const updateIndexType = (props, value) => {
      props.row.index_type = filterValueBasedOnEnv(props, value ?? []);
      markFormDirty(props.row.name, "fts");
    };

    // Builds the per-row options array for the index-type OSelect, with the
    // `disabled` flag computed via disableOptions() for that row.
    const indexTypeOptionsForRow = (row: any) => {
      return streamIndexType.map((opt: any) => ({
        ...opt,
        disabled: disableOptions(row, opt),
      }));
    };

    // OSelect doesn't have a max-values prop; enforce it client-side instead.
    // Trims the selection to the last 2 values picked (matches old q-select
    // :max-values="2" behaviour: silently caps at 2).
    const MAX_INDEX_TYPES = 2;
    const enforceMaxIndexTypes = (value: any) => {
      if (!Array.isArray(value)) return value;
      return value.length > MAX_INDEX_TYPES ? value.slice(-MAX_INDEX_TYPES) : value;
    };
    //this function is used while we update the index_type value so if the value is set by the env then we need to remove it from the value because
    //we don't give access to the user to change the value of the env set by the env
    //and if it is empty then we will return empty array
    //if the value is not empty then we will remove the value if it is set by the env
    const filterValueBasedOnEnv = (props, value) => {
      if (value.length == 0) {
        return [];
      }
      let filteredValue = value;
      if (
        store.state.zoConfig.default_fts_keys.indexOf(props.row.name) > -1 &&
        value.includes("fullTextSearchKey")
      ) {
        filteredValue = value.filter((item) => item !== "fullTextSearchKey");
      }
      if (
        store.state.zoConfig.default_secondary_index_fields.indexOf(
          props.row.name,
        ) > -1 &&
        value.includes("secondaryIndexKey")
      ) {
        filteredValue = value.filter((item) => item !== "secondaryIndexKey");
      }
      return filteredValue;
    };

    // store.state.zoConfig.default_quick_mode_fields: ["field1", "job", "log"]
    const isEnvQuickModeField = (fieldName: string) => {
      return store.state.zoConfig.default_quick_mode_fields.includes(fieldName);
    };

    const quickModeIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/quick_mode_light.svg")
        : getImageURL("images/common/quick_mode.svg");
    });

    const getConfigIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/streams/config_light.svg")
        : getImageURL("images/streams/config.svg");
    });
    const getTimelineIcon = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/streams/timeline_light.svg")
        : getImageURL("images/streams/timeline.svg");
    });

    return {
      t,
      store,
      config,
      dateChangeValue,
      isCloud,
      indexData,
      isCrossLinkingEnabledForStream,
      getSchema,
      onSubmit,
      updateSettingsForm,
      showPartitionColumn,
      showFullTextSearchColumn,
      getImageURL,
      dataRetentionDays,
      storeOriginalData,
      enableDistinctFields,
      approxPartition,
      maxQueryRange,
      flattenLevel,
      showDataRetention,
      formatSizeFromMB,
      confirmQueryModeChangeDialog,
      confirmDeleteDatesDialog,
      confirmAddPerformanceFieldsDialog,
      missingPerformanceFields,
      pendingSelectedFields,
      getMissingPerformanceFields,
      addPerformanceFields,
      skipPerformanceFields,
      removeFieldFromList,
      proceedWithAddingFields,
      deleteFields,
      markFormDirty,
      formDirtyFlag,
      streamIndexType,
      disableOptions,
      loadingState,
      filterFieldFn,
      rowsPerPage,
      filterField,
      columns,
      newSchemaFields,
      newSchemaFieldsForm,
      onAddFieldsKeyup,
      scrollToAddFields,
      tabs,
      activeTab,
      updateActiveTab,
      hasUserDefinedSchema,
      hasUDSFieldInSelection,
      isSchemaUDSEnabled,
      updateDefinedSchemaFields,
      selectedFields,
      allFieldsName,
      updateStreamResponse,
      isDialogOpen,
      closeDialog,
      resultTotal,
      perPageOptions,
      perPageOptionsList,
      filteredSchemaData,
      selectedSchemaIds,
      isSchemaRowSelectable,
      handleSchemaSelectedIdsUpdate,
      handleSchemaSelectionChange,
      selectedDateIds,
      handleDateSelectionChange,
      changePagination,
      selectedPerPage,
      pagination,
      qTable,
      openDialog,
      calculateDateRange,
      minDate,
      mainTabs,
      activeMainTab,
      updateActiveMainTab,
      redBtnColumns,
      redBtnRows,
      streamCrossLinks,
      orgCrossLinks,
      streamFieldNames,
      selectedDateFields,
      redDaysList,
      deleteDates,
      IsdeleteBtnVisible,
      showStoreOriginalDataToggle,
      patternAssociations,
      patternAssociationDialog,
      assocPatternsRef,
      openPatternAssociationDialog,
      handleAddPattern,
      handleRemovePattern,
      handleUpdateAppliedPattern,
      getFieldIndices,
      setSchema,
      formatDate,
      convertUnixToDateFormat,
      computedSchemaFieldsName,
      groupPatternAssociationsByField,
      ungroupPatternAssociations,
      computedIndexType,
      checkIfOptionPresentInDefaultEnv,
      updateIndexType,
      indexTypeOptionsForRow,
      enforceMaxIndexTypes,
      isEnvQuickModeField,
      quickModeIcon,
      getConfigIcon,
      getTimelineIcon,
    };
  },
  created() {
    if (this.modelValue && this.modelValue.name) {
      this.indexData.name = this.modelValue.name;
      this.indexData.schema = this.modelValue.schema;
      this.indexData.stream_type = this.modelValue.stream_type;

      this.getSchema();
    } else {
      /* v8 ignore next */ // unreachable in tests: Vue 3 Options API auto-unwraps refs on `this`, so loadingState here is a primitive boolean not a Ref
      this.loadingState.value = false;
    }
  },
});
</script>

<style>
.indexDetailsContainer .o2-schema-table {
  border-radius: 0.5rem;
  position: relative;
  border: 0.0625rem solid var(--o2-border-color);
}

.indexDetailsContainer .o2-schema-table thead tr {
  height: 2.5rem;
  background: var(--color-table-header-bg) !important;
}

.indexDetailsContainer .o2-schema-table thead tr th {
  font-size: var(--text-xs);
  height: 35px;
}

.indexDetailsContainer .o2-schema-table .o2-schema-table tbody td:after {
  background: none !important;
}

.indexDetailsContainer .o2-schema-table tbody tr {
  height: 15px;
}

.indexDetailsContainer .o2-schema-table tbody tr td {
  font-size: 0.875rem;
  height: 25px;
  padding: 0px 5px;
}
</style>
