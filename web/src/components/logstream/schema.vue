<!-- Copyright 2023 OpenObserve Inc.

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
  <q-card
    style="width: 60vw"
    class="column full-height no-wrap"
    v-if="indexData.schema"
  >
    <q-card-section class="q-ma-none">
      <div class="row items-center no-wrap">
        <div class="col">
          <div
            class="tw:text-[18px] tw:flex tw:items-center"
            data-test="schema-title-text"
          >
            {{ t("logStream.schemaHeader") }}
            <!-- introduced name at the top  -->
            <span 
              :class="[
                'tw:font-bold tw:mr-4 tw:px-2 tw:py-1 tw:rounded-md tw:ml-2 tw:max-w-xs tw:truncate tw:inline-block',
                store.state.theme === 'dark' 
                  ? 'tw:text-blue-400 tw:bg-blue-900/50' 
                  : 'tw:text-blue-600 tw:bg-blue-50'
              ]"
            >
              {{ indexData.name }}
              <q-tooltip v-if="indexData.name.length > 35" class="tw:text-xs">
                {{ indexData.name }}
              </q-tooltip>
            </span>
            <div 
              :class="[
                'tw:flex tw:items-center tw:gap-1.5 tw:px-2 tw:py-1 tw:rounded-md tw:border',
                store.state.theme === 'dark' 
                  ? 'tw:bg-gray-800/50 tw:border-gray-600' 
                  : 'tw:bg-gray-50 tw:border-gray-200'
              ]"
            >
              <img :src="getTimelineIcon" alt="Timeline Icon" class="tw:w-[14px] tw:h-[14px] tw:opacity-70" />
              <div class="tw:flex tw:items-center tw:gap-1.5">
                <span 
                  :class="[
                    'tw:text-[10px] tw:font-medium tw:px-1.5 tw:py-0.5 tw:rounded',
                    store.state.theme === 'dark' 
                      ? 'tw:text-gray-300 tw:bg-gray-700/50' 
                      : 'tw:text-gray-600 tw:bg-gray-100'
                  ]"
                >
                  UTC
                </span>
                <div 
                  :class="[
                    'tw:text-xs tw:font-semibold',
                    store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-800'
                  ]"
                >
                  {{ indexData.stats.doc_time_min }} → {{ indexData.stats.doc_time_max }}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="col-auto">
          <q-btn v-close-popup="true" round flat icon="cancel" >
          </q-btn>
        </div>
      </div>
    </q-card-section>
    <q-separator />

    <q-card-section class="q-ma-none q-pa-none">
      <q-form ref="updateSettingsForm" @submit.prevent="onSubmit">
        <!-- we will show loading state here -->
        <div
          v-if="loadingState"
          class="q-pt-md text-center q-w-md q-mx-lg tw:flex tw:justify-center"
          style="max-width: 450px"
        >
          <q-spinner-hourglass color="primary" size="lg" />
        </div>
        <!-- if we have data and no loading then we will show the data otherwise we will show the loading state -->
        <div v-else class="indexDetailsContainer" style="height: calc(100vh - 120px)">
          <!-- this the grid section the tiles section -->
          <div class="stats-grid tw:grid tw:grid-cols-4 tw:gap-2 tw:mb-2">
              <!-- Docs Count Tile -->
              <div
                v-if="store.state.zoConfig.show_stream_stats_doc_num"
                class="tile"
                data-test="docs-count-tile"
              >
                <div 
                  class="tile-content tw:rounded-lg tw:p-3 tw:text-center tw:border tw:shadow-sm tw:h-20 tw:flex tw:flex-col tw:justify-between"
                  :class="store.state.theme === 'dark' ? 'tile-content-dark tw:border-gray-700' : 'tile-content-light tw:border-gray-200'"
                >
                  <div class="tile-header tw:flex tw:justify-between tw:items-start">
                    <div 
                      class="tile-title tw:text-xs tw:font-bold tw:text-left"
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                    >
                    Events
                    </div>
                    <div class="tile-icon tw:opacity-80">
                      <img src="@/assets/images/home/records.svg" alt="Records Icon" class="tw:h-6 tw:w-6" />
                    </div>
                  </div>
                  <div 
                    class="tile-value tw:text-lg tw:flex tw:items-end tw:justify-start"
                    :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'"
                  >
                    {{ parseInt(indexData.stats.doc_num).toLocaleString("en-US") }}
                  </div>
                </div>
              </div>
              <!-- Storage Size Tile -->
              <div class="tile" data-test="storage-size-tile">
                <div 
                  class="tile-content tw:rounded-lg tw:p-3 tw:text-center tw:border tw:shadow-sm tw:h-20 tw:flex tw:flex-col tw:justify-between"
                  :class="store.state.theme === 'dark' ? 'tile-content-dark tw:border-gray-700' : 'tile-content-light tw:border-gray-200'"
                >
                  <div class="tile-header tw:flex tw:justify-between tw:items-start">
                    <div 
                      class="tile-title tw:text-xs tw:font-bold tw:text-left"
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                    >
                      {{ t("logStream.storageSize") }}
                    </div>
                    <div class="tile-icon tw:opacity-80">
                      <img src="@/assets/images/home/ingested_size.svg" alt="Ingested Size Icon" class="tw:h-6 tw:w-6" />
                    </div>
                  </div>
                  <div 
                    class="tile-value tw:text-lg  tw:flex tw:items-end tw:justify-start"
                    :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'"
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
                  class="tile-content tw:rounded-lg tw:p-3 tw:text-center tw:border tw:shadow-sm tw:h-20 tw:flex tw:flex-col tw:justify-between"
                  :class="store.state.theme === 'dark' ? 'tile-content-dark tw:border-gray-700' : 'tile-content-light tw:border-gray-200'"
                >
                  <div class="tile-header tw:flex tw:justify-between tw:items-start">
                    <div 
                      class="tile-title tw:text-xs tw:font-bold tw:text-left"
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                    >
                      {{ t("logStream.compressedSize") }}
                    </div>
                    <div class="tile-icon tw:opacity-80">
                      <img src="@/assets/images/home/compressed_size.svg" alt="Compressed Size Icon" class="tw:h-6 tw:w-6" />
                    </div>
                  </div>
                  <div 
                    class="tile-value tw:text-lg tw:flex tw:items-end tw:justify-start"
                    :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'"
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
                  class="tile-content tw:rounded-lg tw:p-3 tw:text-center tw:border tw:shadow-sm tw:h-20 tw:flex tw:flex-col tw:justify-between"
                  :class="store.state.theme === 'dark' ? 'tile-content-dark tw:border-gray-700' : 'tile-content-light tw:border-gray-200'"
                >
                  <div class="tile-header tw:flex tw:justify-between tw:items-start">
                    <div 
                      class="tile-title tw:text-xs tw:font-bold tw:text-left"
                      :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'"
                    >
                      {{ t("logStream.indexSize") }}
                    </div>
                    <div class="tile-icon tw:opacity-80">
                      <img src="@/assets/images/home/index_size.svg" alt="Index Size Icon" class="tw:h-6 tw:w-6" />
                    </div>
                  </div>
                  <div 
                    class="tile-value tw:text-lg tw:flex tw:items-end tw:justify-start"
                    :class="store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-900'"
                  >
                    {{ formatSizeFromMB(indexData.stats.index_size) }}
                  </div>
                </div>
              </div>
          </div>
          <div class="tw:w-full tw:flex tw:gap-2">
          <!--  left section(includes tabs and schema settings) -->
            <div 
              :class="[
                'tw:w-[100%] tw:h-[calc(100vh-200px)] tw:rounded-lg tw:border tw:shadow-sm tw:p-2 tw:flex tw:flex-col tw:h-full',
                store.state.theme === 'dark' ? 'tw:bg-[#181A1B] tw:border-gray-700' : 'tw:bg-white tw:border-gray-200'
              ]"
            >
            <div>
              <div class="flex justify-start">
                <q-tabs v-model="activeMainTab" inline-label dense>
                  <!-- Schema Settings Tab with conditional class -->
                  <q-tab
                    name="schemaSettings"
                    icon="settings"
                    label="Schema Settings"
                    no-caps
                  />

                  <!-- Red Button Tab -->
                  <q-tab
                    name="redButton"
                    icon="backup"
                    label="Extended Retention"
                    no-caps
                  />

                    <!-- Configuration Tab -->
                    <q-tab
                    name="configuration"
                    icon="tune"
                    label="Configuration"
                    no-caps
                  />
                </q-tabs>
              </div>
            </div>
            <!-- schema settings tab -->
            <div v-if="activeMainTab == 'schemaSettings'">
              <div
                class="flex tw:justify-between tw:items-center"
                data-test="schema-log-stream-mapping-title-text"
              >
                <div  v-if="indexData.defaultFts" style="font-weight: 400" class="tw:mt-[12px]">
                  <label
                    style="font-weight: 600"
                    class="mapping-warning-msg"
                  >
                    {{ t("logStream.mapping") }} Default FTS keys used (no custom
                    keys set).</label
                  >
                </div>
              </div>
                <div class="flex justify-between items-center full-width">
                  <div class="flex items-center">
                    <div class="app-tabs-container">
                    <app-tabs
                          v-if="isSchemaUDSEnabled"
                          class="tabs-selection-container"
                          data-test="schema-fields-tabs"
                          :tabs="tabs"
                          :active-tab="activeTab"
                          @update:active-tab="updateActiveTab"
                        />
                    </div>
                   
                    <div v-if="hasUserDefinedSchema" class="q-ml-sm">
                      <q-icon
                        name="info"
                        class="q-mr-xs"
                        size="16px"
                        style="color: #f5a623; cursor: pointer"
                      >
                        <q-tooltip style="font-size: 14px; width: 250px">
                          Other fields show only the schema fields that existed
                          before the stream was configured to use a user-defined
                          schema.
                        </q-tooltip>
                      </q-icon>
                    </div>
                  </div>

                  <div class="flex items-center tw:gap-2">
                    <q-input
                      data-test="schema-field-search-input"
                      v-model="filterField"
                      data-cy="schema-index-field-search-input"
                      borderless
                      debounce="1"
                      class="q-ml-auto no-border o2-search-input"
                      :placeholder="t('search.searchField')"
                      :class="store.state.theme === 'dark' ? 'o2-search-input-dark' : 'o2-search-input-light'"
                    >
                      <template #prepend>
                        <q-icon class="o2-search-input-icon" :class="store.state.theme === 'dark' ? 'o2-search-input-icon-dark' : 'o2-search-input-icon-light'" name="search" />
                      </template>
                    </q-input>
                    <q-btn
                      v-if="isSchemaUDSEnabled"
                      data-test="schema-add-fields-title"
                      @click="openDialog"
                      no-caps
                      :disable="isDialogOpen"
                      class="o2-secondary-button tw:h-[36px] tw:w-[32px] q-my-sm tw:min-w-[32px]!"
                      flat
                      @click.stop="openDialog"
                      title="Add Field(s)"
                    >
                    <q-icon name="add" size="xs" />
                    </q-btn>
                  </div>
                </div>

              <div class="q-mb-md" v-if="isDialogOpen">
                <q-card class="add-fields-card">
                  <!-- Header Section -->
                  <q-card-section
                    class="q-pa-none"
                    style="padding: 4px 16px 4px 16px"
                  >
                    <div class="tw:flex tw:justify-between tw:items-center">
                      <div class="text-h6">Add Field(s)</div>
                      <div>
                        <q-btn
                          data-test="add-stream-cancel-btn"
                          icon="close"
                          class="text-bold q-mr-md"
                          text-color="light-text"
                          no-caps
                          dense
                          flat
                          @click="closeDialog"
                        />
                      </div>
                    </div>
                  </q-card-section>
                  <!-- Main Content (Scrollable if necessary) -->
                  <q-card-section

                    class="q-pa-none"
                    style="flex: 1; overflow-y: auto; padding: 0px 16px 0px 16px; margin-bottom: 2px;"
                  >
                    <StreamFieldsInputs
                      :fields="newSchemaFields"
                      :showHeader="false"
                      :visibleInputs="{
                        name: true,
                        data_type: true,
                        index_type: false,
                      }"
                      @add="addSchemaField"
                      @remove="removeSchemaField"
                    />
                  </q-card-section>
                </q-card>
              </div>

              <!-- Note: Drawer max-height to be dynamically calculated with JS -->
              <div
                :class="
                  store.state.theme === 'dark'
                    ? 'dark-theme-table'
                    : 'light-theme-table'
                "
                style="margin-bottom: 10px"
              >
                <q-table
                  ref="qTable"
                  data-test="schema-log-stream-field-mapping-table"
                  :rows="indexData.schema"
                  :columns="columns"
                  :row-key="(row) => 'tr_' + row.name"
                  :filter="`${filterField}@${activeTab}`"
                  :filter-method="filterFieldFn"
                  :pagination="pagination"
                  selection="multiple"
                  v-model:selected="selectedFields"
                  class="q-table o2-quasar-table o2-row-md o2-schema-table"
                  id="schemaFieldList"
                  :style="{
                    height: `${indexData.defaultFts ? 'calc(100vh - 363px)' : 'calc(100vh - 330px)'}`,
                    width: '100%'
                  }"
                  :rows-per-page-options="[]"
                  dense
                >
                  <template v-slot:header="props">
                    <q-tr :props="props">
                      <q-th>
                        <q-checkbox size="xs" v-model="props.selected" color="primary" />
                      </q-th>
                      <q-th
                        v-for="col in props.cols"
                        :key="col.name"
                        :props="props"
                      >
                        <span v-if="col.icon" class="tw:ml-[5px]">
                          <q-icon  size="12px" :name="outlinedPerson"></q-icon>
                          <q-icon  size="12px" :name="outlinedSchema"></q-icon>
                        </span>
                        <span class="tw:pl-7" v-else-if="col.name === 'patterns'">
                          {{ col.label }}
                          <q-tooltip class="bg-grey-8" anchor="top middle" self="bottom middle">
                            {{ t('logStream.sdr') }}
                          </q-tooltip>
                        </span>
                        <span v-else>
                          {{ col.label }}
                        </span>
                      </q-th>
                    </q-tr>
                  </template>
                  <template v-slot:header-selection="scope">
                    <q-td class="text-center">
                      <q-checkbox
                        v-if="
                          !(
                            scope.name == store.state.zoConfig.timestamp_column ||
                            scope.name == allFieldsName
                          )
                        "
                        :data-test="`schema-stream-delete-${scope.name}-field-fts-key-checkbox`"
                        v-model="scope.selected"
                        size="sm"
                      />
                    </q-td>
                  </template>

                  <template v-slot:body-selection="scope">
                    <q-checkbox
                      v-if="
                        !(
                          scope.row.name ==
                            store.state.zoConfig.timestamp_column ||
                          scope.row.name == allFieldsName
                        )
                      "
                      dense
                      :data-test="`schema-stream-delete-${scope.row.name}-field-fts-key-checkbox`"
                      v-model="scope.selected"
                      size="xs"
                      class="tw:flex tw:items-center tw:justify-center tw:w-full"
                    />
                  </template>

                  <template v-slot:body-cell-name="props">
                    <q-td class="q-td--no-hover field-name field-name-ellipsis">
                      <div class="tw:flex tw:items-center">
                        <span class="field-name-text">
                          {{ props.row.name }}
                          <q-tooltip v-if="props.row.name.length > 30" class="tw:text-[12px]">
                            {{ props.row.name }}
                          </q-tooltip>
                        </span>
                        <span v-if="isEnvQuickModeField(props.row.name)" class="tw:flex tw:items-center tw:ml-1">
                          <img
                            :src="quickModeIcon"
                            :alt="t('logStream.envQuickModeMsg')"
                            class="tw:w-[20px] tw:h-[20px]"
                          />
                          <q-tooltip
                          class="tw:text-[12px] tw:w-[200px]"
                        >
                          {{ t('logStream.envQuickModeMsg') }}
                        </q-tooltip>
                        </span>
                      </div>
                    </q-td>
                  </template>
                  <template v-slot:body-cell-type="props">
                    <q-td>
                      <span
                        class="field-type-badge"
                        :class="{
                          'badge-int64': props.row.type === 'Int64',
                          'badge-float64': props.row.type === 'Float64',
                          'badge-utf8': props.row.type === 'Utf8',
                          'badge-bool': props.row.type === 'Boolean'
                        }"
                      >
                        {{ props.row.type }}
                      </span>
                    </q-td>
                  </template>
                  <template v-slot:body-cell-settings="props">
                    <q-td class="text-left" v-if="props.row.isUserDefined">
                      <q-icon size="12px"  :name="outlinedPerson"></q-icon>
                      <q-icon size="12px" :name="outlinedSchema"></q-icon>
                    </q-td>
                    <q-td v-else> </q-td>
                  </template>
                  <template v-slot:body-cell-index_type="props">
                    <q-td data-test="schema-stream-index-select">
                        <q-select
                        v-if="
                          !(
                            props.row.name ==
                              store.state.zoConfig.timestamp_column ||
                            props.row.name == allFieldsName
                          )
                        "
                        :model-value="computedIndexType(props).value"
                        :options="streamIndexType"
                        option-label="label"
                        option-value="value"
                        :popup-content-style="{ textTransform: 'capitalize' }"
                        color="input-border"
                        bg-color="input-bg"
                        class="mini-select"
                        input-class="mini-select"
                        :option-disable="
                          (_option) => disableOptions(props.row, _option)
                        "
                        multiple
                        :max-values="2"
                        map-options
                        emit-value
                        autoclose
                        borderless
                        dense
                        input-style="height: 12px !important; min-height: 8px !important; margin: 0px; width: 120px;"
                        style="width: 190px;"
                        @update:model-value="val => updateIndexType(props, val)"
                      >
                      <template v-slot:append>
                        <q-icon 
                          v-if="props.row.index_type && props.row.index_type.length > 0"
                          name="cancel" 
                          size="14px"
                          style="cursor: pointer; display: flex; align-items: center; font-weight: bold; margin-top: 8px;"
                          @click.stop="updateIndexType(props, [])"
                        />
                      </template>
                      <template v-slot:option="scope">
                        <q-item style="margin: 0px !important; border-radius: 0px !important;" v-bind="scope.itemProps" :disable="disableOptions(props.row, scope.opt)">
                          <q-item-section>
                            <q-item-label>
                              {{ scope.opt.label }}
                            </q-item-label>
                          </q-item-section>
                          <q-tooltip class="tw:text-[12px] tw:w-[200px]" v-if="checkIfOptionPresentInDefaultEnv(props.row.name, scope.opt) == true">
                            This is a predefined environment setting and cannot be changed.
                          </q-tooltip>
                        </q-item>
                      </template>
                      <q-tooltip 
                        v-if="props.row.index_type && props.row.index_type.length > 0" 
                        class="tw:text-[12px]"
                      >
                        {{ streamIndexType.filter(opt => props.row.index_type.includes(opt.value)).map(opt => opt.label).join(', ') }}
                      </q-tooltip>
                      </q-select>
                    </q-td>
                  </template>
                  <!-- here we will render the number of regex patterns associated with the specific field -->
                  <template v-slot:body-cell-patterns="props">
                    <q-td v-if="config.isEnterprise == 'true' && !(props.row.name == store.state.zoConfig.timestamp_column) && (props.row.type == 'Utf8' || props.row.type == 'utf8')" class="field-name text-left tw:text-[#5960B2] tw:cursor-pointer " style="padding-left: 12px !important;" @click="openPatternAssociationDialog(props.row.name)">
                      {{ patternAssociations[props.row.name]?.length ? `View ${patternAssociations[props.row.name]?.length} Patterns` : 'Add Pattern' }}
                      <span>
                        <q-icon name="arrow_forward" size="xs" />
                      </span>
                    </q-td>
                    <q-td v-else>
                    </q-td>
                  </template>

                  <template #bottom="scope">
                    <div class="schema-table-pagination-wrapper">
                      <QTablePagination
                        :scope="scope"
                        :position="'bottom'"
                        :resultTotal="resultTotal"
                        :perPageOptions="perPageOptions"
                        @update:changeRecordPerPage="changePagination"
                      />
                    </div>
                  </template>
                </q-table>
              </div>
            </div>
            
            <!-- Configuration tab -->
            <div v-if="activeMainTab == 'configuration'">
              <div class="tw:w-full tw:h-[calc(100vh-267px)] tw:flex tw:flex-col tw:gap-4 tw:h-full tw:overflow-y-auto tw:p-4">
                <!-- Configuration Settings Card -->
                <div 
                  :class="[
                    'tw:rounded-lg tw:p-2 tw:border tw:shadow-sm tw:flex tw:flex-col tw:justify-evenly',
                    store.state.theme === 'dark' ? 'dark:tw:bg-[#181A1B] dark:tw:border-gray-700' : 'tw:border-gray-200'
                  ]"
                >
                  
                  <div class="tw:flex tw:flex-col tw:gap-2 tw:flex-1">
                    <!-- Data Retention -->
                    <div v-if="showDataRetention" class="setting-group">
                      <label 
                        :class="[
                          'tw:block tw:text-sm tw:font-semibold tw:mb-1',
                          store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-700'
                        ]"
                      >
                        Data Retention (days)
                      </label>
                      <q-input
                        data-test="stream-details-data-retention-input"
                        v-model="dataRetentionDays"
                        type="number"
                        dense
                        min="1"
                        borderless
                        :class="[
                          'tw:w-full',
                          store.state.theme === 'dark' ? 'o2-search-input-dark' : 'o2-search-input-light'
                        ]"
                        class="o2-search-input no-border"
                        hide-bottom-space
                        @change="formDirtyFlag = true"
                        @update:model-value="markFormDirty"
                      />
                      <small 
                          v-if="dataRetentionDays > 0 && dataRetentionDays != ''"
                          :class="[
                            'tw:block tw:text-xs tw:mt-1 tw:italic',
                            store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'
                          ]"
                      >
                        Global retention is {{ store.state.zoConfig.data_retention_days }} days
                        
                      </small>
                      <!-- Error Message -->
                      <div class="tw:text-red-500 tw:text-sm">
                        <span v-if="dataRetentionDays <= 0 || dataRetentionDays == ''">
                          Retention period must be at least 1 day
                        </span>
                      </div>
                    </div>

                    <!-- Max Query Range -->
                    <div class="setting-group">
                      <label 
                        :class="[
                          'tw:block tw:text-sm tw:font-semibold tw:mb-1',
                          store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-700'
                        ]"
                      >
                        Max Query Range (hours)
                      </label>
                      <q-input
                        data-test="stream-details-max-query-range-input"
                        v-model="maxQueryRange"
                        type="number"
                        dense
                        borderless
                        min="0"
                        :class="[
                          'tw:w-full',
                          store.state.theme === 'dark' ? 'o2-search-input-dark' : 'o2-search-input-light'
                        ]"
                        class="o2-search-input no-border"
                        hide-bottom-space
                        @wheel.prevent
                        @change="formDirtyFlag = true"
                        @update:model-value="markFormDirty"
                      />
                      <small 
                        :class="[
                          'tw:block tw:text-xs tw:mt-1 tw:italic',
                          store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'
                        ]"
                      >
                        Maximum time range allowed for queries. Set 0 for unlimited range.
                      </small>
                    </div>

                    <!-- Flatten Level -->
                    <div class="setting-group">
                      <label 
                        :class="[
                          'tw:block tw:text-sm tw:font-semibold tw:mb-1',
                          store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-700'
                        ]"
                      >
                        {{ t("logStream.flattenLevel") }}
                      </label>
                      <q-input
                        data-test="stream-details-flatten-level-input"
                        v-model="flattenLevel"
                        type="number"
                        dense
                        borderless
                        min="0"
                        :class="[
                          'tw:w-full',
                          store.state.theme === 'dark' ? 'o2-search-input-dark' : 'o2-search-input-light'
                        ]"
                        class="o2-search-input no-border"
                        hide-bottom-space
                        @change="formDirtyFlag = true"
                        @update:model-value="markFormDirty"
                      />
                      <small 
                        :class="[
                          'tw:block tw:text-xs tw:mt-1 tw:italic',
                          store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-500'
                        ]"
                      >
                        Global is {{ store.state.zoConfig.ingest_flatten_level || 3 }}
                      </small>
                    </div>

                    <!-- Toggles -->
                    <div 
                      :class="[
                        'tw:flex tw:items-center tw:justify-between tw:border-b tw:text-sm',
                        store.state.theme === 'dark' ? 'tw:border-gray-600' : 'tw:border-gray-200'
                      ]"
                    >
                      <span 
                        :class="[
                          store.state.theme === 'dark' ? 'tw:text-gray-200' : 'tw:text-gray-700'
                        ]"
                      >
                        Use Stream Stats for Partitioning
                      </span>
                      <q-toggle
                        data-test="log-stream-use_approx-toggle-btn"
                        v-model="approxPartition"
                        size="lg"
                        class="o2-toggle-button-lg"
                        :class="store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
                        @click="formDirtyFlag = true"
                      />
                    </div>

                    <div 
                      :class="[
                        'tw:flex tw:items-center tw:justify-between tw:border-b tw:text-sm',
                        store.state.theme === 'dark' ? 'tw:border-gray-600 tw:text-gray-200' : 'tw:border-gray-200 tw:text-gray-700'
                      ]"
                    >
                      <span>Store Original Data</span>
                      <q-toggle
                        v-if="showStoreOriginalDataToggle"
                        data-test="log-stream-store-original-data-toggle-btn"
                        v-model="storeOriginalData"
                        class="o2-toggle-button-lg"
                        :class="store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
                        size="lg"
                        @click="formDirtyFlag = true"
                      />
                    </div>

                    <div
                      :class="[
                        'tw:flex tw:items-center tw:justify-between tw:border-b tw:text-sm',
                        store.state.theme === 'dark' ? 'tw:border-gray-600 tw:text-gray-200' : 'tw:border-gray-200 tw:text-gray-700'
                      ]"
                    >
                      <span>Enable Distinct Values</span>
                      <q-toggle
                        data-test="log-stream-enabled-distinct-values-toggle-btn"
                        v-model="enableDistinctFields"
                        class="o2-toggle-button-lg"
                        :class="store.state.theme === 'dark' ? 'o2-toggle-button-lg-dark' : 'o2-toggle-button-lg-light'"
                        size="lg"
                        @click="formDirtyFlag = true"
                      />
                    </div>
                  </div>

                </div>
              </div>
            </div>

            <!-- red button tab -->
            <div v-else-if="activeMainTab == 'redButton'">
              <div
                class="mapping-warning-msg q-mt-sm"
                style="width: fit-content"
              >
                <span style="font-weight: 600">
                  <q-icon name="info" class="q-mr-xs" size="16px" />

                  Additional
                  {{ store.state.zoConfig.extended_data_retention_days }} days of
                  extension will be applied to the selected date ranges</span
                >
              </div>
              <div class="q-mt-sm">
                <div class="text-center q-mt-sm tw:flex items-center">
                  <div class="flex items-center">
                    <span class="text-bold"> Select Date</span>
                    <date-time
                      class="q-mx-sm"
                      @on:date-change="dateChangeValue"
                      disable-relative
                      hide-relative-time
                      hide-relative-timezone
                      :minDate="minDate"
                    />
                  </div>
                  <span class="text-bold"> (UTC Timezone) </span>
                </div>

                <div class="q-mt-sm" style="margin-bottom: 10px">
                  <q-table
                    ref="qTable"
                    :row-key="(row, index) => 'tr_' + row.index"
                    data-test="schema-log-stream-field-mapping-table"
                    :rows="redBtnRows"
                    :columns="redBtnColumns"
                    :pagination="pagination"
                    selection="multiple"
                    v-model:selected="selectedDateFields"
                    class="q-table o2-quasar-table o2-row-md o2-schema-table"
                    id="schemaFieldList"
                    :class="store.state.theme == 'dark' ? 'o2-last-row-border-dark o2-schema-table-header-sticky-dark' : 'o2-last-row-border-light o2-schema-table-header-sticky-light'"
                    style="height: calc(100vh - 363px);"
                    :rows-per-page-options="[]"
                    dense
                  >
                    <template v-slot:header-selection="scope">
                        <q-checkbox
                          :data-test="`schema-stream-delete-${scope.name}-field-fts-key-checkbox`"
                          v-model="scope.selected"
                          size="xs"
                        />
                    </template>

                    <!-- Body Slot for Selection -->
                    <template v-slot:body-selection="scope">
                        <q-checkbox
                          :data-test="`schema-stream-delete-${scope.row.name}-field-fts-key-checkbox`"
                          v-model="scope.selected"
                          size="xs"
                          class="o2-table-checkbox"
                        />
                    </template>

                    <template #bottom="scope">
                      <QTablePagination
                        :scope="scope"
                        :position="'bottom'"
                        :resultTotal="redBtnRows.length"
                        :perPageOptions="perPageOptions"
                        @update:changeRecordPerPage="changePagination"
                      />
                    </template>
                  </q-table>
                </div>
              </div>
            </div>
            <!-- floating footer for the table -->
            <div
              :class="
                store.state.theme === 'dark'
                  ? 'dark-theme-floating-buttons'
                  : 'light-theme-floating-buttons'
              "
              class="floating-buttons q-px-sm q-py-xs"
            >
              <div
                v-if="indexData.schema.length > 0"
                class="flex items-center justify-between"
              >
                <div class="flex items-center">
                  <span
                    v-if="activeMainTab == 'schemaSettings'"
                    class="q-px-sm q-py-sm"
                    ><strong> {{ selectedFields.length }}</strong> fields
                    selected</span
                  >
                  <q-btn
                    v-if="isSchemaUDSEnabled && activeMainTab == 'schemaSettings'"
                    data-test="schema-add-field-button"
                    class=" no-border q-mr-md o2-secondary-button tw:h-[36px]"
                    :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                    no-caps
                    v-bind:disable="!selectedFields.length"
                    @click="updateDefinedSchemaFields"
                  >
                    <span class="flex items-center justify-start q-mr-sm">
                      <q-icon size="14px" :name="outlinedPerson" />
                      <q-icon size="14px" :name="outlinedSchema" />
                    </span>
                    {{
                      activeTab === "schemaFields"
                        ? t("logStream.removeSchemaField")
                        : t("logStream.addSchemaField")
                    }}
                  </q-btn>
                  <q-btn
                    v-if="activeMainTab != 'configuration'"
                    v-bind:disable="
                      !selectedFields.length && !selectedDateFields.length
                    "
                    data-test="schema-delete-button"
                    class="text-bold btn-delete o2-secondary-button tw:h-[36px]"
                    :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                    no-caps
                    flat
                    @click="
                      activeMainTab == 'schemaSettings'
                        ? (confirmQueryModeChangeDialog = true)
                        : (confirmDeleteDatesDialog = true)
                    "
                  >
                    <span class="flex items-center tw:gap-1">
                      <q-icon size="14px" :name="outlinedDelete" />
                      {{ t("logStream.delete") }}
                    </span>
                  </q-btn>
                </div>
                <div class="flex justify-end">
                  <q-btn
                    v-close-popup="true"
                    data-test="schema-cancel-button"
                    class="q-ml-md o2-secondary-button tw:h-[36px]"
                    :label="t('logStream.cancel')"
                    :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                    no-caps
                    flat
                  />
                  <q-btn
                    v-bind:disable="!formDirtyFlag"
                    data-test="schema-update-settings-button"
                    :label="t('logStream.updateSettings')"
                    class=" no-border q-ml-md o2-primary-button tw:h-[36px"
                    :class="store.state.theme === 'dark' ? 'o2-primary-button-dark' : 'o2-primary-button-light'"
                    type="submit"
                    no-caps
                    flat
                  />
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
      </q-form>
    </q-card-section>
  </q-card>
  <q-card v-else class="column q-pa-md full-height no-wrap">
    <h5>Wait while loading...</h5>
  </q-card>
  <q-dialog v-model="patternAssociationDialog.show" position="right" full-height maximized>
    <AssociatedRegexPatterns :data="patternAssociationDialog.data" :fieldName="patternAssociationDialog.fieldName" @closeDialog="patternAssociationDialog.show = false" @addPattern="handleAddPattern" @removePattern="handleRemovePattern" @updateSettings="onSubmit" @updateAppliedPattern="handleUpdateAppliedPattern" />
  </q-dialog>

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
import { useQuasar, date, format } from "quasar";
import streamService from "../../services/stream";
import segment from "../../services/segment_analytics";
import "../../styles/schema.scss";
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
import AppTabs from "@/components/common/AppTabs.vue";

import QTablePagination from "@/components/shared/grid/Pagination.vue";
import {
  outlinedSchema,
  outlinedPerson,
  outlinedDelete,
} from "@quasar/extras/material-icons-outlined";

import DateTime from "@/components/DateTime.vue";

import AssociatedRegexPatterns from "./AssociatedRegexPatterns.vue";
import PerformanceFieldsDialog from "./PerformanceFieldsDialog.vue";

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
  props: {
    // eslint-disable-next-line vue/require-default-prop
    modelValue: {
      type: Object,
      default: () => defaultValue(),
    },
  },
  components: {
    ConfirmDialog,
    StreamFieldsInputs,
    AppTabs,
    QTablePagination,
    DateTime,
    AssociatedRegexPatterns,
    PerformanceFieldsDialog,
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
    const q = useQuasar();
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

    const newSchemaFields = ref([]);
    const activeMainTab = ref("schemaSettings");
    let previousSchemaVersion: any = null;
    const approxPartition = ref(false);
    const isDialogOpen = ref(false);
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

    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value?.setPagination(pagination.value);
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

    const selectedFields = ref([]);

    const hasUserDefinedSchema = computed(() => {
      return !!indexData.value.defined_schema_fields?.length;
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
        label: `${computedSchemaFieldsName.value} (${indexData.value.schema.length})`,
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
    //here we are making the schema field name dynamic based on the user defined schema
    //1. if there is UDS the it should be other fields
    //2. if there is no UDS then it should be all fields
    const computedSchemaFieldsName = computed(() => {
      if (!hasUserDefinedSchema.value) {
        return "All Fields";
      }
      return "Other Fields";
    });

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
    watch(activeTab, (newTab) => {
      if (newTab === "schemaFields") {
        resultTotal.value = indexData.value.defined_schema_fields?.length || 0;
      } else {
        resultTotal.value = indexData.value.schema?.length || 0;
      }
    }, { immediate: true });

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
            q.notify({
              color: "positive",
              message: "Field(s) deleted successfully.",
              timeout: 2000,
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
            q.notify({
              color: "negative",
              message: res.data.message,
              timeout: 2000,
            });
          }
        })
        .catch((err: any) => {
          loadingState.value = false;
          console.log(err);
          q.notify({
            color: "negative",
            message: err.message,
            timeout: 2000,
          });
        });
    };

    const getFieldIndices = (property, settings) => {
      const fieldIndices = [];
      if (settings.full_text_search_keys.length > 0 &&
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
      streamResponse.settings.pattern_associations = streamResponse.pattern_associations;
      if (streamResponse?.settings) {
        previousSchemaVersion = JSON.parse(
          JSON.stringify(streamResponse.settings),
        );
      }
      //after this we need to have a map of pattern_id and according to field as well
      //so that we can easily access the apply_at value for a pattern if it is undefined or null
      previousSchemaVersion.pattern_associations && previousSchemaVersion.pattern_associations.forEach((pattern: PatternAssociation) => {
        patternIdToApplyAtMap.set(pattern.field + pattern.pattern_id, pattern);
      });
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
              index: index,
              original_start: field.start,
              original_end: field.end,
              start: convertUnixToQuasarFormat(field.start),
              end: convertUnixToQuasarFormat(field.end),
            });
          },
        );
      }
      if(streamResponse.pattern_associations){
        patternAssociations.value = groupPatternAssociationsByField(streamResponse.pattern_associations);
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

      indexData.value.stats.original_doc_time_max = streamResponse.stats.doc_time_max;
      indexData.value.stats.original_doc_time_min = streamResponse.stats.doc_time_min;

      indexData.value.stats.doc_time_max = date.formatDate(
        parseInt(streamResponse.stats.doc_time_max) / 1000,
        "YYYY-MM-DDTHH:mm:ss:SS",
      );
      indexData.value.stats.doc_time_min = date.formatDate(
        parseInt(streamResponse.stats.doc_time_min) / 1000,
        "YYYY-MM-DDTHH:mm:ss:SS",
      );


      indexData.value.defined_schema_fields =
        streamResponse.settings.defined_schema_fields || [];

      if (showDataRetention.value)
        dataRetentionDays.value =
          streamResponse.settings.data_retention ||
          store.state.zoConfig.data_retention_days;
      calculateDateRange();

      maxQueryRange.value = streamResponse.settings.max_query_range || 0;
      flattenLevel.value = streamResponse.settings.flatten_level || null;
      storeOriginalData.value =
        streamResponse.settings.store_original_data || false;
      enableDistinctFields.value = streamResponse.settings.enable_distinct_fields || false;
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
      const dismiss = q.notify({
        spinner: true,
        message: "Please wait while loading stats...",
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
          console.log(err);
        });
    };

    const onSubmit = async () => {
      patternAssociations.value = ungroupPatternAssociations(patternAssociations.value);
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
        q.notify({
          color: "negative",
          message:
            "Invalid Data Retention Period: Retention period must be at least 1 day.",
          timeout: 4000,
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
            name: field.name.trim().toLowerCase().replace(/ /g, "_").replace(/-/g, "_"),
            type: field.type,
          }
        }),
      );
      const newSchemaFieldNameSet = new Set(
        newSchemaFields.value.map((field) =>
           field.name.trim().toLowerCase().replace(/ /g, "_").replace(/-/g, "_")
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

      newSchemaFields.value = [];

      redDaysList.value = [];

      selectedDateFields.value = [];

      let modifiedSettings = getUpdatedSettings(
        previousSchemaVersion,
        settings,
      );
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
            q.notify({
              color: "positive",
              message: "Stream settings updated successfully.",
              timeout: 2000,
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
          q.notify({
            color: "negative",
            message: err.response.data.message,
            timeout: 2000,
          });
        });
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
      )
      {
        return true;
      }
      if (
        store.state.zoConfig.default_secondary_index_fields.includes(schema.name) &&
        option.value.includes("secondaryIndexKey")
      )
      {
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
                    labelToValueMap[searchTerm] === t // label → value match
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
        name: "name",
        label: t("logStream.propertyName"),
        align: "center",
        sortable: true,
        field: "name",
      },
      {
        name: "settings",
        align: "left",
        sortable: true,
        field: "isUserDefined",
        icon: "settings",
        sort: (a, b) => {
          // Ensure `isUserDefined` is properly handled
          if (a && !b) return -1; // `a` comes first
          if (!a && b) return 1; // `b` comes first
          return 0; // No change in order
        },
      },
      {
        name: "type",
        label: t("logStream.propertyType"),
        align: "left",
        sortable: true,
        field: "type",
      },
      {
        name: "index_type",
        label: t("logStream.indexType"),
        align: "left",
        sortable: false,
      },
      // Only show patterns column for enterprise builds
      ...(config.isEnterprise == 'true' ? [{
        name: "patterns",
        label: t("logStream.regexPatterns"),
        align: "left",
        sortable: false,
      }] : []),
    ];

    const redBtnColumns = [
      {
        name: "start",
        label: t("logStream.extendedStartDate"),
        align: "center",
        sortable: true,
        field: "start",
      },
      {
        name: "end",
        label: t("logStream.extendedEndDate"),
        align: "center",
        sortable: true,
        field: "end",
      },
    ];

    const addSchemaField = () => {
      newSchemaFields.value.push({
        name: "",
        type: "",
        index_type: [],
      });
      formDirtyFlag.value = true;
    };

    const removeSchemaField = (field: any, index: number) => {
      newSchemaFields.value.splice(index, 1);
      if (newSchemaFields.value.length === 0) {
        isDialogOpen.value = false;
        newSchemaFields.value = [];
      }
    };

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
      const currentSchemaFieldNames = new Set(currentSchema.map(field => field.name));

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
      const defaultSecondaryIndexKeys = store.state.zoConfig.default_secondary_index_fields || [];
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
            type: "Full Text Search"
          });
        }
      });

      // Check which Secondary Index fields are missing from selected fields
      secondaryIndexFieldsFromSettings.forEach((field) => {
        if (!selectedFieldsSet.has(field)) {
          missingFields.push({
            name: field,
            type: "Secondary Index"
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
        ...missingPerformanceFields.value.map(f => f.name)
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
    const removeFieldFromList = (type: 'fts' | 'secondaryIndex', fieldName: string) => {
      // Remove from missingPerformanceFields
      missingPerformanceFields.value = missingPerformanceFields.value.filter(
        field => field.name !== fieldName
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
        const maxFieldsLength = store.state.zoConfig?.user_defined_schema_max_fields;
        const currentDefinedSchemaLength = indexData.value.defined_schema_fields.length;
        const newSchemaFieldLength = currentDefinedSchemaLength + selectedFieldsSet.size;

        if (maxFieldsLength && newSchemaFieldLength > maxFieldsLength) {
          q.notify({
            type: "negative",
            message: `Cannot add fields. Maximum allowed fields in User Defined Schema is ${maxFieldsLength}. Current: ${currentDefinedSchemaLength}, Attempting to add: ${selectedFieldsSet.size}`,
            timeout: 3000,
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
      };

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
      newSchemaFields.value = [];
    };

    const openDialog = () => {
      isDialogOpen.value = true;
      formDirtyFlag.value = true;
      newSchemaFields.value = [
        {
          name: "",
          type: "",
          index_type: [],
        },
      ];
    };
    const updateResultTotal = (streamResponse) => {
      if (activeTab.value === "schemaFields") {
        resultTotal.value =
          streamResponse.settings?.defined_schema_fields?.length;
      } else {
        resultTotal.value = streamResponse.schema?.length;
      }
    };
    function convertUnixToQuasarFormat(unixMicroseconds: any) {
      if (!unixMicroseconds) return "";
      const unixSeconds = unixMicroseconds / 1e6;
      const dateToFormat = new Date(unixSeconds * 1000);
      const formattedDate = dateToFormat.toISOString();
      return date.formatDate(formattedDate, "DD-MM-YYYY");
    }
    function formatDate(dateString) {
      const date = new Date(dateString); // Convert to Date object
      const day = String(date.getDate()).padStart(2, "0"); // Get day with leading zero
      const month = String(date.getMonth() + 1).padStart(2, "0"); // Get month with leading zero
      const year = date.getFullYear(); // Get the full year

      return `${day}-${month}-${year}`; // Return formatted date
    }

    const dateChangeValue = (value) => {
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

    const  groupPatternAssociationsByField = (associations: PatternAssociation[]): Record<string, PatternAssociation[]> => {
        return associations.reduce((acc, item) => {
          if (!acc[item.field]) {
            acc[item.field] = [];
          }
          acc[item.field].push(item);
          return acc;
        }, {} as Record<string, PatternAssociation[]>);
      }
      const ungroupPatternAssociations = (grouped: Record<string, PatternAssociation[]>): PatternAssociation[] => {
          return Object.values(grouped).flat();
        };

    const openPatternAssociationDialog = (field: string) => {
      patternAssociationDialog.value.show = true;
      patternAssociationDialog.value.data = patternAssociations.value[field] || [];
      patternAssociationDialog.value.fieldName = field;
    }
    //this is used to add a new pattern to the field
    //completely new pattern not an update
    const handleAddPattern = (pattern: PatternAssociation) => {
      formDirtyFlag.value = true;
      if(patternAssociations.value[pattern.field]){
        patternAssociations.value[pattern.field].push(pattern);
      }
      else{
        patternAssociations.value[pattern.field] = [pattern];
      }
      patternAssociationDialog.value.data = patternAssociations.value[pattern.field];
    }

    //this is used to remove a pattern from the field
    const handleRemovePattern = (patternId: string, fieldName: string) => {
      formDirtyFlag.value = true;
      let filteredData = patternAssociations.value[fieldName] && patternAssociations.value[fieldName].filter((pattern: PatternAssociation) => {
        return pattern.pattern_id !== patternId;
      });
      patternAssociations.value[fieldName] = [...filteredData];
      patternAssociationDialog.value.data = [...filteredData];
    }

    //this is used to update an already applied pattern in the field
    //for suppose user wants to update policy or apply_at for a pattern
    const handleUpdateAppliedPattern = (pattern: PatternAssociation, fieldName: string, patternId: string, attribute: string) => {
      patternAssociations.value[pattern.field] && patternAssociations.value[fieldName].forEach((p: PatternAssociation) => {
        if(p.pattern_id === pattern.pattern_id && p.pattern_name === pattern.pattern_name){
          if(attribute === "policy"){
            p.policy = pattern.policy;
          }
          else if(attribute === "apply_at"){
            if(pattern.apply_at != undefined && pattern.apply_at != null){
              p.apply_at = pattern.apply_at;
            }
            else{
              p.apply_at = patternIdToApplyAtMap.get(fieldName + patternId)?.apply_at;
            }
          }
        }
      });
      if(patternAssociations.value[fieldName]){
        patternAssociationDialog.value.data = [...patternAssociations.value[fieldName]];
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
      if (store.state.zoConfig.default_fts_keys.indexOf(props.row.name) > -1
        ) {
        keysToBeDisplayed = [...new Set([...keysToBeDisplayed, "fullTextSearchKey"])];
      }
      if (store.state.zoConfig.default_secondary_index_fields.indexOf(props.row.name) > -1
      ) {
        keysToBeDisplayed = [...new Set([...keysToBeDisplayed, "secondaryIndexKey"])];
      }
      return keysToBeDisplayed || []
    })
  };
  //this function is used to check if the option is present in the default env
  //if present then we will return true else false
  //this is used to show the tooltip in the q-select for disabled options
  //why there are disabled
  const checkIfOptionPresentInDefaultEnv = (name, option) => {
    if (store.state.zoConfig.default_fts_keys.indexOf(name) > -1 && option.value == "fullTextSearchKey") {
      return true;
    }
    if (store.state.zoConfig.default_secondary_index_fields.indexOf(name) > -1 && option.value == "secondaryIndexKey") {
      return true;
  }
  return false;
  };
  //this is used to upate the model value of the index_type
  const updateIndexType = (props, value) => {
    props.row.index_type = filterValueBasedOnEnv(props, value ?? []);
    markFormDirty(props.row.name, 'fts');
  };
  //this function is used while we update the index_type value so if the value is set by the env then we need to remove it from the value because 
  //we don't give access to the user to change the value of the env set by the env
  //and if it is empty then we will return empty array 
  //if the value is not empty then we will remove the value if it is set by the env
  const filterValueBasedOnEnv = (props, value) => {
    if(value.length == 0){
      return [];
    }
    let filteredValue = value;
    if (store.state.zoConfig.default_fts_keys.indexOf(props.row.name) > -1 && value.includes("fullTextSearchKey")) {
      filteredValue = value.filter(item => item !== "fullTextSearchKey");
    }
    if (store.state.zoConfig.default_secondary_index_fields.indexOf(props.row.name) > -1 && value.includes("secondaryIndexKey")) {
      filteredValue = value.filter(item => item !== "secondaryIndexKey");
    }
    return filteredValue;
  };

    // store.state.zoConfig.default_quick_mode_fields: ["field1", "job", "log"]
    const isEnvQuickModeField = (fieldName: string) => {
      return (
        store.state.zoConfig.default_quick_mode_fields.includes(fieldName)
      );
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
      q,
      store,
      config,
      dateChangeValue,
      isCloud,
      indexData,
      getSchema,
      onSubmit,
      updateSettingsForm,
      format,
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
      addSchemaField,
      removeSchemaField,
      newSchemaFields,
      scrollToAddFields,
      tabs,
      activeTab,
      updateActiveTab,
      hasUserDefinedSchema,
      isSchemaUDSEnabled,
      updateDefinedSchemaFields,
      selectedFields,
      allFieldsName,
      updateStreamResponse,
      isDialogOpen,
      closeDialog,
      resultTotal,
      perPageOptions,
      changePagination,
      selectedPerPage,
      pagination,
      qTable,
      outlinedPerson,
      outlinedSchema,
      outlinedDelete,
      openDialog,
      calculateDateRange,
      minDate,
      mainTabs,
      activeMainTab,
      updateActiveMainTab,
      redBtnColumns,
      redBtnRows,
      selectedDateFields,
      redDaysList,
      deleteDates,
      IsdeleteBtnVisible,
      showStoreOriginalDataToggle,
      patternAssociations,
      patternAssociationDialog,
      openPatternAssociationDialog,
      handleAddPattern,
      handleRemovePattern,
      handleUpdateAppliedPattern,
      getFieldIndices,
      setSchema,
      formatDate,
      convertUnixToQuasarFormat,
      computedSchemaFieldsName,
      groupPatternAssociationsByField,
      ungroupPatternAssociations,
      computedIndexType,
      checkIfOptionPresentInDefaultEnv,
      updateIndexType,
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
      this.loadingState.value = false;
    }
  },
});
</script>

<style lang="scss" scoped>
.q-card__section--vert {
  padding: 8px 16px;
}
.indexDetailsContainer {
  width: 100%;

  .title {
    margin-bottom: 1rem;
    font-weight: 700;
  }

  .titleContainer {
    background-color: #00000005;
    border: 1px solid $input-field-border-color;
    border-radius: 5px;
    padding: 1rem;
  }



  .o2-schema-table {
    border-radius: 0.5rem;
    position: relative;
    border: 0.0625rem solid var(--o2-border-color);

    // Custom pagination wrapper styling
    .schema-table-pagination-wrapper {
      display: flex;
      justify-content: flex-end;
      width: 100%;

      // Override the QTablePagination component's justify-between
      :deep(.q-table__control) {
        justify-content: flex-end !important;

        &.row.justify-between {
          justify-content: flex-end !important;
        }
      }

      // Prevent pagination text from wrapping
      :deep(.q-table__bottom-item) {
        white-space: nowrap;
      }
    }

    thead tr {
      height: 2.5rem;
      background: var(--o2-table-header-bg) !important;

      th {
        font-size: 0.875rem;
        // font-weight: 700;
        height: 35px;
      }


    }
    

    .o2-schema-table tbody td:after {
      background: none !important;
    }

    tbody tr {
      height: 15px;

      td {
        font-size: 0.875rem;
        // font-weight: 600;
        height: 25px;
        padding: 0px 5px;
      }
    }
    
  }

  .q-list {
    border-radius: 0 0 0.5rem 0.5rem;

    .q-item {
      height: 2.5rem;
      padding: 0;

      &__section {
        padding: 0.5rem 1rem;
        font-size: 0.875rem;

        &:not(:first-child) {
          border-left: 1px solid $input-field-border-color;
          align-items: flex-start;
          min-width: 29%;
        }
      }

      &.list-head {
        border: 1px solid $input-field-border-color;
        border-radius: 0.5rem 0.5rem 0 0;
        border-bottom: none;
      }

      &.list-item {
        border-right: 1px solid $input-field-border-color;
        border-left: 1px solid $input-field-border-color;

        &,
        &--side {
          font-weight: 600;
        }

        &:last-of-type {
          border-bottom: 1px solid $input-field-border-color;
          border-radius: 0 0 0.5rem 0.5rem;
        }
      }
    }
  }

  .data-retention-input {
    border: 1px solid $input-field-border-color;
    border-radius: 0.2rem;
    width: 80px;
    height: 39px;
    &.q-field {
      padding-bottom: 0 !important;
    }
  }
}

.mapping-warning-msg {
  background-color: #f9f290;
  padding: 4px 16px;
  border-radius: 4px;
  border: 1px solid #f5a623;
  color: #865300;
}

.q-item {
  padding: 3px 8px;
  margin: 0 8px;
  border-radius: 6px;

  /* Overriding default height */
  min-height: 30px;

  &.q-router-link--active {
    background-color: $primary;
    color: white;

    &::before {
      content: " ";

      position: absolute;
      top: 0;
      background-color: inherit;
    }
  }

  &.ql-item-mini {
    margin: 0;

    &::before {
      display: none;
    }
  }
}

.q-item__section--avatar {
  margin: 0;
  padding: 0;
  min-width: 40px;
}
.single-line-tab {
  display: inline-flex;
}
.mini-select{
  min-height: 24px !important;
  max-height: 24px !important;
  height: 24px !important;
  font-size: 0.813rem;

  .q-field__inner {
    min-height: 24px !important;
    height: 24px !important;
    max-height: 24px !important;
  }

  .q-field__control {
    min-height: 24px !important;
    max-height: 24px !important;
    height: 24px !important;
    padding: 0px 8px !important;
  }

  .q-field__control-container {
    .q-field__native {
      min-height: 24px !important;
      height: 24px !important;
    }
  }

  .q-field__marginal {
    height: 24px !important;
  }

  .q-field__append {
    height: 24px !important;
  }
}
</style>