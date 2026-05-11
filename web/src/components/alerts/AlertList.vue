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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div data-test="alert-list-page" class="q-pa-none flex flex-col">
    <div
      class="tw:w-full tw:px-[0.625rem] q-pt-xs"
      v-if="!showAddAlertDialog && !showImportAlertDialog"
    >
      <div class="card-container">
        <div
          class="flex justify-between full-width tw:py-3 tw:mb-[0.625rem] tw:px-4 tw:h-[68px] items-center"
        >
          <div class="tw:flex tw:items-center tw:gap-4">
            <div
              class="q-table__title tw:font-[600]"
              data-test="alert-list-title"
            >
              {{ t("alerts.header") }}
            </div>
          </div>
          <div class="flex q-ml-auto tw:ps-2 items-center">
            <!-- Alert Tabs -->
            <OToggleGroup
              :model-value="activeTab"
              @update:model-value="(v) => { activeTab = v; filterAlertsByTab(); }"
              class="q-mr-sm"
            >
              <OToggleGroupItem value="all" size="sm" data-test="tab-all">
                <template #icon-left><LayoutList class="tw:size-3.5 tw:shrink-0" /></template>
                {{ t("alerts.all") }}
              </OToggleGroupItem>
              <OToggleGroupItem value="scheduled" size="sm" data-test="tab-scheduled" icon-left="schedule">
                {{ t("alerts.scheduled") }}
              </OToggleGroupItem>
              <OToggleGroupItem value="realTime" size="sm" data-test="tab-realTime" icon-left="bolt">
                {{ t("alerts.realTime") }}
              </OToggleGroupItem>
              <OToggleGroupItem v-if="isAnomalyDetectionEnabled" value="anomalyDetection" size="sm" data-test="tab-anomalyDetection" icon-left="query-stats">
                {{ t("alerts.anomalyDetection") }}
              </OToggleGroupItem>
            </OToggleGroup>
            <!-- Search for Alerts -->
            <q-input
              v-model="dynamicQueryModel"
              dense
              borderless
              :placeholder="
                searchAcrossFolders
                  ? t('dashboard.searchAcross')
                  : t('alerts.search')
              "
              data-test="alert-list-search-input"
              :clearable="searchAcrossFolders"
              @clear="clearSearchHistory"
              :class="[
                'o2-search-input',
                isCompactToolbar ? 'alert-search-input' : '',
              ]"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
              <template v-if="isCompactToolbar" #append>
                <q-toggle
                  data-test="alert-list-search-across-folders-toggle"
                  v-model="searchAcrossFolders"
                  class="o2-toggle-button-xs"
                  :class="
                    store.state.theme === 'dark'
                      ? 'o2-toggle-button-xs-dark'
                      : 'o2-toggle-button-xs-light'
                  "
                  size="xs"
                >
                  <q-tooltip>
                    {{
                      searchAcrossFolders
                        ? t('dashboard.searchSelf')
                        : t('dashboard.searchAll')
                    }}
                  </q-tooltip>
                </q-toggle>
              </template>
            </q-input>
            <!-- All Folders toggle (normal resolution) -->
            <div v-if="!isCompactToolbar" class="tw:ml-2">
              <q-toggle
                data-test="alert-list-search-across-folders-toggle"
                v-model="searchAcrossFolders"
                label="All Folders"
                class="tw:h-[32px] tw:mr-3 o2-toggle-button-lg all-folders-toggle"
                size="lg"
              />
              <q-tooltip
                class="q-mt-lg"
                anchor="top middle"
                self="bottom middle"
              >
                {{
                  searchAcrossFolders
                    ? t("dashboard.searchSelf")
                    : t("dashboard.searchAll")
                }}
              </q-tooltip>
            </div>
          </div>
          <!-- Import button -->
          <OButton
            :class="[
              'q-ml-sm',
              isCompactToolbar
                ? 'compact-icon-btn'
                : '',
            ]"
            variant="outline"
            size="sm"
            @click="importAlert"
            data-test="alert-import"
            icon-left="upload-file"
          >
            <template v-if="!isCompactToolbar">{{ t(`dashboard.import`) }}</template>
            <q-tooltip v-if="isCompactToolbar">
              {{ t("dashboard.import") }}
            </q-tooltip>
          </OButton>
          <!-- Add button — routes to anomaly creation on anomaly tab, alert creation otherwise -->
          <OButton
            data-test="alert-list-add-alert-btn"
            class="q-ml-sm"
            variant="primary"
            size="sm"
            :disabled="!destinations.length || !templates.length"
            :title="!destinations.length ? t('alerts.noDestinations') : ''"
            @click="
              activeTab === 'anomalyDetection'
                ? router.push({
                    name: 'addAnomalyDetection',
                    query: {
                      org_identifier:
                        store.state.selectedOrganization.identifier,
                      folder: activeFolderId,
                      tab: activeTab,
                    },
                  })
                : showAddUpdateFn({})
            "
          >{{ t(`alerts.add`) }}</OButton>
        </div>
      </div>
    </div>
    <div
      v-if="!showAddAlertDialog && !showImportAlertDialog"
      class="full-width alert-list-table"
      style="height: calc(100vh - 118px)"
    >
      <!-- Alerts View (with folders) -->
      <q-splitter
        v-model="splitterModel"
        unit="px"
        :limits="[200, 500]"
        style="height: calc(100vh - 118px)"
        data-test="alert-list-splitter"
      >
        <template #before>
          <div class="tw:w-full tw:h-full tw:pl-[0.625rem] tw:pb-[0.625rem]">
            <div class="tw:h-full">
              <FolderList
                type="alerts"
                @update:activeFolderId="updateActiveFolderId"
              />
            </div>
          </div>
        </template>
        <template #after>
          <div class="tw:w-full tw:h-full tw:pr-[0.625rem] tw:pb-[0.625rem]">
            <div class="tw:h-full card-container">
              <!-- Alert List Table (shows all alert types including anomaly detection rows) -->
              <q-table
                v-model:selected="selectedAlerts"
                :selected-rows-label="getSelectedString"
                selection="multiple"
                data-test="alert-list-table"
                ref="qTable"
                :rows="filteredResults || []"
                :columns="columns"
                row-key="alert_id"
                :pagination="pagination"
                style="width: 100%"
                :style="
                  filteredResults?.length
                    ? 'width: 100%; height: calc(100vh  - var(--navbar-height) - 87px)'
                    : 'width: 100%'
                "
                class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
              >
                <template v-slot:header="props">
                  <q-tr :props="props">
                    <!-- Adding this block to render the select-all checkbox -->
                    <q-th auto-width>
                      <q-checkbox
                        v-model="props.selected"
                        data-test="alert-list-select-all-checkbox"
                        size="sm"
                        class="o2-table-checkbox"
                        @update:model-value="props.select"
                      />
                    </q-th>

                    <!-- Rendering the rest of the columns -->
                    <q-th
                      v-for="col in props.cols"
                      :key="col.name"
                      :props="props"
                      :class="col.classes"
                      :style="col.style"
                    >
                      <span
                        :style="col.name === 'name' ? 'padding-left: 21px' : ''"
                        >{{ col.label }}</span
                      >
                    </q-th>
                  </q-tr>
                </template>

                <template v-slot:body-selection="scope">
                  <q-checkbox
                    v-model="scope.selected"
                    size="sm"
                    color="secondary"
                  />
                </template>
                <template v-slot:body="props">
                  <q-tr
                    :data-test="`stream-association-table-${props.row.trace_id}-row`"
                    :props="props"
                    style="cursor: pointer"
                    @click="triggerExpand(props)"
                  >
                    <q-td>
                      <q-checkbox
                        v-model="props.selected"
                        size="sm"
                        class="o2-table-checkbox"
                      />
                    </q-td>

                    <q-td v-for="col in columns" :key="col.name"
:props="props">
                      <template v-if="col.name === 'name'">
                        <div class="tw:flex tw:items-center tw:gap-1.5">
                          <q-icon
                            v-if="props.row.is_real_time === 'anomaly'"
                            name="query_stats"
                            size="15px"
                            class="tw:text-blue-600 tw:shrink-0"
                          />
                          <q-icon
                            v-else-if="props.row.is_real_time"
                            name="bolt"
                            size="15px"
                            class="tw:text-orange-500 tw:shrink-0"
                          />
                          <q-icon
                            v-else
                            name="schedule"
                            size="15px"
                            class="tw:text-grey-7 tw:shrink-0"
                          />
                          <span>{{ computedName(props.row[col.field]) }}</span>
                        </div>
                        <q-tooltip
                          v-if="props.row[col.field]?.length > 30"
                          class="alert-name-tooltip"
                        >
                          {{ props.row[col.field] }}
                        </q-tooltip>
                      </template>
                      <template v-else-if="col.name === 'owner'">
                        {{ computedOwner(props.row[col.field]) }}
                        <q-tooltip
                          v-if="props.row[col.field]?.length > 15"
                          class="alert-name-tooltip"
                        >
                          {{ props.row[col.field] }}
                        </q-tooltip>
                      </template>
                      <template
                        v-else-if="
                          col.name == 'last_triggered_at' ||
                          col.name == 'last_satisfied_at' ||
                          col.name == 'last_trained_at'
                        "
                      >
                        <span v-if="props.row[col.field]">{{ props.row[col.field] }}</span>
                        <span v-else class="tw:block">--</span>
                      </template>
                      <template v-else-if="col.name === 'status'">
                        <template v-if="props.row.status && props.row.status !== '--'">
                          <q-badge
                            :color="
                              props.row.status === 'failed'
                                ? 'negative'
                                : props.row.status === 'active'
                                  ? 'positive'
                                  : props.row.status === 'training'
                                    ? 'warning'
                                    : props.row.status === 'disabled'
                                      ? 'grey'
                                      : 'positive'
                            "
                            :label="props.row.status"
                            style="text-transform: capitalize; cursor: default"
                          >
                            <q-tooltip
                              v-if="
                                props.row.status === 'failed' &&
                                props.row.last_error
                              "
                              max-width="400px"
                              anchor="top middle"
                              self="bottom middle"
                            >
                              {{ props.row.last_error }}
                            </q-tooltip>
                          </q-badge>
                        </template>
                        <span v-else class="tw:block">--</span>
                      </template>
                      <template v-else-if="col.name === 'period'">
                        {{
                          props.row[col.field]
                            ? props.row[col.field] >= 60
                              ? props.row[col.field] % 60 === 0
                                ? `${Math.floor(props.row[col.field] / 60)} Hours`
                                : `${Math.floor(props.row[col.field] / 60)} Hours ${props.row[col.field] % 60} Mins`
                              : `${props.row[col.field]} Mins`
                            : "--"
                        }}
                      </template>
                      <template v-else-if="col.name === 'frequency'">
                        {{
                          props.row[col.field]
                            ? props.row[col.field] +
                              (props.row?.frequency_type == "cron"
                                ? ""
                                : " Mins")
                            : "--"
                        }}
                      </template>
                      <template v-else-if="col.name === 'folder_name'">
                        <div
                          @click.stop="
                            updateActiveFolderId(props.row[col.field].id)
                          "
                        >
                          {{ props.row[col.field].name }}
                        </div>
                      </template>
                      <template v-else-if="col.name == 'actions'">
                        <div class="tw:flex tw:items-center actions-container">
                          <div
                            data-test="alert-list-loading-alert"
                            v-if="alertStateLoadingMap[props.row.uuid]"
                            style="
                              display: inline-block;
                              width: 33.14px;
                              height: auto;
                            "
                            class="flex justify-center items-center q-ml-xs"
                            :title="`Turning ${props.row.enabled ? 'Off' : 'On'}`"
                          >
                            <q-circular-progress
                              indeterminate
                              rounded
                              size="16px"
                              :value="1"
                              color="secondary"
                            />
                          </div>
                          <OButton
                            v-else
                            :data-test="`alert-list-${props.row.name}-pause-start-alert`"
                            class="q-ml-xs material-symbols-outlined"
                            :variant="props.row.enabled ? 'ghost-destructive' : 'ghost'"
                            size="icon-circle-sm"
                            :title="
                              props.row.enabled
                                ? t('alerts.pause')
                                : t('alerts.start')
                            "
                            @click.stop="toggleAlertState(props.row)"
                          >
                            <OIcon :name="props.row.enabled ? 'pause' : 'play-arrow'" size="sm" />
                          </OButton>
                          <OButton
                            :data-test="`alert-list-${props.row.name}-update-alert`"
                            variant="ghost"
                            size="icon-circle-sm"
                            :title="t('alerts.edit')"
                            @click.stop="editAlert(props.row)"
                          >
                            <q-icon name="edit" />
                          </OButton>
                          <OButton
                            :title="t('alerts.clone')"
                            variant="ghost"
                            size="icon-circle-sm"
                            @click.stop="duplicateAlert(props.row)"
                            :data-test="`alert-list-${props.row.name}-clone-alert`"
                          >
                            <q-icon name="content_copy" />
                          </OButton>
                          <span>
                            <OButton
                              variant="ghost"
                              size="icon-circle-sm"
                              @click.stop="openMenu($event, props.row)"
                              :data-test="`alert-list-${props.row.name}-more-options`"
                            >
                              <OIcon name="more-vert" size="sm" />
                              <q-menu>
                                <q-list style="min-width: 100px">
                                <q-item
                                  class="flex items-center"
                                  clickable
                                  v-close-popup
                                  @click="moveAlertToAnotherFolder(props.row)"
                                >
                                  <q-item-section dense avatar>
                                    <OIcon name="drive-file-move" size="sm" />
                                  </q-item-section>
                                  <q-item-section>Move</q-item-section>
                                </q-item>
                                <q-separator />
                                <q-item
                                  class="flex items-center justify-center"
                                  clickable
                                  v-close-popup
                                  @click="showDeleteDialogFn(props)"
                                >
                                  <q-item-section dense avatar>
                                    <OIcon name="delete" size="sm" />
                                  </q-item-section>
                                  <q-item-section>{{
                                    t("alerts.delete")
                                  }}</q-item-section>
                                </q-item>
                                <q-separator />
                                <q-item
                                  class="flex items-center justify-center"
                                  clickable
                                  v-close-popup
                                  @click="exportAlert(props.row)"
                                >
                                  <q-item-section dense avatar>
                                    <q-icon size="16px" name="download" />
                                  </q-item-section>
                                  <q-item-section>Export</q-item-section>
                                </q-item>
                                <q-separator />
                                <!-- Anomaly Detection: Trigger Detection + Re-train (always available) -->
                                <template v-if="props.row.type === 'anomaly'">
                                  <q-item
                                    class="flex items-center justify-center"
                                    clickable
                                    v-close-popup
                                    :data-test="`alert-list-${props.row.name}-trigger-detection`"
                                    @click="triggerAlert(props.row)"
                                  >
                                    <q-item-section dense avatar>
                                      <q-icon
                                        size="16px"
                                        :name="symOutlinedSoundSampler"
                                      />
                                    </q-item-section>
                                    <q-item-section
                                      >Trigger Detection</q-item-section
                                    >
                                  </q-item>
                                  <q-item
                                    class="flex items-center justify-center"
                                    clickable
                                    v-close-popup
                                    :data-test="`alert-list-${props.row.name}-retrain-anomaly`"
                                    @click="retrainAnomaly(props.row)"
                                  >
                                    <q-item-section dense avatar>
                                      <q-icon size="16px" name="replay" />
                                    </q-item-section>
                                    <q-item-section>Re-train</q-item-section>
                                  </q-item>
                                </template>
                                <!-- Regular alerts: existing Trigger Alert item -->
                                <q-item
                                  v-else
                                  class="flex items-center justify-center"
                                  clickable
                                  v-close-popup
                                  :data-test="`alert-list-${props.row.name}-trigger-alert`"
                                  @click="triggerAlert(props.row)"
                                >
                                  <q-item-section dense avatar>
                                    <q-icon
                                      size="16px"
                                      :name="symOutlinedSoundSampler"
                                    />
                                  </q-item-section>
                                  <q-item-section>{{
                                    t("alerts.triggerAlert")
                                  }}</q-item-section>
                                </q-item>
                              </q-list>
                            </q-menu>
                            </OButton>
                          </span>
                        </div>
                      </template>
                      <template v-else>
                        {{ props.row[col.field] }}
                      </template>
                    </q-td>
                  </q-tr>
                </template>
                <template #no-data>
                  <div
                    v-if="!templates.length || !destinations.length"
                    class="full-width flex column justify-center items-center text-center"
                  >
                    <div style="width: 600px" class="q-mt-xl">
                      <template v-if="!templates.length">
                        <div
                          class="text-subtitle1"
                          data-test="alert-list-create-template-text"
                        >
                          It looks like you haven't created any Templates yet.
                          To create an Alert, you'll need to have at least one
                          Destination and one Template in place
                        </div>
                        <OButton
                          data-test="alert-list-create-template-btn"
                          class="q-mt-md"
                          variant="primary"
                          size="sm"
                          @click="routeTo('alertTemplates')"
                        >Create Template</OButton>
                      </template>
                      <template v-if="!destinations.length && templates.length">
                        <div
                          class="text-subtitle1"
                          data-test="alert-list-create-destination-text"
                        >
                          It looks like you haven't created any Destinations
                          yet. To create an Alert, you'll need to have at least
                          one Destination and one Template in place
                        </div>
                        <OButton
                          data-test="alert-list-create-destination-btn"
                          class="q-mt-md"
                          variant="primary"
                          size="sm"
                          @click="routeTo('alertDestinations')"
                        >Create Destination</OButton>
                      </template>
                    </div>
                  </div>
                  <template v-else>
                    <NoData />
                  </template>
                </template>

                <template v-slot:body-cell-function="props">
                  <q-td :props="props">
                    <q-tooltip>
                      <pre>{{ props.row.sql }}</pre>
                    </q-tooltip>
                    <pre style="white-space: break-spaces">{{
                      props.row.sql
                    }}</pre>
                  </q-td>
                </template>

                <!-- <template #top="scope">
                  <QTablePagination
                    :scope="scope"
                    :pageTitle="t('alerts.header')"
                    :position="'top'"
                    :resultTotal="resultTotal"
                    :perPageOptions="perPageOptions"
                    @update:changeRecordPerPage="changePagination"
                  />
                </template> -->

                <template #bottom="scope">
                  <div class="bottom-btn tw:h-[48px]">
                    <div
                      class="o2-table-footer-title tw:flex tw:items-center tw:w-[200px] tw:mr-md"
                    >
                      {{ resultTotal }} {{ t("alerts.header") }}
                    </div>

                    <OButton
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-move-across-folders-btn"
                      variant="outline"
                      size="sm"
                      class="q-mr-sm"
                      @click="moveMultipleAlerts"
                    >
                      <OIcon name="drive-file-move" size="sm" />
                      <span class="tw:ml-2">Move</span>
                    </OButton>
                    <OButton
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-export-alerts-btn"
                      variant="outline"
                      size="sm"
                      class="q-mr-sm"
                      @click="multipleExportAlert"
                    >
                      <q-icon name="download" size="16px" />
                      <span class="tw:ml-2">Export</span>
                    </OButton>
                    <OButton
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-pause-alerts-btn"
                      variant="outline"
                      size="sm"
                      class="q-mr-sm"
                      @click="bulkToggleAlerts('pause')"
                    >
                      <q-icon name="pause" size="16px" />
                      <span class="tw:ml-2">Pause</span>
                    </OButton>
                    <OButton
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-unpause-alerts-btn"
                      variant="outline"
                      size="sm"
                      class="q-mr-sm"
                      @click="bulkToggleAlerts('resume')"
                    >
                      <q-icon name="play_arrow" size="16px" />
                      <span class="tw:ml-2">Resume</span>
                    </OButton>
                    <OButton
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-delete-alerts-btn"
                      variant="outline"
                      size="sm"
                      class="q-mr-sm"
                      @click="openBulkDeleteDialog"
                    >
                      <q-icon name="delete" size="16px" />
                      <span class="tw:ml-2">Delete</span>
                    </OButton>
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
        </template>
      </q-splitter>
    </div>
    <template v-else-if="showAddAlertDialog && !showImportAlertDialog">
      <AddAlert
        v-model="formData"
        :isUpdated="isUpdated"
        :destinations="destinations"
        :templates="templates"
        @update:list="refreshList"
        @cancel:hideform="hideForm"
        @refresh:destinations="refreshDestination"
        @refresh:templates="getTemplates"
      />
    </template>
    <template v-else>
      <ImportAlert
        :destinations="destinations"
        :templates="templates"
        :alerts="
          store?.state?.organizationData?.allAlertsListByFolderId[
            activeFolderId
          ]
        "
        :folderId="activeFolderId"
        @update:alerts="refreshImportedAlerts"
        @update:destinations="refreshDestination"
        @update:templates="getTemplates"
      />
    </template>

    <ConfirmDialog
      title="Delete Alert"
      message="Are you sure you want to delete this alert?"
      @update:ok="deleteAlertByAlertId"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />

    <ConfirmDialog
      title="Delete Alerts"
      :message="`Are you sure you want to delete ${selectedAlerts.length} alert(s)?`"
      @update:ok="bulkDeleteAlerts"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />

    <template>
      <ODialog data-test="alert-list-form-dialog"
        v-model:open="showForm"
        persistent
        size="sm"
        :title="t('alerts.cloneTitle')"
        :secondary-button-label="t('alerts.cancel')"
        :primary-button-label="t('alerts.save')"
        :primary-button-disabled="isSubmitting"
        @click:secondary="showForm = false"
        @click:primary="submitForm"
      >
        <template #header-left>
          <div
            data-test="add-alert-back-btn"
            class="flex justify-center items-center cursor-pointer"
            style="
              border: 1.5px solid;
              border-radius: 50%;
              width: 22px;
              height: 22px;
            "
            title="Go Back"
            @click="showForm = false"
          >
            <q-icon name="arrow_back_ios_new" size="14px" />
          </div>
        </template>
        <q-form @submit="submitForm">
          <q-input
            data-test="to-be-clone-alert-name"
            v-model="toBeCloneAlertName"
            label="Alert Name"
            class="showLabelOnTop"
            stack-label
            hide-bottom-space
            borderless
            dense
          />
          <q-select
            data-test="to-be-clone-stream-type"
            v-model="toBeClonestreamType"
            label="Stream Type"
            :options="streamTypes"
            @update:model-value="updateStreams()"
            borderless
            dense
            class="showLabelOnTop no-case tw:mt-[1px]"
          />
          <q-select
            data-test="to-be-clone-stream-name"
            v-model="toBeClonestreamName"
            :loading="isFetchingStreams"
            :disable="!toBeClonestreamType"
            label="Stream Name"
            :options="streamNames"
            @change="updateStreamName"
            @filter="filterStreams"
            use-input
            fill-input
            hide-selected
            :input-debounce="400"
            borderless
            dense
            class="showLabelOnTop no-case tw:mt-[1px] q-mb-sm"
          />
          <div class="q-mb-lg">
            <SelectFolderDropDown
              :type="'alerts'"
              @folder-selected="updateFolderIdToBeCloned"
              :activeFolderId="folderIdToBeCloned"
            />
          </div>
        </q-form>
      </ODialog>
      <MoveAcrossFolders
        v-model:open="showMoveAlertDialog"
        :activeFolderId="activeFolderToMove"
        :moduleId="selectedAlertToMove"
        :anomalyConfigIds="selectedAnomalyConfigsToMove"
        type="alerts"
        @updated="updateAcrossFolders"
        data-test="dashboard-move-to-another-folder-dialog"
      />

      <!-- Alert Details Dialog -->
      <AlertHistoryDrawer
        v-model:open="showAlertDetailsDrawer"
        :alert-details="selectedAlertDetails"
        :alert-id="selectedAlertDetails?.alert_id || ''"
        :alert-type="selectedAlertDetails?.alert_type"
        @edit="editAlertFromDrawer"
        data-test="alert-details-dialog"
      />
    </template>
  </div>
</template>

<script lang="ts">

import {
  defineComponent,
  ref,
  onBeforeMount,
  onActivated,
  onBeforeUnmount,
  watch,
  defineAsyncComponent,
  onMounted,
  computed,
  reactive,
} from "vue";
import type { Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";

import { QTable, date, useQuasar, type QTableProps, debounce } from "quasar";
import { useI18n } from "vue-i18n";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import ImportAlert from "@/components/alerts/ImportAlert.vue";
import DedupSummaryCards from "@/components/alerts/DedupSummaryCards.vue";
import {
  getImageURL,
  getUUID,
  verifyOrganizationStatus,
} from "@/utils/zincutils";
import { getFoldersListByType } from "@/utils/commons";
import { useReo } from "@/services/reodotdev_analytics";
import type { Alert, AlertListItem } from "@/ts/interfaces/index";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import FolderList from "../common/sidebar/FolderList.vue";

import MoveAcrossFolders from "../common/sidebar/MoveAcrossFolders.vue";
import { toRaw } from "vue";
import { nextTick } from "vue";
import SelectFolderDropDown from "../common/sidebar/SelectFolderDropDown.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { LayoutList, CalendarClock, Zap, TrendingUp } from "lucide-vue-next";
import anomalyDetectionService from "@/services/anomaly_detection";
import AlertHistoryDrawer from "@/components/alerts/AlertHistoryDrawer.vue";
import { symOutlinedSoundSampler } from "@quasar/extras/material-symbols-outlined";
import OButton from '@/lib/core/Button/OButton.vue';
import ODialog from '@/lib/overlay/Dialog/ODialog.vue';
import O2AIContextAddBtn from "@/components/common/O2AIContextAddBtn.vue";
import { buildConditionsString } from "@/utils/alerts/conditionsFormatter";
// import alertList from "./alerts";

export default defineComponent({
  name: "AlertList",
  components: {
    QTablePagination,
    AddAlert: defineAsyncComponent(
      () => import("@/components/alerts/AddAlert.vue"),
    ),
    NoData,
    ConfirmDialog,
    ImportAlert,
    DedupSummaryCards,
    FolderList,
    MoveAcrossFolders,
    OToggleGroup,
    OToggleGroupItem,
    LayoutList,
    CalendarClock,
    Zap,
    TrendingUp,
    SelectFolderDropDown,
    AlertHistoryDrawer,
    O2AIContextAddBtn,
    OButton,
    OIcon,
    ODialog,
  },
    "update:changeRecordPerPage",
    "update:maxRecordToReturn",
  ],
  setup() {
    const store = useStore();
    const { t } = useI18n();
    const $q = useQuasar();
    const router = useRouter();
    const { track } = useReo();
    const formData: Ref<Alert | {}> = ref({});
    const toBeClonedAlert: Ref<any> = ref({});
    // Flag to skip clearing search state on the first folder emission after mount.
    // When returning from add/edit screens, the FolderList emits the active folder
    // which would normally clear restored search filters. This flag prevents that.
    const savedAlertListFilters = store.state.alertListFilters || {};
    const isRestoringState = ref(
      !!savedAlertListFilters.searchQuery ||
        !!savedAlertListFilters.filterQuery ||
        !!savedAlertListFilters.searchAcrossFolders,
    );
    const showAddAlertDialog: any = ref(false);
    const qTable: Ref<InstanceType<typeof QTable> | null> = ref(null);
    const selectedDelete: any = ref(null);
    const isUpdated: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const splitterModel = ref(200);
    const showForm = ref(false);
    const indexOptions = ref([]);
    const schemaList = ref([]);
    const streams: any = ref({});
    const isFetchingStreams = ref(false);
    const isSubmitting = ref(false);

    // Compact toolbar: icon-only buttons when AI sidebar is open at narrow widths
    const windowWidth = ref(window.innerWidth);
    const onWindowResize = () => {
      windowWidth.value = window.innerWidth;
    };
    const isCompactToolbar = computed(
      () => store.state.isAiChatEnabled && windowWidth.value <= 1440,
    );


    const showImportAlertDialog = ref(false);
    const showHistoryDrawer = ref(false);
    const selectedHistoryAlertId = ref("");
    const selectedHistoryAlertName = ref("");

    const { getStreams } = useStreams();

    const toBeCloneAlertName = ref("");
    const toBeClonedID = ref("");
    const toBeClonedIsAnomaly = ref(false);
    const toBeClonestreamType = ref("");
    const toBeClonestreamName = ref("");
    const streamTypes = ref(["logs", "metrics", "traces"]);
    const streamNames: Ref<string[]> = ref([]);
    const alertStateLoadingMap: Ref<{ [key: string]: boolean }> = ref({});
    const folders = ref([
      {
        name: "folder1",
      },
      {
        name: "folder2",
      },
    ]);
    const activeFolderId = ref<any>(
      router.currentRoute.value.query.folder ?? "default",
    );
    const showMoveAlertDialog = ref(false);
    const showAlertDetailsDrawer = ref(false);
    const selectedAlertDetails: Ref<any> = ref(null);

    const triggerExpand = (props: any) => {
      // Open drawer instead of inline expansion
      const alert = props.row;

      // LAZY CONVERSION: Convert conditions on-demand only when expanding
      // This improves performance by avoiding conversion of all alerts on list load
      let displayConditions = "--";
      if (alert.rawCondition && Object.keys(alert.rawCondition).length) {
        if (alert.rawCondition.type == "custom") {
          const conditionData = alert.rawCondition.conditions;

          // Detect format by structure, not by version field (more reliable)
          if (conditionData?.filterType === "group") {
            // V2 format: {filterType: "group", logicalOperator: "AND", conditions: [...]}
            displayConditions = transformV2ToExpression(conditionData);
          } else if (
            conditionData?.version === 2 &&
            conditionData?.conditions
          ) {
            // V2 format with version wrapper: {version: 2, conditions: {filterType: "group", ...}}
            displayConditions = transformV2ToExpression(
              conditionData.conditions,
            );
          } else if (conditionData?.or || conditionData?.and) {
            // V1 format: {or: [...]} or {and: [...]}
            displayConditions = transformToExpression(conditionData);
          } else if (Array.isArray(conditionData) && conditionData.length > 0) {
            // V0 format (legacy): flat array [{column, operator, value}, ...]
            // V0 had implicit AND between all conditions (no groups)
            const parts = conditionData.map((item: any) => {
              const column = item.column || "field";
              const operator = item.operator || "=";
              const value =
                typeof item.value === "string" ? `'${item.value}'` : item.value;
              return `${column} ${operator} ${value}`;
            });
            displayConditions =
              parts.length > 0 ? `(${parts.join(" AND ")})` : "--";
          } else {
            // Unknown format or empty
            displayConditions =
              typeof conditionData === "string" ? conditionData : "--";
          }
        } else if (alert.rawCondition.sql) {
          displayConditions = alert.rawCondition.sql;
        } else if (alert.rawCondition.promql) {
          displayConditions = alert.rawCondition.promql;
        }
      }

      // Set selectedAlertDetails with converted conditions
      selectedAlertDetails.value = {
        ...alert,
        conditions: displayConditions,
      };

      showAlertDetailsDrawer.value = true;
    };

    // Handle ESC key and click outside to close drawer
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && showAlertDetailsDrawer.value) {
        showAlertDetailsDrawer.value = false;
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (!showAlertDetailsDrawer.value) return;

      const target = event.target as HTMLElement;

      // Check if clicked element is the backdrop or outside drawer content
      if (
        target.classList.contains("q-drawer__backdrop") ||
        target.classList.contains("q-layout__shadow")
      ) {
        showAlertDetailsDrawer.value = false;
        return;
      }

      // Check if the click is outside the drawer content
      const drawerElement = document.querySelector(
        ".alert-details-drawer .q-drawer__content",
      );
      if (drawerElement && !drawerElement.contains(target)) {
        showAlertDetailsDrawer.value = false;
      }
    };

    onMounted(() => {
      document.addEventListener("keydown", handleKeyDown);
      document.addEventListener("click", handleClickOutside, true);
      window.addEventListener("resize", onWindowResize);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("resize", onWindowResize);
    });

    // Show anomaly detection only when the backend is an enterprise or cloud build.
    // The frontend build flag alone is not sufficient — an enterprise UI can be
    // pointed at an OSS backend which does not have the feature.
    const isAnomalyDetectionEnabled = computed(
      () =>
        store.state.zoConfig.build_type !== "opensource" &&
        config.isEnterprise === "true",
    );

    // Initialize activeTab from URL query parameter, default to "all".
    // Prevent forcing anomalyDetection tab when the feature is not available.
    const rawTab = (router.currentRoute.value.query.tab as string) || "all";
    const activeTab = ref(
      rawTab === "anomalyDetection" && !isAnomalyDetectionEnabled.value
        ? "all"
        : rawTab,
    );

    const filteredResults: Ref<any[]> = ref([]);

    // ── Anomaly polling ──────────────────────────────────────────────────────
    // Statuses that mean the anomaly job is done — no need to keep polling
    const ANOMALY_TERMINAL_STATUSES = ["failed", "active", "completed"];

    const hasNonTerminalAnomalyRows = computed(
      () =>
        activeTab.value === "anomalyDetection" &&
        filteredResults.value.some(
          (row: any) =>
            row.type === "anomaly" &&
            !ANOMALY_TERMINAL_STATUSES.includes(row.status),
        ),
    );

    let anomalyPollingTimer: ReturnType<typeof setInterval> | null = null;

    const stopAnomalyPolling = () => {
      if (anomalyPollingTimer !== null) {
        clearInterval(anomalyPollingTimer);
        anomalyPollingTimer = null;
      }
    };

    const startAnomalyPolling = () => {
      if (anomalyPollingTimer !== null) return; // already running
      anomalyPollingTimer = setInterval(async () => {
        if (!hasNonTerminalAnomalyRows.value) {
          stopAnomalyPolling();
          return;
        }
        await getAlertsFn(store, activeFolderId.value);
      }, 10000);
    };

    watch(hasNonTerminalAnomalyRows, (hasNonTerminal) => {
      if (hasNonTerminal) {
        startAnomalyPolling();
      } else {
        stopAnomalyPolling();
      }
    });
    // ── End anomaly polling ──────────────────────────────────────────────────

    onBeforeUnmount(() => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("click", handleClickOutside, true);
      stopAnomalyPolling();
    });

    const activeFolderToMove = ref("default");

    // Tabs for alerts view
    const alertTabs = computed(() => {
      const tabs: { label: string; value: string }[] = [
        { label: t("alerts.all"), value: "all" },
        { label: t("alerts.scheduled"), value: "scheduled" },
        { label: t("alerts.realTime"), value: "realTime" },
      ];
      if (isAnomalyDetectionEnabled.value) {
        tabs.push({
          label: t("alerts.anomalyDetection"),
          value: "anomalyDetection",
        });
      }
      return tabs;
    });

    // Keep old tabs for backward compatibility if needed
    const tabs = reactive([
      {
        label: t("alerts.all"),
        value: "all",
      },
      {
        label: t("alerts.scheduled"),
        value: "scheduled",
      },
      {
        label: t("alerts.realTime"),
        value: "realTime",
      },
    ]);

    const columns = computed(() => {
      const baseColumns: any = [
        {
          name: "#",
          label: "#",
          field: "#",
          align: "left",
          style: "width: 67px",
        },
        {
          name: "name",
          field: "name",
          label: t("alerts.name"),
          align: "left",
          sortable: true,
        },
        {
          name: "owner",
          field: "owner",
          label: t("alerts.owner"),
          align: "center",
          sortable: true,
          style: "width: 150px",
        },
        // "period" (Look back window) — all tabs except realTime
        ...(activeTab.value !== "realTime"
          ? [
              {
                name: "period",
                field: "period",
                label: t("alerts.period"),
                align: "center",
                sortable: true,
                style: "width: 150px",
              },
            ]
          : []),
        // "frequency" (Check every) — all tabs except realTime
        ...(activeTab.value !== "realTime"
          ? [
              {
                name: "frequency",
                field: "frequency",
                label: t("alerts.frequency"),
                align: "left",
                sortable: true,
                style: "width: 150px",
              },
            ]
          : []),
        {
          name: "last_triggered_at",
          field: "last_triggered_at",
          label: t("alerts.lastTriggered"),
          align: "left",
          sortable: true,
          style: "width: 150px",
        },
        {
          name: "last_satisfied_at",
          field: "last_satisfied_at",
          label: t("alerts.lastSatisfied"),
          align: "left",
          sortable: true,
          style: "width: 150px",
        },
        // Anomaly Detection columns — shown on anomalyDetection and all tabs
        ...(activeTab.value === "anomalyDetection" || activeTab.value === "all"
          ? [
              {
                name: "last_trained_at",
                field: "last_trained_at",
                label: "Last Trained At",
                align: "left" as const,
                sortable: true,
                style: "width: 150px",
              },
              {
                name: "status",
                field: "status",
                label: "Status",
                align: "left" as const,
                sortable: true,
                style: "width: 120px",
              },
            ]
          : []),
        {
          name: "actions",
          field: "actions",
          label: t("alerts.actions"),
          align: "center",
          sortable: false,
          style: "width: 150px",
          classes: "actions-column", //this is the class that we are adding to the actions column so that we can apply the styling to the actions column only
        },
      ];

      // insert folder_name column if applicable
      if (searchAcrossFolders.value && searchQuery.value !== "") {
        baseColumns.splice(2, 0, {
          name: "folder_name",
          field: "folder_name",
          label: "Folder",
          align: "center",
          sortable: true,
          style: "width: 150px",
        });
      }

      return baseColumns;
    });

    const destinations = ref([0]);
    const templates = ref([0]);
    const selectedAlerts: Ref<any> = ref([]);
    const allSelectedAlerts = ref(false);
    const allAlerts: Ref<any[]> = ref([]);

    const searchQuery = ref<any>(savedAlertListFilters.searchQuery || "");
    const filterQuery = ref<any>(savedAlertListFilters.filterQuery || "");
    const searchAcrossFolders = ref<any>(
      savedAlertListFilters.searchAcrossFolders || false,
    );
    const selectedAlertToMove: Ref<any[]> = ref([]);
    const selectedAnomalyConfigsToMove: Ref<any[]> = ref([]);
    const folderIdToBeCloned = ref<any>(
      router.currentRoute.value.query.folder ?? "default",
    );
    // ---------------------------------------------------------------------------
    // Anomaly detection scaffolding — TEMPORARY until backend returns anomaly
    // data as part of the alert list API. Remove this block when that happens.
    // ---------------------------------------------------------------------------
    // Normalizes an anomaly-detection item returned by the merged alerts list API
    // (alert_type === "anomaly_detection") into the standard alert row shape.
    const normalizeAnomalyToAlertRow = (
      anomaly: any,
      counter: number,
    ): any => ({
      "#": counter <= 9 ? `0${counter}` : `${counter}`,
      alert_id: anomaly.alert_id || anomaly.anomaly_id || anomaly.id,
      anomaly_id: anomaly.alert_id || anomaly.anomaly_id || anomaly.id,
      name: anomaly.name,
      alert_type: "anomaly_detection",
      stream_name: anomaly.stream_name || "--",
      stream_type: anomaly.stream_type || "--",
      enabled: anomaly.enabled,
      conditions: "--",
      rawCondition: {},
      detection_function: anomaly.detection_function || "",
      query_mode: anomaly.query_mode || "filters",
      custom_sql: anomaly.custom_sql || "",
      filters: anomaly.filters || [],
      histogram_interval: anomaly.histogram_interval || "",
      description: anomaly.description || "",
      uuid: getUUID(),
      owner: anomaly.owner || "",
      period: anomaly.trigger_condition?.period ?? "",
      frequency: anomaly.trigger_condition?.frequency ?? "",
      frequency_type: anomaly.trigger_condition?.frequency_type ?? "minutes",
      last_triggered_at: anomaly.last_triggered_at
        ? convertUnixToQuasarFormat(anomaly.last_triggered_at)
        : "",
      last_satisfied_at: anomaly.last_satisfied_at
        ? convertUnixToQuasarFormat(anomaly.last_satisfied_at)
        : "",
      detection_window: (() => {
        const mins = anomaly.trigger_condition?.period_minutes;
        if (!mins) return "--";
        if (mins >= 60) {
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return m === 0 ? `${h} Hours` : `${h} Hours ${m} Mins`;
        }
        return `${mins} mins`;
      })(),
      last_trained_at: anomaly.last_trained_at
        ? convertUnixToQuasarFormat(anomaly.last_trained_at)
        : "",
      total_evaluations: anomaly.total_evaluations ?? "--",
      firing_count: anomaly.firing_count ?? "--",
      status: anomaly.status || "--",
      last_error: anomaly.last_error || null,
      selected: false,
      type: "anomaly",
      folder_name: {
        name: anomaly.folder_name || "default",
        id: anomaly.folder_id || "",
      },
      // Marker: "anomaly" distinguishes these rows from boolean is_real_time alerts
      is_real_time: "anomaly",
    });

    // ---------------------------------------------------------------------------

    const getAlertsByFolderId = async (store: any, folderId: any) => {
      try {
        //this is the condition where we are fetching the alerts from the server
        // assigning it to the allAlertsListByFolderId in the store
        if (!store.state.organizationData.allAlertsListByFolderId[folderId]) {
          await getAlertsFn(store, folderId);
        } else {
          //this is the condition where we are assigning the alerts to the filteredResults so whenever
          // we are not fetching the alerts again, we are just assigning the alerts to the filteredResults
          allAlerts.value =
            store.state.organizationData.allAlertsListByFolderId[folderId];
        }
      } catch (error) {
        throw error;
      }
    };
    const getAlertsFn = async (
      store: any,
      folderId: any,
      query = "",
      refreshResults = true,
    ) => {
      //why refreshResults flag is used
      // this is the only used for one edge case when we move alerts from one folder to another folder
      //we forcing the destination and source folder to fetch the alerts again
      //so what happens is that if destination folder takes time to fetch the alerts by the time source folder finishes it call
      //and assign the alerts and the after that destination folder will resovle and override the source folder alerts
      //so to avoid this we are using the refreshResults flag
      //if the flag is false then we are not assigning the alerts to the filteredResults
      //and if the flag is true then we are assigning the alerts to the filteredResults
      //and also we are not filtering the alerts by the activeTab if the flag is false because we dont need to show the alerts in the table
      //for a moment also so we are not filtering the alerts by the activeTab
      selectedAlerts.value = [];
      allSelectedAlerts.value = false;
      if (query) {
        //here we reset the filteredResults before fetching the filtered alerts
        filteredResults.value = [];
      }
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading alerts...",
      });
      if (query) {
        folderId = "";
      }
      try {
        const res = await alertsService.listByFolderId(
          1,
          1000,
          "name",
          false,
          "",
          store?.state?.selectedOrganization?.identifier,
          folderId,
          query,
        );
        var counter = 1;
        let localAllAlerts = [];
        //this is the alerts that we use to store
        localAllAlerts = res.data.list.map((alert: any) => {
          return {
            ...alert,
            uuid: getUUID(),
          };
        });

        //general alerts that we use to display (formatting the alerts into the table format)
        //localAllAlerts is the alerts that we use to store
        // PERFORMANCE OPTIMIZATION: Store raw condition data without conversion
        // Conversion happens lazily only when user expands an alert (in triggerExpand)
        // Anomaly detection items (alert_type === "anomaly_detection") are handled by
        // normalizeAnomalyToAlertRow which reads period/frequency from trigger_condition.
        localAllAlerts = localAllAlerts.map((data: any) => {
          if (data.alert_type === "anomaly_detection") {
            const num = counter++;
            return normalizeAnomalyToAlertRow(data, num);
          }

          let frequency = "";
          if (data.trigger_condition?.frequency_type == "cron") {
            frequency = data.trigger_condition.cron;
          } else {
            frequency = data.trigger_condition.frequency;
          }

          return {
            "#": counter <= 9 ? `0${counter++}` : counter++,
            alert_id: data.alert_id,
            name: data.name,
            alert_type: data.is_real_time ? "Real Time" : "Scheduled",
            stream_name: data.stream_name ? data.stream_name : "--",
            stream_type: data.stream_type,
            enabled: data.enabled,
            conditions: "--", // Placeholder - will be converted on-demand in triggerExpand
            rawCondition: data.condition, // Store raw condition for lazy conversion
            description: data.description,
            uuid: data.uuid,
            owner: data.owner,
            period: data.is_real_time ? "" : data?.trigger_condition?.period,
            frequency: data.is_real_time ? "" : frequency,
            frequency_type: data?.trigger_condition?.frequency_type,
            last_triggered_at: convertUnixToQuasarFormat(
              data.last_triggered_at,
            ),
            last_satisfied_at: convertUnixToQuasarFormat(
              data.last_satisfied_at,
            ),
            last_trained_at: "",
            status: "--",
            selected: false,
            type: data.condition.type,
            folder_name: {
              name: data.folder_name,
              id: data.folder_id,
            },
            is_real_time: data.is_real_time,
          };
        });

        //this is the condition where we are setting the alertStateLoadingMap
        localAllAlerts.forEach((alert: any) => {
          alertStateLoadingMap.value[alert.uuid as string] = false;
        });
        //this is the condition where we are setting the allAlertsListByFolderId in the store
        store?.dispatch("setAllAlertsListByFolderId", {
          ...store.state.organizationData.allAlertsListByFolderId,
          [folderId]: localAllAlerts,
        });
        //RACE CONDITION handling
        //this is the condition where we are checking the if the folderId is not equal to the activeFolderId
        //if it is not equal then we are returning  and if is not search across folders then we are returning as well as in previous step we are anyways storing in the store for future use
        //this will prevent the side effects of allAlerts are overriding the actual alerts if users are rapidly moving from one folder to another folder
        if (folderId != activeFolderId.value && !query) {
          dismiss();
          return;
        }
        //here we are actually assigning the localAllAlerts to the allAlerts to avoid the side effects of allAlerts are overriding the actual alerts if users are rapidly moving from one folder to another folder
        allAlerts.value = localAllAlerts;
        //this is the condition where we are setting the filteredResults
        //1. If it is search across folders then also we are setting the filteredResults(which contains the filtered alerts)
        //2. If it is not search across folders then we are setting the filteredResults to the alerts(which contains all the alerts)
        //here we are setting the filteredResults to the alerts
        if (refreshResults) {
          filteredResults.value = allAlerts.value;
        }

        //here we are filtering the alerts by the activeTab
        //why we are passing the refreshResults flag as false because we dont need to show the alerts in the table
        filterAlertsByTab(refreshResults);
        if (router.currentRoute.value.query.action == "import") {
          showImportAlertDialog.value = true;
        }
        if (router.currentRoute.value.query.action == "add") {
          showAddUpdateFn({ row: undefined });
        }
        if (router.currentRoute.value.query.action == "update") {
          const alertId = router.currentRoute.value.query.alert_id as string;
          const alert = await getAlertById(alertId);

          showAddUpdateFn({
            row: alert,
          });
        }
        dismiss();
      } catch (error) {
        console.error(error);
        dismiss();
        $q.notify({
          type: "negative",
          message: "Error while pulling alerts.",
          timeout: 2000,
        });
      }
    };
    const getAlertById = async (id: string) => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while loading alert...",
      });
      try {
        const res = await alertsService.get_by_alert_id(
          store.state.selectedOrganization.identifier,
          id,
        );
        dismiss();
        return res.data;
      } catch (error) {
        dismiss();
        throw error;
      }
    };
    onBeforeMount(async () => {
      await getTemplates();
      getDestinations();
    });
    onActivated(() => getDestinations());

    // Define filterAlertsByTab before watchers that use it
    const filterAlertsByTab = (refreshResults: boolean = true) => {
      if (!refreshResults) {
        return;
      }
      // When incidents tab is active, skip filtering (IncidentList handles its own data)
      if (activeTab.value === "incidents") {
        return;
      }
      if (activeTab.value === "scheduled") {
        // Scheduled: is_real_time is falsy (false / undefined / null) — anomaly rows ("anomaly") excluded
        filteredResults.value = allAlerts.value.filter(
          (alert: any) => !alert.is_real_time,
        );
      } else if (activeTab.value === "realTime") {
        // Real-time: strictly boolean true — anomaly rows excluded
        filteredResults.value = allAlerts.value.filter(
          (alert: any) => alert.is_real_time === true,
        );
      } else if (activeTab.value === "anomalyDetection") {
        // Anomaly Detection: rows injected by normalizeAnomalyToAlertRow with is_real_time === "anomaly"
        filteredResults.value = allAlerts.value.filter(
          (alert: any) => alert.is_real_time === "anomaly",
        );
      } else {
        // "all" — show everything
        filteredResults.value = allAlerts.value;
      }
    };

    // onMounted(async () => {
    //   if (!store.state.organizationData.foldersByType) {
    //     await getFoldersListByType(store, "alerts");
    //   }
    //   if (
    //     router.currentRoute.value.query.folder &&
    //     store.state.organizationData?.foldersByType?.find(
    //       (it: any) => it.folderId === router.currentRoute.value.query.folder,
    //     )
    //   ) {
    //     activeFolderId.value = router.currentRoute.value.query.folder as string;
    //   } else {
    //     activeFolderId.value = "default";
    //   }
    //   await getAlertsFn(store, router.currentRoute.value.query.folder ?? "default");
    //   filterAlertsByTab();
    // });
    watch(
      () => store.state.organizationData.foldersByType["alerts"],
      async (folders) => {
        if (!folders) return;

        const folderQuery = router.currentRoute.value.query.folder;
        const matchingFolder = folders.find(
          (it: any) => it.folderId === folderQuery,
        );

        activeFolderId.value = matchingFolder ? folderQuery : "default";
        filterAlertsByTab();
      },
      { immediate: true },
    );
    watch(
      () => activeFolderId.value,
      async (newVal) => {
        folderIdToBeCloned.value = newVal;
        selectedAlerts.value = [];
        allSelectedAlerts.value = false;

        if (newVal == router.currentRoute.value.query.folder) {
          return;
        }
        if (searchAcrossFolders.value) {
          searchAcrossFolders.value = false;
          searchQuery.value = "";
          filteredResults.value = [];
        }
        await getAlertsByFolderId(store, newVal);
        if (router.currentRoute.value.query.folder != newVal) {
          router.push({
            name: "alertList",
            query: {
              ...router.currentRoute.value.query,
              org_identifier: store.state.selectedOrganization.identifier,
              folder: activeFolderId.value,
            },
          });
        }
        filterAlertsByTab();
      },
    );

    watch(searchQuery, async (newQuery) => {
      selectedAlerts.value = [];
      allSelectedAlerts.value = false;
      //here we check the if the new Query is empty and searchAcrossFolders is true
      //then only we are fetching the alerts by the folderId and then filtering the alerts by the activeTab
      //this is done because when we click on the any folder that is there in the the row when we do search across folders
      //at that time also we are resetting theh searchQuery if any so it will trigger this watch which will cause fetching the alerts again
      //so to avoid we are checking the if the newQuery is empty and searchAcrossFolders is true
      if (newQuery == "" && searchAcrossFolders.value) {
        //here we are fetching the alerts by the folderId and then filtering the alerts by the activeTab
        //this is done because for empty searchQuery we need to fetch the alerts by the folderId
        await getAlertsByFolderId(store, activeFolderId.value);
        filterAlertsByTab();
      } else {
        //here we are filtering the alerts by the searchQuery
        await debouncedSearch(newQuery);
        filterAlertsByTab();
      }
    });
    watch(
      () => router.currentRoute.value.query.action,
      async (action) => {
        if (!action) {
          showAddAlertDialog.value = false;
          showImportAlertDialog.value = false;
          return;
        }

        // Handle update action
        if (action === "update" && router.currentRoute.value.query.alert_id) {
          const alertId = router.currentRoute.value.query.alert_id as string;
          try {
            const alert = await getAlertById(alertId);
            showAddUpdateFn({ row: alert });
          } catch (error) {
            console.error("AlertList: Failed to load alert", error);
            $q.notify({
              type: "negative",
              message: "Failed to load alert for editing",
              timeout: 2000,
            });
          }
        }

        // Handle add action
        if (action === "add") {
          showAddUpdateFn({ row: undefined });
        }

        // Handle import action
        if (action === "import") {
          showImportAlertDialog.value = true;
        }
      },
      { immediate: true }, // Run immediately to handle direct navigation
    );
    const getDestinations = async () => {
      destinationService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
          module: "alert",
        })
        .then((res) => {
          destinations.value = res.data;
        })
        .catch(() =>
          $q.notify({
            type: "negative",
            message: "Error while fetching destinations.",
            timeout: 3000,
          }),
        );
    };

    const getTemplates = () => {
      templateService
        .list({
          org_identifier: store.state.selectedOrganization.identifier,
        })
        .then((res) => {
          templates.value = res.data;
        })
        .catch(() =>
          $q.notify({
            type: "negative",
            message: "Error while fetching templates.",
            timeout: 3000,
          }),
        );
    };
    const perPageOptions: any = [
      { label: "20", value: 20 },
      { label: "50", value: 50 },
      { label: "100", value: 100 },
      { label: "250", value: 250 },
      { label: "500", value: 500 },
    ];
    const resultTotal = computed(function () {
      return filteredResults.value?.length;
    });
    const maxRecordToReturn = ref<number>(100);
    const selectedPerPage = ref<number>(savedAlertListFilters.perPage || 20);
    const pagination: any = ref({
      rowsPerPage: savedAlertListFilters.perPage || 20,
    });
    const changePagination = (val: { label: string; value: any }) => {
      selectedPerPage.value = val.value;
      pagination.value.rowsPerPage = val.value;
      qTable.value?.setPagination(pagination.value);
    };
    const changeMaxRecordToReturn = (val: any) => {
      maxRecordToReturn.value = val;
    };

    function convertUnixToQuasarFormat(unixMicroseconds: any) {
      if (!unixMicroseconds) return "";
      const unixSeconds = unixMicroseconds / 1e6;
      const dateToFormat = new Date(unixSeconds * 1000);
      const formattedDate = dateToFormat.toISOString();
      return date.formatDate(formattedDate, "YYYY-MM-DD HH:mm:ss");
    }

    const addAlert = () => {
      showAddAlertDialog.value = true;
    };

    const duplicateAlert = async (row: any) => {
      toBeClonedID.value = row.alert_id;
      toBeCloneAlertName.value = row.name;
      toBeClonedIsAnomaly.value = row.type === "anomaly";
      toBeClonestreamName.value = "";
      toBeClonestreamType.value = "";
      showForm.value = true;
      // Anomaly rows use the /clone endpoint — no need to pre-fetch full data
      if (!toBeClonedIsAnomaly.value) {
        toBeClonedAlert.value = await getAlertById(row.alert_id);
      }
    };
    const submitForm = async () => {
      // Anomaly rows: use the dedicated /clone endpoint (no fetch+mutate dance needed)
      if (toBeClonedIsAnomaly.value) {
        if (!toBeClonestreamType.value) {
          $q.notify({
            type: "negative",
            message: "Please select stream type ",
            timeout: 2000,
          });
          return;
        }
        if (!toBeClonestreamName.value) {
          $q.notify({
            type: "negative",
            message: "Please select stream name",
            timeout: 2000,
          });
          return;
        }
        isSubmitting.value = true;
        const dismiss = $q.notify({
          spinner: true,
          message: "Please wait...",
          timeout: 2000,
        });
        try {
          await alertsService.clone_by_id(
            store.state.selectedOrganization.identifier,
            toBeClonedID.value,
            {
              name: toBeCloneAlertName.value,
              folder_id: (folderIdToBeCloned.value as string) || "default",
              stream_type: toBeClonestreamType.value,
              stream_name: toBeClonestreamName.value,
            },
          );
          dismiss();
          $q.notify({
            type: "positive",
            message: "Anomaly detection cloned successfully",
            timeout: 2000,
          });
          showForm.value = false;
          await getAlertsFn(store, folderIdToBeCloned.value);
          activeFolderId.value = folderIdToBeCloned.value;
        } catch (e: any) {
          dismiss();
          $q.notify({
            type: "negative",
            message:
              e?.response?.data?.message || "Failed to clone anomaly detection",
            timeout: 2000,
          });
        } finally {
          isSubmitting.value = false;
        }
        return;
      }

      if (!toBeClonedAlert.value) {
        $q.notify({
          type: "negative",
          message: "Alert not found",
          timeout: 2000,
        });
        return;
      }
      if (!toBeClonestreamType.value) {
        $q.notify({
          type: "negative",
          message: "Please select stream type ",
          timeout: 2000,
        });
        return;
      }
      if (!toBeClonestreamName.value) {
        $q.notify({
          type: "negative",
          message: "Please select stream name",
          timeout: 2000,
        });
        return;
      }
      isSubmitting.value = true;
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait...",
        timeout: 2000,
      });

      toBeClonedAlert.value.name = toBeCloneAlertName.value;
      toBeClonedAlert.value.stream_name = toBeClonestreamName.value;
      toBeClonedAlert.value.stream_type = toBeClonestreamType.value;
      toBeClonedAlert.value.folder_id = activeFolderId.value;
      try {
        //removed id from the alert payload
        if (toBeClonedAlert.value?.id) {
          delete toBeClonedAlert.value?.id;
        }
        //assigning the owner from the alert payload because the current logged in user will be the owner of the cloned alert
        toBeClonedAlert.value.owner = store.state.userInfo.email;
        //assigning the last_edited_by from the alert payload because the current logged in user will be the last_edited_by of the cloned alert
        toBeClonedAlert.value.last_edited_by = store.state.userInfo.email;
        //here using the folderIdToBeCloned.value because we need to clone the alert in the folder which is selected by the user
        alertsService
          .create_by_alert_id(
            store.state.selectedOrganization.identifier,
            toBeClonedAlert.value,
            folderIdToBeCloned.value,
          )
          .then(async (res) => {
            dismiss();
            if (res.data.code == 200) {
              $q.notify({
                type: "positive",
                message: "Alert Cloned Successfully",
                timeout: 2000,
              });
              showForm.value = false;
              await getAlertsFn(store, folderIdToBeCloned.value);
              activeFolderId.value = folderIdToBeCloned.value;
            } else {
              $q.notify({
                type: "negative",
                message: res.data.message,
                timeout: 2000,
              });
            }
          })
          .catch((e: any) => {
            if (e.response?.status == 403) {
              showForm.value = false;
              isSubmitting.value = false;
              return;
            }
            dismiss();
            $q.notify({
              type: "negative",
              message: e.response.data.message,
              timeout: 2000,
            });
          })
          .finally(() => {
            isSubmitting.value = false;
          });
      } catch (e: any) {
        showForm.value = true;
        isSubmitting.value = false;
        $q.notify({
          type: "negative",
          message: e.data.message,
          timeout: 2000,
        });
      }
    };
    const showAddUpdateFn = async (props: any) => {
      //made this async because we need to wait for the router to navigate
      //so that we can get the alert_type from the query params
      formData.value = props.row;
      let action;
      try {
        if (!props.row) {
          isUpdated.value = false;
          action = "Add Alert";
          await router.push({
            name: "alertList",
            query: {
              ...router.currentRoute.value.query,
              action: "add",
              org_identifier: store.state.selectedOrganization.identifier,
              folder: activeFolderId.value,
              alert_type: activeTab.value,
            },
          });
        } else {
          isUpdated.value = true;
          action = "Update Alert";
          await router.push({
            name: "alertList",
            query: {
              ...router.currentRoute.value.query,
              alert_id: props.row.id,
              action: "update",
              name: props.row.name,
              org_identifier: store.state.selectedOrganization.identifier,
              folder: activeFolderId.value,
            },
          });
        }
        addAlert();
        if (config.enableAnalytics == "true") {
          segment.track("Button Click", {
            button: action,
            user_org: store.state.selectedOrganization.identifier,
            user_id: store.state.userInfo.email,
            page: "Alerts",
          });
        }
        track("Button Click", {
          button: action,
          page: "Add Alert",
        });
      } catch (error) {
        console.error("Navigation failed:", error);
      }
    };
    const refreshList = async (folderId?: string) => {
      //here we are fetching the alerts from the server because after creating the alert we should get the latest alerts
      //and then we are setting the activeFolderId to the folderId
      //this is done to avoid multiple api calls , when we assign the folderId before fetching it will trigger the watch and it will fetch the alerts again
      //and we dont need to fetch the alerts again because we are already fetching the alerts in the getAlertsFn
      const resolvedFolderId = folderId || activeFolderId.value || "default";
      // Always fetch the latest alerts for the folder from backend
      await getAlertsFn(store, resolvedFolderId);
      // Re-apply active search/filter on the freshly fetched data
      if (filterQuery.value) {
        filterAlertsByQuery(filterQuery.value);
      }
      await hideForm();
      activeFolderId.value = resolvedFolderId;
    };
    const hideForm = async () => {
      showAddAlertDialog.value = false;
      await router.push({
        name: "alertList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value,
          tab: activeTab.value,
        },
      });
      track("Button Click", {
        button: "Hide Form",
        page: "Add Alert",
      });
    };
    const deleteAlertByAlertId = () => {
      alertsService
        .delete_by_alert_id(
          store.state.selectedOrganization.identifier,
          selectedDelete.value.alert_id,
          activeFolderId.value,
        )
        .then(async (res: any) => {
          if (res.data.code == 200) {
            $q.notify({
              type: "positive",
              message: res.data.message,
              timeout: 2000,
            });
            await getAlertsFn(store, activeFolderId.value);
            if (filterQuery.value) {
              filterAlertsByQuery(filterQuery.value);
            }
          } else {
            $q.notify({
              type: "negative",
              message: res.data.message,
              timeout: 2000,
            });
          }
        })
        .catch((err) => {
          if (err.response?.status == 403) {
            return;
          }
          $q.notify({
            type: "negative",
            message: err?.data?.message || "Error while deleting alert.",
            timeout: 2000,
          });
        });
      if (config.enableAnalytics == "true") {
        segment.track("Button Click", {
          button: "Delete Alert",
          user_org: store.state.selectedOrganization.identifier,
          user_id: store.state.userInfo.email,
          alert_name: selectedDelete.value.name,
          page: "Alerts",
        });
      }
    };
    const showDeleteDialogFn = (props: any) => {
      selectedDelete.value = props.row;
      confirmDelete.value = true;
    };
    const filterColumns = (options: any[], val: String, update: Function) => {
      let filteredOptions: any[] = [];
      if (val === "") {
        update(() => {
          filteredOptions = [...options];
        });
        return filteredOptions;
      }
      update(() => {
        const value = val.toLowerCase();
        filteredOptions = options.filter(
          (column: any) => column.toLowerCase().indexOf(value) > -1,
        );
      });
      return filteredOptions;
    };
    const updateStreamName = (selectedOption: any) => {
      toBeClonestreamName.value = selectedOption;
    };
    const updateStreams = (resetStream = true) => {
      if (resetStream) toBeClonestreamName.value = "";
      if (streams.value[toBeClonestreamType.value]) {
        schemaList.value = streams.value[toBeClonestreamType.value];
        indexOptions.value = streams.value[toBeClonestreamType.value].map(
          (data: any) => {
            return data.name;
          },
        );
        updateStreamName(toBeClonestreamName.value);

        return;
      }

      if (!toBeClonestreamType.value) return Promise.resolve();

      isFetchingStreams.value = true;
      return getStreams(toBeClonestreamType.value, false)
        .then((res: any) => {
          streams.value[toBeClonestreamType.value] = res.list;
          schemaList.value = res.list;
          indexOptions.value = res.list.map((data: any) => {
            return data.name;
          });

          return Promise.resolve();
        })
        .catch(() => Promise.reject())
        .finally(() => (isFetchingStreams.value = false));
    };
    const filterStreams = (val: string, update: any) => {
      streamNames.value = filterColumns(indexOptions.value, val, update);
    };

    const toggleAlertState = (row: any) => {
      alertStateLoadingMap.value[row.uuid] = true;

      alertsService
        .toggle_state_by_alert_id(
          store.state.selectedOrganization.identifier,
          row.alert_id,
          !row?.enabled,
          activeFolderId.value,
        )
        .then((res: any) => {
          const isEnabled = res.data.enabled;
          filteredResults.value.forEach((alert: any) => {
            alert.uuid === row.uuid ? (alert.enabled = isEnabled) : null;
          });
          $q.notify({
            type: "positive",
            message: isEnabled
              ? "Alert Resumed Successfully"
              : "Alert Paused Successfully",
            timeout: 2000,
          });
        })
        .finally(() => {
          alertStateLoadingMap.value[row.uuid] = false;
        });
    };

    const routeTo = (name: string) => {
      router.push({
        name: name,
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value,
        },
      });
    };

    const refreshDestination = async () => {
      await getDestinations();
    };

    const importAlert = () => {
      showImportAlertDialog.value = true;
      router.push({
        name: "alertList",
        query: {
          action: "import",
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value,
        },
      });
    };

    const goToAlertInsights = () => {
      router.push({
        name: "alertInsights",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const goToAlertHistory = () => {
      router.push({
        name: "alertHistory",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    };

    const exportAlert = async (row: any) => {
      // Use the /export endpoint — strips runtime fields for anomaly configs, works for regular alerts too
      const res = await alertsService.export_by_id(
        store.state.selectedOrganization.identifier,
        row.alert_id,
      );
      const alertToBeExported = res.data;

      if (alertToBeExported.hasOwnProperty("id")) {
        delete alertToBeExported.id;
      }

      // Ensure that the alert exists before proceeding
      if (alertToBeExported) {
        // Convert the alert object to a JSON string
        const alertJson = JSON.stringify(alertToBeExported, null, 2);

        // Create a Blob from the JSON string
        const blob = new Blob([alertJson], { type: "application/json" });

        // Create an object URL for the Blob
        const url = URL.createObjectURL(blob);

        // Create an anchor element to trigger the download
        const link = document.createElement("a");
        link.href = url;

        // Set the filename of the download
        link.download = `${alertToBeExported.name}.json`;

        // Trigger the download by simulating a click
        link.click();

        // Clean up the URL object after download
        URL.revokeObjectURL(url);
      } else {
        // Alert not found, handle error or show notification
        console.error("Alert not found for UUID:", row.uuid);
      }
    };

    const triggerAlert = async (row: any) => {
      try {
        await alertsService.trigger_alert(
          store.state.selectedOrganization.identifier,
          row.alert_id,
          row.folder_name?.id,
        );
        $q.notify({
          type: "positive",
          message: t("alerts.alertTriggeredSuccess"),
          timeout: 2000,
        });
        if (row.type === "anomaly") {
          await getAlertsFn(store, activeFolderId.value);
        }
      } catch (error: any) {
        $q.notify({
          type: "negative",
          message: error?.response?.data?.message || "Failed to trigger alert",
          timeout: 2000,
        });
      }
    };

    const retrainAnomaly = async (row: any) => {
      try {
        await alertsService.retrain_by_id(
          store.state.selectedOrganization.identifier,
          row.alert_id,
        );
        row.status = "training";
        $q.notify({
          type: "positive",
          message: "Retraining triggered",
          timeout: 2000,
        });
      } catch (error: any) {
        $q.notify({
          type: "negative",
          message:
            error?.response?.data?.message || "Failed to trigger retraining",
          timeout: 2000,
        });
      }
    };

    const updateActiveFolderId = async (newVal: any) => {
      //this is the condition we kept because when we we click on the any folder that is there in the the row when we do search across folders
      //at that time if it is the same folder it wont trigger the watch and it will show the alerts of the filtered only
      //so we are fetching the alerts by the folderId and then filtering the alerts by the activeTab this is done explicitly on only if users clicks on same folder
      if (newVal == activeFolderId.value) {
        if (isRestoringState.value) {
          // Force fresh fetch from backend (cache may be stale after add/edit on another route)
          isRestoringState.value = false;
          await getAlertsFn(store, newVal);
          if (searchAcrossFolders.value && searchQuery.value) {
            await getAlertsFn(store, activeFolderId.value, searchQuery.value);
            filterAlertsByTab();
          } else if (filterQuery.value) {
            filterAlertsByQuery(filterQuery.value);
          } else {
            filterAlertsByTab();
          }
          return;
        }
        await getAlertsByFolderId(store, newVal);
        filterAlertsByTab();
      }
      // When restoring state from a prior navigation, skip clearing search filters
      if (isRestoringState.value) {
        isRestoringState.value = false;
        await getAlertsFn(store, newVal);
        if (filterQuery.value) {
          filterAlertsByQuery(filterQuery.value);
        } else {
          filterAlertsByTab();
        }
        activeFolderId.value = newVal;
        return;
      }
      //here we are resetting the searchQuery, filterQuery, searchAcrossFolders, allSelectedAlerts, selectedAlerts
      //here we only reset if the value is not null
      if (searchQuery.value) searchQuery.value = "";
      if (filterQuery.value) filterQuery.value = "";
      if (searchAcrossFolders.value) searchAcrossFolders.value = false;
      if (allSelectedAlerts.value) allSelectedAlerts.value = false;
      if (selectedAlerts.value) selectedAlerts.value = [];
      activeFolderId.value = newVal;
      //here we are resetting the selected alerts
      //this is done because we need to reset the selected alerts when the user is changing the folder
      //this is not needed but we are doing it to avoid any potential issues
      filteredResults.value?.forEach((alert: any) => {
        alert.selected = false;
      });
    };

    const editAlert = async (row: any) => {
      // Anomaly detection rows route to the dedicated edit page
      if (row.type === "anomaly") {
        await router.push({
          name: "editAnomalyDetection",
          params: { anomaly_id: row.alert_id },
          query: {
            org_identifier: store.state.selectedOrganization.identifier,
            folder: activeFolderId.value,
            tab: activeTab.value,
          },
        });
        return;
      }
      // Don't fetch alert data here - let the watcher handle it to avoid duplicate API calls
      // Just trigger the route change with alert_id, the watcher will fetch and call showAddUpdateFn
      await router.push({
        name: "alertList",
        query: {
          ...router.currentRoute.value.query,
          alert_id: row.alert_id,
          action: "update",
          name: row.name,
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value,
        },
      });
    };

    const editAlertFromDrawer = async () => {
      if (!selectedAlertDetails.value) return;

      // Close the drawer first
      showAlertDetailsDrawer.value = false;

      // Reuse the same edit flow as the listing page
      await editAlert(selectedAlertDetails.value);
    };

    const moveAlertToAnotherFolder = (row: any) => {
      showMoveAlertDialog.value = true;
      if (row.type === "anomaly") {
        selectedAlertToMove.value = [];
        selectedAnomalyConfigsToMove.value = [row.alert_id];
      } else {
        selectedAlertToMove.value = [row.alert_id];
        selectedAnomalyConfigsToMove.value = [];
      }
      activeFolderToMove.value = activeFolderId.value;
    };

    const updateAcrossFolders = async (
      activeFolderId: any,
      selectedFolderId: any,
    ) => {
      //here we are fetching the alerts of the selected folder first and then fetching the alerts of the active folder
      await getAlertsFn(store, selectedFolderId, "", false);
      await getAlertsFn(store, activeFolderId);
      showMoveAlertDialog.value = false;
      selectedAlertToMove.value = [];
      selectedAnomalyConfigsToMove.value = [];
      activeFolderToMove.value = "";
      selectedAlerts.value = [];
      allSelectedAlerts.value = false;
    };

    const getSelectedString = () => {
      return selectedAlerts.value.length === 0
        ? ""
        : `${selectedAlerts.value.length} record${
            selectedAlerts.value.length > 1 ? "s" : ""
          } selected`;
    };

    const moveMultipleAlerts = () => {
      showMoveAlertDialog.value = true;
      selectedAlertToMove.value = selectedAlerts.value
        .filter((alert: any) => alert.type !== "anomaly")
        .map((alert: any) => alert.alert_id);
      selectedAnomalyConfigsToMove.value = selectedAlerts.value
        .filter((alert: any) => alert.type === "anomaly")
        .map((alert: any) => alert.alert_id);
      activeFolderToMove.value = activeFolderId.value;
    };

    const dynamicQueryModel = computed({
      get() {
        return searchAcrossFolders.value
          ? searchQuery.value
          : filterQuery.value;
      },
      set(value) {
        if (searchAcrossFolders.value) {
          searchQuery.value = value;
          // filterQuery.value = value;
        } else {
          filterQuery.value = value;
          // searchQuery.value = value;
        }
      },
    });

    const clearSearchHistory = () => {
      searchQuery.value = "";
      filteredResults.value = [];
    };

    const debouncedSearch = debounce(async (query) => {
      if (!query) return;
      const dismiss = $q.notify({
        spinner: true,
        message: "Please wait while searching for dashboards...",
      });
      dismiss();
      await getAlertsFn(store, activeFolderId.value, query);
    }, 600);

    watch(filterQuery, (newVal) => {
      if (newVal == "") {
        filterAlertsByTab();
      }
      if (newVal) {
        filterAlertsByQuery(newVal);
      }
    });
    watch(searchAcrossFolders, (newVal) => {
      selectedAlerts.value = [];
      allSelectedAlerts.value = false;
      if (newVal) {
        //here we are setting the searchQuery to null and then setting the filterQuery to the searchQuery
        //this is done because we want to clear the searchQuery and then set the filterQuery to the searchQuery
        searchQuery.value = null;
        searchQuery.value = filterQuery.value;
        filterQuery.value = null;
      }
      if (!newVal) {
        //here we are restoring the current folder's alerts and re-filtering by the active tab
        //this ensures cross-folder results are cleared and only the current folder's data is shown
        const currentFolderAlerts =
          store.state.organizationData.allAlertsListByFolderId[
            activeFolderId.value
          ] || [];
        allAlerts.value = currentFolderAlerts;
        filterQuery.value = null;
        searchQuery.value = null;
        filterAlertsByTab();
      }
    });
    // Persist filter state to Vuex so it survives navigation to add/edit screens
    watch([searchQuery, filterQuery, searchAcrossFolders, selectedPerPage], () => {
      store.commit("setAlertListFilters", {
        searchQuery: searchQuery.value || "",
        filterQuery: filterQuery.value || "",
        searchAcrossFolders: !!searchAcrossFolders.value,
        perPage: selectedPerPage.value,
      });
    });
    watch(activeTab, async (newVal) => {
      //here we are resetting the filterQuery when the activeTab is changed
      //this is done because we need to trigger again the filterQuery watch
      if (filterQuery.value) {
        let tempQuery = filterQuery.value;
        filterQuery.value = null;
        await nextTick();
        filterQuery.value = tempQuery;
      }
      //here we are filtering the alerts by the activeTab
      filterAlertsByTab();

      // Update URL query parameter to persist tab state across page refreshes
      router.push({
        query: { ...router.currentRoute.value.query, tab: newVal },
      });
    });

    const copyToClipboard = (text: string, type: string) => {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          $q.notify({
            type: "positive",
            message: `${type} Copied Successfully!`,
            timeout: 5000,
          });
        })
        .catch(() => {
          $q.notify({
            type: "negative",
            message: "Error while copy content.",
            timeout: 5000,
          });
        });
    };

    const openMenu = (event: Event, row: any) => {
      event.stopPropagation();
    };

    const multipleExportAlert = async () => {
      try {
        const dismiss = $q.notify({
          spinner: true,
          message: "Exporting alerts...",
          timeout: 0, // Set timeout to 0 to keep it showing until dismissed
        });

        const alertToBeExported = [];
        const selectedAlertsToExport = selectedAlerts.value.map(
          (alert: any) => alert.alert_id,
        );

        const alertsData = await Promise.all(
          selectedAlertsToExport.map(async (alertId: string) => {
            const res = await alertsService.export_by_id(
              store.state.selectedOrganization.identifier,
              alertId,
            );
            const data = res.data;
            if (data.hasOwnProperty("id")) delete data.id;
            return data;
          }),
        );
        alertToBeExported.push(...alertsData);

        // Create and download the JSON file
        const jsonData = JSON.stringify(alertToBeExported, null, 2);
        const blob = new Blob([jsonData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `alerts-${new Date().toISOString().split("T")[0]}-${activeFolderId.value}.json`;
        a.click();

        URL.revokeObjectURL(url);

        dismiss();
        $q.notify({
          type: "positive",
          message: `Successfully exported ${selectedAlertsToExport.length} alert${selectedAlertsToExport.length > 1 ? "s" : ""}`,
          timeout: 2000,
        });
        selectedAlerts.value = [];
        allSelectedAlerts.value = false;
      } catch (error) {
        console.error("Error exporting alerts:", error);
        $q.notify({
          type: "negative",
          message: "Error exporting alerts. Please try again.",
          timeout: 2000,
        });
      }
    };
    const computedName = (name: string) => {
      if (!name) {
        return "--";
      }
      return name.length > 30 ? name.substring(0, 30) + "..." : name;
    };
    const computedOwner = (owner: string) => {
      if (!owner) {
        return "--";
      }
      if (owner.length > 15) {
        const firstTen = owner.substring(0, 7);
        const lastFour = owner.substring(owner.length - 4);
        return firstTen + "****" + lastFour;
      }
      return owner;
    };

    //this function is used to refresh the imported alerts
    const refreshImportedAlerts = async (store: any, folderId: any) => {
      await getAlertsFn(store, folderId);
    };
    const updateFolderIdToBeCloned = (folderId: any) => {
      folderIdToBeCloned.value = folderId.value;
    };

    // V1 format: {or: [...]} or {and: [...]}
    function transformToExpression(data: any, wrap = true): any {
      if (!data) return null;

      const keys = Object.keys(data);
      if (keys.length !== 1) return null;

      const label = keys[0].toUpperCase(); // AND or OR
      const itemsArray = data[label.toLowerCase()];

      const parts = itemsArray.map((item: any) => {
        if (item.and || item.or) {
          return transformToExpression(item, true); // wrap nested groups
        } else {
          const column = item.column;
          const operator = item.operator;
          const value =
            typeof item.value === "string" ? `'${item.value}'` : item.value;
          return `${column} ${operator} ${value}`;
        }
      });

      const joined = parts.join(` ${label} `);
      return wrap ? `(${joined})` : joined;
    }

    // V2 format: {filterType: "group", logicalOperator: "AND", conditions: [...]}
    // Uses shared buildConditionsString utility for consistency
    function transformV2ToExpression(group: any, isRoot = true): string {
      const result = buildConditionsString(group, {
        sqlMode: false, // Display format (lowercase operators)
        addWherePrefix: false,
        formatValues: false, // Simple display without type-aware formatting
      });

      // Wrap in parentheses if it's the root level and has content
      return isRoot && result ? `(${result})` : result;
    }
    //this function is used to filter the alerts by the local search not the global search
    //this will be used when the user is searching for the alerts in the same folder
    const filterAlertsByQuery = (query: string) => {
      let tempResults = allAlerts.value.filter((alert: any) =>
        alert.name.toLowerCase().includes(query.toLowerCase()),
      );
      filteredResults.value = tempResults.filter((alert: any) => {
        if (activeTab.value === "scheduled") {
          return !alert.is_real_time;
        } else if (activeTab.value === "realTime") {
          return alert.is_real_time === true;
        } else if (activeTab.value === "anomalyDetection") {
          return alert.is_real_time === "anomaly";
        } else {
          return true;
        }
      });
    };

    const bulkToggleAlerts = async (action: "pause" | "resume") => {
      const dismiss = $q.notify({
        spinner: true,
        message: `${action === "resume" ? "Resuming" : "Pausing"} alerts...`,
        timeout: 0,
      });
      try {
        const isResuming = action === "resume";

        // Filter alerts based on action
        const alertsToToggle = selectedAlerts.value.filter((alert: any) =>
          isResuming ? !alert.enabled : alert.enabled,
        );

        if (alertsToToggle.length === 0) {
          $q.notify({
            type: "negative",
            message: `No alerts to ${action}`,
            timeout: 2000,
          });
          dismiss();
          return;
        }

        // Collect IDs and names
        const payload = {
          ids: alertsToToggle.map((a: any) => a.alert_id),
          names: alertsToToggle.map((a: any) => a.name),
        };

        // Toggle (true = resume, false = pause)
        const response = await alertsService.bulkToggleState(
          store.state.selectedOrganization.identifier,
          isResuming,
          payload,
        );

        if (response) {
          dismiss();
          $q.notify({
            type: "positive",
            message: `Alerts ${action}d successfully`,
            timeout: 2000,
          });
        }
        // Refresh alerts
        await getAlertsFn(store, activeFolderId.value);

        if (filterQuery.value) {
          filterAlertsByQuery(filterQuery.value);
        }
      } catch (error) {
        dismiss();
        console.error(`Error ${action}ing alerts:`, error);
        $q.notify({
          type: "negative",
          message: `Error ${action}ing alerts. Please try again.`,
          timeout: 2000,
        });
      }
    };

    const confirmBulkDelete = ref<boolean>(false);

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteAlerts = async () => {
      const dismiss = $q.notify({
        spinner: true,
        message: "Deleting alerts...",
        timeout: 0,
      });

      try {
        if (selectedAlerts.value.length === 0) {
          $q.notify({
            type: "negative",
            message: "No alerts selected for deletion",
            timeout: 2000,
          });
          dismiss();
          return;
        }

        // Extract alert ids
        const payload = {
          ids: selectedAlerts.value.map((a: any) => a.alert_id),
        };

        const response = await alertsService.bulkDelete(
          store.state.selectedOrganization.identifier,
          payload,
          activeFolderId.value,
        );

        dismiss();

        // Handle response based on successful/unsuccessful arrays
        if (response.data) {
          const { successful = [], unsuccessful = [] } = response.data;
          const successCount = successful.length;
          const failCount = unsuccessful.length;

          if (failCount > 0 && successCount > 0) {
            // Partial success
            $q.notify({
              type: "warning",
              message: `${successCount} alert(s) deleted successfully, ${failCount} failed`,
              timeout: 5000,
            });
          } else if (failCount > 0) {
            // All failed
            $q.notify({
              type: "negative",
              message: `Failed to delete ${failCount} alert(s)`,
              timeout: 3000,
            });
          } else {
            // All successful
            $q.notify({
              type: "positive",
              message: `${successCount} alert(s) deleted successfully`,
              timeout: 2000,
            });
          }
        } else {
          // Fallback success message
          $q.notify({
            type: "positive",
            message: `${selectedAlerts.value.length} alert(s) deleted successfully`,
            timeout: 2000,
          });
        }

        selectedAlerts.value = [];
        // Refresh alerts
        await getAlertsFn(store, activeFolderId.value);

        if (filterQuery.value) {
          filterAlertsByQuery(filterQuery.value);
        }
      } catch (error: any) {
        dismiss();

        // Show error message from response if available
        const errorMessage =
          error.response?.data?.message ||
          error?.message ||
          "Error deleting alerts. Please try again.";
        if (error.response?.status != 403 || error?.status != 403) {
          $q.notify({
            type: "negative",
            message: errorMessage,
            timeout: 3000,
          });
        }
      }

      confirmBulkDelete.value = false;
    };

    return {
      t,
      qTable,
      store,
      router,
      columns,
      formData,
      hideForm,
      confirmDelete,
      selectedDelete,
      updateStreams,
      updateStreamName,
      pagination,
      resultTotal,
      refreshList,
      perPageOptions,
      selectedPerPage,
      addAlert,
      isUpdated,
      showAddUpdateFn,
      showDeleteDialogFn,
      duplicateAlert,
      changePagination,
      maxRecordToReturn,
      showAddAlertDialog,
      showForm,
      toBeCloneAlertName,
      toBeClonedIsAnomaly,
      toBeClonestreamType,
      toBeClonestreamName,
      streamTypes,
      filterColumns,
      filterStreams,
      streamNames,
      submitForm,
      schemaList,
      indexOptions,
      streams,
      isFetchingStreams,
      isSubmitting,
      changeMaxRecordToReturn,
      filterQuery,
      filterData(rows: any, terms: any) {
        var filtered = [];
        terms = terms.toLowerCase();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
      getImageURL,
      activeTab,
      destinations,
      verifyOrganizationStatus,
      folders,
      splitterModel,
      filterQuery,
      alertStateLoadingMap,
      templates,
      routeTo,
      refreshDestination,
      showImportAlertDialog,
      importAlert,
      goToAlertInsights,
      goToAlertHistory,
      getTemplates,
      exportAlert,
      triggerAlert,
      retrainAnomaly,
      updateActiveFolderId,
      activeFolderId,
      editAlert,
      editAlertFromDrawer,
      deleteAlertByAlertId,
      showMoveAlertDialog,
      selectedAlertToMove,
      selectedAnomalyConfigsToMove,
      moveAlertToAnotherFolder,
      activeFolderToMove,
      updateAcrossFolders,
      selectedAlerts,
      getSelectedString,
      moveMultipleAlerts,
      dynamicQueryModel,
      searchAcrossFolders,
      searchQuery,
      clearSearchHistory,
      filteredResults,
      triggerExpand,
      showAlertDetailsDrawer,
      selectedAlertDetails,
      allSelectedAlerts,
      copyToClipboard,
      openMenu,
      getAlertsFn,
      multipleExportAlert,
      computedName,
      computedOwner,
      tabs,
      alertTabs,
      filterAlertsByTab,
      showHistoryDrawer,
      selectedHistoryAlertId,
      selectedHistoryAlertName,
      refreshImportedAlerts,
      folderIdToBeCloned,
      updateFolderIdToBeCloned,
      transformToExpression,
      filterAlertsByQuery,
      bulkToggleAlerts,
      openBulkDeleteDialog,
      bulkDeleteAlerts,
      confirmBulkDelete,
      symOutlinedSoundSampler,
      config,
      isCompactToolbar,
      isAnomalyDetectionEnabled,
    };
  },
});
</script>

<style lang="scss">
.view-mode-tabs-container {
  margin-right: 24px;

  // Customize app-tabs for view mode switching
  ::v-deep .app-tabs {
    .o-tabs {
      min-height: 36px;
    }

    .o-tab {
      padding: 0 20px;
      min-height: 36px;
      text-transform: none;
      font-weight: 600;

      &__icon {
        font-size: 18px;
        margin-right: 8px;
      }
    }
  }
}

.bottom-btn {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
}

.move-btn {
  width: calc(14vw);
}

.export-btn {
  width: calc(14vw);
}

.clone-alert-popup {
  width: 400px;
}
.expand-content {
  padding: 0 3rem;
  max-height: 100vh; /* Set a fixed height for the container */
  overflow: hidden; /* Hide overflow by default */
}

.scroll-content {
  width: 100%; /* Use the full width of the parent */
  overflow-y: auto; /* Enable vertical scrolling for long content */
  padding: 10px; /* Optional: padding for aesthetics */
  border: 1px solid #ddd; /* Optional: border for visibility */
  height: 100%;
  max-height: 200px;
  /* Use the full height of the parent */
  text-wrap: normal;
  background-color: #e8e8e8;
  color: black;
}
.expanded-sql {
  border-left: #7a54a2 3px solid;
}
.alert-name-tooltip {
  max-width: 400px;
  white-space: normal;
  word-wrap: break-word;
  font-size: 12px;
}

@media (max-width: 1440px) {
  .app-tabs-container .o2-tab {
    padding-left: 0.75rem !important;
    padding-right: 0.75rem !important;
    min-width: auto !important;
  }
}
</style>

<style lang="scss" scoped>
.dark-theme {
  background-color: $dark-page;

  .alerts-list-tabs {
    height: fit-content;

    :deep(.rum-tabs) {
      border: 1px solid #464646;
    }

    :deep(.rum-tab) {
      &:hover {
        background: #464646;
      }

      &.active {
        background: #5960b2;
        color: #ffffff !important;
      }
    }
  }
}

.alerts-list-tabs {
  height: fit-content;

  :deep(.rum-tabs) {
    border: 1px solid #eaeaea;
    height: fit-content;
    border-radius: 4px;
    overflow: hidden;
  }

  :deep(.rum-tab) {
    width: fit-content !important;
    padding: 4px 12px !important;
    border: none !important;

    &:hover {
      background: #eaeaea;
    }

    &.active {
      background: #5960b2;
      color: #ffffff !important;
    }
  }
}
.compact-icon-btn {
  padding: 0 0.5rem !important;
  min-width: 0 !important;
}

.alert-search-input {
  :deep(.q-field__control) {
    padding: 0 2px !important;
  }

  :deep(.q-field__prepend) {
    padding-left: 2px !important;
    padding-right: 0 !important;
  }

  :deep(.q-field__append) {
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
}

.all-folders-toggle {
  :deep(.q-toggle__inner) {
    height: 1.1em !important;
  }
  :deep(.q-toggle__label) {
    margin-top: 2px !important;
  }
}
</style>
