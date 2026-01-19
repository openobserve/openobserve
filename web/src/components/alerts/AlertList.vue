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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div
    data-test="alert-list-page"
    class="q-pa-none flex flex-col"
  >
    <div class="tw:w-full  tw:px-[0.625rem] q-pt-xs" v-if="!showAddAlertDialog && !showImportAlertDialog">
      <div class="card-container">
        <div
          class="flex justify-between full-width tw:py-3 tw:mb-[0.625rem] tw:px-4 tw:h-[68px] items-center"
        >
          <div class="tw:flex tw:items-center tw:gap-4">
            <div class="q-table__title tw:font-[600]" data-test="alert-list-title">
              {{ t("alerts.header") }}
            </div>
          </div>
          <div class="flex q-ml-auto tw:ps-2 items-center">
            <!-- Alert Tabs -->
            <div class="app-tabs-container tw:h-[36px] q-mr-sm">
              <app-tabs
              class="tabs-selection-container"
              :tabs="alertTabs"
              v-model:active-tab="activeTab"
              @update:active-tab="filterAlertsByTab"
            />
            </div>
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
              class="o2-search-input"
            >
              <template #prepend>
                <q-icon class="o2-search-input-icon" name="search" />
              </template>
            </q-input>
            <!-- All Folders toggle -->
            <div class="tw:ml-2">
                <q-toggle
                  data-test="alert-list-search-across-folders-toggle"
                  v-model="searchAcrossFolders"
                  label="All Folders"
                  class="tw:mr-3 tw:h-[32px] o2-toggle-button-lg all-folders-toggle"
                  size="lg"
                >
              </q-toggle>
              <q-tooltip class="q-mt-lg" anchor="top middle" self="bottom middle">
                {{
                  searchAcrossFolders
                    ? t("dashboard.searchSelf")
                    : t("dashboard.searchAll")
                }}
              </q-tooltip>
            </div>
          </div>
          <q-btn
            v-if="false"
            class="q-ml-sm o2-secondary-button tw:h-[36px]"
            no-caps
            flat
            label="Alert Insights"
            @click="goToAlertInsights"
            data-test="alert-insights-btn"
            icon="insights"
          />
          <!-- Import button -->
          <q-btn
            class="q-ml-sm o2-secondary-button tw:h-[36px]"
            no-caps
            flat
            :label="t(`dashboard.import`)"
            @click="importAlert"
            data-test="alert-import"
          />
          <!-- Add Alert button -->
          <q-btn
            data-test="alert-list-add-alert-btn"
            class="q-ml-sm o2-primary-button tw:h-[36px]"
            no-caps
            flat
            :disable="!destinations.length"
            :title="!destinations.length ? t('alerts.noDestinations') : ''"
            :label="t(`alerts.add`)"
            @click="showAddUpdateFn({})"
          />
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
              <!-- Alert List Table -->
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
                style="width: 100%;"
                :style="filteredResults?.length
                ? 'width: 100%; height: calc(100vh - 124px)'
                : 'width: 100%'"

                class="o2-quasar-table o2-row-md o2-quasar-table-header-sticky"
              >
              <template v-slot:header="props">
                <q-tr :props="props">
                  <!-- Adding this block to render the select-all checkbox -->
                  <q-th auto-width>
                    <q-checkbox
                      v-model="props.selected"
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
                    {{ col.label }}
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

                    <q-td v-for="col in columns" :key="col.name" :props="props">
                      <template v-if="col.name === 'name'">
                        <div class="tw:flex tw:items-center tw:gap-1">
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
                          col.name == 'last_satisfied_at'
                        "
                      >
                        {{ props.row[col.field] }}
                      </template>
                      <template v-else-if="col.name === 'period'">
                        {{ props.row[col.field] ?  props.row[col.field] + " Mins" : "--" }}
                      </template>
                      <template v-else-if="col.name === 'frequency'">
                        {{ props.row[col.field] ? props.row[col.field] + (props.row?.frequency_type == "cron" ? "" : " Mins") : "--" }}
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
                      <template v-else-if="col.name === 'dedup_status'">
                        <div class="tw:flex tw:items-center tw:justify-center">
                          <q-icon
                            v-if="props.row.deduplication?.enabled"
                            name="check_circle"
                            size="sm"
                            color="positive"
                          >
                            <q-tooltip class="bg-grey-8">
                              Deduplication: Enabled
                              <div v-if="props.row.deduplication.fingerprint_fields?.length">
                                Fields: {{ props.row.deduplication.fingerprint_fields.join(', ') }}
                              </div>
                              <div v-if="props.row.deduplication.grouping?.enabled">
                                Grouping: {{ props.row.deduplication.grouping.group_wait_seconds }}s wait
                              </div>
                            </q-tooltip>
                          </q-icon>
                          <span v-else class="text-grey-5">-</span>
                        </div>
                      </template>
                      <template v-else-if="col.name == 'actions'">
                        <div class="tw:flex tw:items-center actions-container"
                        >
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
                          <q-btn
                            v-else
                            :data-test="`alert-list-${props.row.name}-pause-start-alert`"
                            class="q-ml-xs material-symbols-outlined"
                            padding="sm"
                            unelevated
                            size="sm"
                            :color="props.row.enabled ? 'negative' : 'positive'"
                            :icon="props.row.enabled ? outlinedPause : outlinedPlayArrow"
                            round
                            flat
                            :title="
                              props.row.enabled
                                ? t('alerts.pause')
                                : t('alerts.start')
                            "
                            @click.stop="toggleAlertState(props.row)"
                          >
                        </q-btn>
                          <q-btn
                            :data-test="`alert-list-${props.row.name}-update-alert`"
                            unelevated
                            size="sm"
                            round
                            flat
                            :title="t('alerts.edit')"
                            @click.stop="editAlert(props.row)"
                            icon="edit"
                          >
                        </q-btn>
                          <q-btn
                            icon="content_copy"
                            :title="t('alerts.clone')"
                            unelevated
                            size="sm"
                            round
                            flat
                            @click.stop="duplicateAlert(props.row)"
                            :data-test="`alert-list-${props.row.name}-clone-alert`"
                          >
                        </q-btn>
                          <q-btn
                            :icon="outlinedMoreVert"
                            unelevated
                            size="sm"
                            round
                            flat
                            @click.stop="openMenu($event, props.row)"
                            :data-test="`alert-list-${props.row.name}-more-options`"
                          >
                            <q-menu>
                              <q-list style="min-width: 100px">
                                <q-item
                                  class="flex items-center"
                                  clickable
                                  v-close-popup
                                  @click="moveAlertToAnotherFolder(props.row)"
                                >
                                  <q-item-section dense avatar>
                                     <q-icon
                                        size="16px"
                                        :name="outlinedDriveFileMove"
                                      />
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
                                     <q-icon size="16px" :name="outlinedDelete" />
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
                                <q-item
                                  class="flex items-center justify-center"
                                  clickable
                                  v-close-popup
                                  @click="triggerAlert(props.row)"
                                >
                                  <q-item-section dense avatar>
                                     <q-icon size="16px" :name="symOutlinedSoundSampler" />
                                  </q-item-section>
                                  <q-item-section>{{
                                    t("alerts.triggerAlert")
                                  }}</q-item-section>
                                </q-item>
                              </q-list>
                            </q-menu>
                          </q-btn>
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
                          It looks like you haven't created any Templates yet. To
                          create an Alert, you'll need to have at least one
                          Destination and one Template in place
                        </div>
                        <q-btn
                          data-test="alert-list-create-template-btn"
                          class="q-mt-md"
                          label="Create Template"
                          size="md"
                          color="primary"
                          no-caps
                          style="border-radius: 4px"
                          @click="routeTo('alertTemplates')"
                        />
                      </template>
                      <template v-if="!destinations.length && templates.length">
                        <div
                          class="text-subtitle1"
                          data-test="alert-list-create-destination-text"
                        >
                          It looks like you haven't created any Destinations yet. To
                          create an Alert, you'll need to have at least one
                          Destination and one Template in place
                        </div>
                        <q-btn
                          data-test="alert-list-create-destination-btn"
                          class="q-mt-md"
                          label="Create Destination"
                          size="md"
                          color="primary"
                          no-caps
                          style="border-radius: 4px"
                          @click="routeTo('alertDestinations')"
                        />
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
                    <pre style="white-space: break-spaces">{{ props.row.sql }}</pre>
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
                   <div class="o2-table-footer-title tw:flex tw:items-center tw:w-[200px] tw:mr-md">
                      {{ resultTotal }} {{ t('alerts.header') }}
                    </div>

                    <q-btn
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-move-across-folders-btn"
                      class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
                      :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                      no-caps
                      dense
                      @click="moveMultipleAlerts"
                      >
                        <q-icon :name="outlinedDriveFileMove" size="16px" />
                        <span class="tw:ml-2">Move</span>
                    </q-btn>
                    <q-btn
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-export-alerts-btn"
                      class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
                      :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                      no-caps
                      dense
                      @click="multipleExportAlert"
                    >
                      <q-icon name="download" size="16px" />
                      <span class="tw:ml-2">Export</span>
                  </q-btn>
                  <q-btn
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-pause-alerts-btn"
                      class="flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px]"
                      :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                      no-caps
                      dense
                      @click="bulkToggleAlerts('pause')"
                    >
                      <q-icon name="pause" size="16px" />
                      <span class="tw:ml-2">Pause</span>
                  </q-btn>
                  <q-btn
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-unpause-alerts-btn"
                      class="tw:flex items-center no-border o2-secondary-button tw:h-[36px] q-mr-sm tw:w-[180px]"
                      :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                      no-caps
                      dense
                      @click="bulkToggleAlerts('resume')"
                    >
                      <q-icon name="play_arrow" size="16px" />
                      <span class="tw:ml-2">Resume</span>
                  </q-btn>
                  <q-btn
                      v-if="selectedAlerts.length > 0"
                      data-test="alert-list-delete-alerts-btn"
                      class="tw:flex items-center q-mr-sm no-border o2-secondary-button tw:h-[36px] tw:ml-sm"
                      :class="store.state.theme === 'dark' ? 'o2-secondary-button-dark' : 'o2-secondary-button-light'"
                      no-caps
                      dense
                      @click="openBulkDeleteDialog"
                    >
                      <q-icon name="delete" size="16px" />
                      <span class="tw:ml-2">Delete</span>
                  </q-btn>
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
        :alerts="store?.state?.organizationData?.allAlertsListByFolderId[activeFolderId]"
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

    <!-- Alert Details Drawer -->
    <q-drawer
      v-model="showAlertDetailsDrawer"
      side="right"
      :width="600"
      bordered
      overlay
      behavior="mobile"
      class="alert-details-drawer"
    >
      <div class="tw:h-full tw:flex tw:flex-col">
        <!-- Drawer Header -->
        <div class="tw:px-6 tw:py-4 tw:border-b tw:flex tw:items-center tw:justify-between">
          <div class="tw:flex tw:items-center">
            <q-icon name="info" size="24px" class="tw:mr-2" />
            <h6 class="tw:text-lg tw:font-semibold tw:m-0">{{ t('alert_list.alert_details') }}</h6>
          </div>
          <q-btn
            flat
            round
            dense
            icon="close"
            @click="showAlertDetailsDrawer = false"
          />
        </div>

        <!-- Drawer Content -->
        <div class="tw:flex-1 tw:overflow-y-auto tw:px-6 tw:py-4" v-if="selectedAlertDetails">
          <!-- Alert Name -->
          <div class="tw:mb-6">
            <div class="tw:text-sm tw:font-semibold tw:mb-1" :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'">Alert Name</div>
            <div class="tw:text-base">{{ selectedAlertDetails.name }}</div>
          </div>

          <!-- SQL Query / Conditions -->
          <div class="tw:mb-6">
            <div class="tw:flex tw:items-center tw:justify-between tw:mb-2">
              <div class="tw:text-sm tw:font-semibold" :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'">
                {{ selectedAlertDetails.type == "sql" ? "SQL Query" : "Conditions" }}
              </div>
              <q-btn
                v-if="selectedAlertDetails.conditions != '' && selectedAlertDetails.conditions != '--'"
                @click="copyToClipboard(selectedAlertDetails.conditions, 'Conditions')"
                size="sm"
                flat
                dense
                icon="content_copy"
                class="tw:ml-2"
              >
                <q-tooltip>Copy</q-tooltip>
              </q-btn>
            </div>
            <pre :class="store.state.theme === 'dark' ? 'tw:bg-gray-800 tw:text-gray-200' : 'tw:bg-gray-100 tw:text-gray-900'" class="tw:p-3 tw:rounded tw:text-sm tw:overflow-x-auto" style="white-space: pre-wrap">{{
              selectedAlertDetails.conditions != "" && selectedAlertDetails.conditions != "--"
                ? (selectedAlertDetails.type == 'sql' ? selectedAlertDetails.conditions : selectedAlertDetails.conditions.length != 2 ? `if ${selectedAlertDetails.conditions}` : 'No condition')
                : "No condition"
            }}</pre>
          </div>

          <!-- Description -->
          <div class="tw:mb-6">
            <div class="tw:text-sm tw:font-semibold tw:mb-2" :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'">Description</div>
            <pre :class="store.state.theme === 'dark' ? 'tw:bg-gray-800 tw:text-gray-200' : 'tw:bg-gray-100 tw:text-gray-900'" class="tw:p-3 tw:rounded tw:text-sm" style="white-space: pre-wrap">{{ selectedAlertDetails.description || "No description" }}</pre>
          </div>

          <!-- Alert History Table -->
          <div class="tw:mb-6">
            <div class="tw:text-sm tw:font-semibold tw:mb-3" :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'">Evaluation History</div>

            <div v-if="isLoadingHistory" class="tw:text-center tw:py-8">
              <q-spinner size="32px" color="primary" />
              <div class="tw:text-sm tw:mt-3" :class="store.state.theme === 'dark' ? 'tw:text-gray-400' : 'tw:text-gray-600'">Loading history...</div>
            </div>

            <div v-else-if="expandedAlertHistory.length === 0" class="tw:text-center tw:py-8" :class="store.state.theme === 'dark' ? 'tw:text-gray-500' : 'tw:text-gray-500'">
              <q-icon name="history" size="48px" class="tw:mb-2 tw:opacity-30" />
              <div class="tw:text-sm">No evaluation history available for this alert</div>
            </div>

            <q-table
              v-else
              :rows="expandedAlertHistory"
              :columns="historyTableColumns"
              row-key="timestamp"
              flat
              dense
              :pagination="{ rowsPerPage: 10 }"
              class="tw:shadow-sm"
            >
              <template v-slot:body-cell-status="props">
                <q-td :props="props">
                  <q-badge
                    :color="props.row.status?.toLowerCase() === 'firing' || props.row.status?.toLowerCase() === 'error' ? 'negative' : 'positive'"
                    :label="props.row.status || 'Unknown'"
                  />
                </q-td>
              </template>
            </q-table>
          </div>
        </div>
      </div>
    </q-drawer>

    <template>
      <q-dialog class="q-pa-md" v-model="showForm" persistent>
        <q-card class="clone-alert-popup">
          <div class="row items-center no-wrap q-mx-md q-my-sm">
            <div class="flex items-center">
              <div
                data-test="add-alert-back-btn"
                class="flex justify-center items-center q-mr-md cursor-pointer"
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
              <div class="text-h6" data-test="clone-alert-title">
                {{ t("alerts.cloneTitle") }}
              </div>
            </div>
          </div>
          <q-card-section>
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
              <div class="flex justify-center q-mt-sm">
                <q-btn
                  data-test="clone-alert-cancel-btn"
                  v-close-popup="true"
                  class="o2-secondary-button tw:h-[36px]"
                  :label="t('alerts.cancel')"
                  text-color="light-text"
                  no-caps
                />
                <q-btn
                  data-test="clone-alert-submit-btn"
                  :label="t('alerts.save')"
                  class="o2-primary-button tw:h-[36px] q-ml-md"
                  type="submit"
                  :disable="isSubmitting"
                  no-caps
                />
              </div>
            </q-form>
          </q-card-section>
        </q-card>
      </q-dialog>
      <q-dialog
        v-model="showMoveAlertDialog"
        position="right"
        full-height
        maximized
        data-test="dashboard-move-to-another-folder-dialog"
      >
        <MoveAcrossFolders
          :activeFolderId="activeFolderToMove"
          :moduleId="selectedAlertToMove"
          type="alerts"
          @updated="updateAcrossFolders"
        />
      </q-dialog>

      <!-- Alert History Drawer -->
      <AlertHistoryDrawer
        v-model="showHistoryDrawer"
        :alert-id="selectedHistoryAlertId"
        :alert-name="selectedHistoryAlertName"
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
import {
  outlinedDelete,
  outlinedPause,
  outlinedPlayArrow,
  outlinedDriveFileMove,
  outlinedMoreVert,
} from "@quasar/extras/material-icons-outlined";
import FolderList from "../common/sidebar/FolderList.vue";

import MoveAcrossFolders from "../common/sidebar/MoveAcrossFolders.vue";
import { toRaw } from "vue";
import { nextTick } from "vue";
import AppTabs from "@/components/common/AppTabs.vue";
import SelectFolderDropDown from "../common/sidebar/SelectFolderDropDown.vue";
import AlertHistoryDrawer from "@/components/alerts/AlertHistoryDrawer.vue";
import { symOutlinedSoundSampler } from "@quasar/extras/material-symbols-outlined";
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
    AppTabs,
    SelectFolderDropDown,
    AlertHistoryDrawer,
    O2AIContextAddBtn,
  },
  emits: [
    "updated:fields",
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

    const showImportAlertDialog = ref(false);
    const showHistoryDrawer = ref(false);
    const selectedHistoryAlertId = ref("");
    const selectedHistoryAlertName = ref("");

    const { getStreams } = useStreams();

    const toBeCloneAlertName = ref("");
    const toBeClonedID = ref("");
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
    const activeFolderId = ref<any>(router.currentRoute.value.query.folder ?? "default");
    const showMoveAlertDialog = ref(false);
    const showAlertDetailsDrawer = ref(false);
    const selectedAlertDetails: Ref<any> = ref(null);
    const expandedAlertHistory: Ref<any[]> = ref([]);
    const isLoadingHistory = ref(false);

    const historyTableColumns = [
      {
        name: 'timestamp',
        label: 'Timestamp',
        field: 'timestamp',
        align: 'left',
        sortable: true,
        format: (val: any) => convertUnixToQuasarFormat(val)
      },
      {
        name: 'status',
        label: 'Status',
        field: 'status',
        align: 'center',
        sortable: true
      },
      {
        name: 'evaluation_time',
        label: 'Evaluation (s)',
        field: 'evaluation_took_in_secs',
        align: 'center',
        sortable: true,
        format: (val: any) => val ? val.toFixed(3) : '-'
      },
      {
        name: 'query_time',
        label: 'Query (ms)',
        field: 'query_took',
        align: 'center',
        sortable: true,
        format: (val: any) => val || '-'
      },
    ];

    const fetchAlertHistory = async (alertId: string) => {
      isLoadingHistory.value = true;
      try {
        // Get history for last 30 days
        const endTime = Date.now() * 1000; // Convert to microseconds
        const startTime = endTime - (30 * 24 * 60 * 60 * 1000000); // 30 days ago in microseconds

        const response = await alertsService.getHistory(
          store?.state?.selectedOrganization?.identifier,
          {
            alert_id: alertId,
            size: 50, // Get last 50 evaluations
            start_time: startTime,
            end_time: endTime
          }
        );
        expandedAlertHistory.value = response.data?.hits || [];
      } catch (error) {
        console.error("Failed to fetch alert history:", error);
        expandedAlertHistory.value = [];
      } finally {
        isLoadingHistory.value = false;
      }
    };

    const triggerExpand = (props: any) => {
      // Open drawer instead of inline expansion
      const alert = props.row;

      // LAZY CONVERSION: Convert conditions on-demand only when expanding
      // This improves performance by avoiding conversion of all alerts on list load
      let displayConditions = "--";
      if (alert.rawCondition && Object.keys(alert.rawCondition).length) {
        if (alert.rawCondition.type == 'custom') {
          const conditionData = alert.rawCondition.conditions;

          // Detect format by structure, not by version field (more reliable)
          if (conditionData?.filterType === 'group') {
            // V2 format: {filterType: "group", logicalOperator: "AND", conditions: [...]}
            displayConditions = transformV2ToExpression(conditionData);
          } else if (conditionData?.version === 2 && conditionData?.conditions) {
            // V2 format with version wrapper: {version: 2, conditions: {filterType: "group", ...}}
            displayConditions = transformV2ToExpression(conditionData.conditions);
          } else if (conditionData?.or || conditionData?.and) {
            // V1 format: {or: [...]} or {and: [...]}
            displayConditions = transformToExpression(conditionData);
          } else if (Array.isArray(conditionData) && conditionData.length > 0) {
            // V0 format (legacy): flat array [{column, operator, value}, ...]
            // V0 had implicit AND between all conditions (no groups)
            const parts = conditionData.map((item: any) => {
              const column = item.column || 'field';
              const operator = item.operator || '=';
              const value = typeof item.value === 'string' ? `'${item.value}'` : item.value;
              return `${column} ${operator} ${value}`;
            });
            displayConditions = parts.length > 0 ? `(${parts.join(' AND ')})` : '--';
          } else {
            // Unknown format or empty
            displayConditions = typeof conditionData === 'string' ? conditionData : '--';
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
        conditions: displayConditions
      };

      showAlertDetailsDrawer.value = true;
      // Fetch history for this alert
        fetchAlertHistory(props.row.alert_id);
    };

    // Handle ESC key and click outside to close drawer
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showAlertDetailsDrawer.value) {
        showAlertDetailsDrawer.value = false;
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (!showAlertDetailsDrawer.value) return;

      const target = event.target as HTMLElement;

      // Check if clicked element is the backdrop or outside drawer content
      if (
        target.classList.contains('q-drawer__backdrop') ||
        target.classList.contains('q-layout__shadow')
      ) {
        showAlertDetailsDrawer.value = false;
        return;
      }

      // Check if the click is outside the drawer content
      const drawerElement = document.querySelector('.alert-details-drawer .q-drawer__content');
      if (drawerElement && !drawerElement.contains(target)) {
        showAlertDetailsDrawer.value = false;
      }
    };

    onMounted(() => {
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('click', handleClickOutside, true);
    });

    onBeforeUnmount(() => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClickOutside, true);
    });

    const activeFolderToMove = ref("default");

    // Initialize activeTab from URL query parameter, default to "all"
    const activeTab = ref(
      (router.currentRoute.value.query.tab as string) || "all"
    );

    // Tabs for alerts view
    const alertTabs = reactive([
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
        // "period" column — conditional
        ...(activeTab.value !== 'realTime' ? [{
          name: "period",
          field: "period",
          label: t("alerts.period"),
          align: "center",
          sortable: true,
          style: "width: 150px",
        }] : []),
        // "frequency" column — conditional
        ...(activeTab.value !== 'realTime' ? [{
          name: "frequency",
          field: "frequency",
          label: t("alerts.frequency"),
          align: "left",
          sortable: true,
          style: "width: 150px",
        }] : []),
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
        {
          name: "total_evaluations",
          field: "total_evaluations",
          label: t("alerts.totalEvaluations"),
          align: "center",
          sortable: true,
          style: "width: 150px",
        },
        {
          name: "firing_count",
          field: "firing_count",
          label: t("alerts.firingCount"),
          align: "center",
          sortable: true,
          style: "width: 150px",
        },
        {
          name: "dedup_status",
          field: "dedup_status",
          label: "Dedup",
          align: "center",
          sortable: false,
          style: "width: 80px",
        },
        {
          name: "actions",
          field: "actions",
          label: t("alerts.actions"),
          align: "center",
          sortable: false,
          style: "width: 150px",
          classes: 'actions-column' //this is the class that we are adding to the actions column so that we can apply the styling to the actions column only
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

    const searchQuery = ref<any>("");
    const filterQuery = ref<any>("");
    const searchAcrossFolders = ref<any>(false);
    const filteredResults: Ref<any[]> = ref([]);
    const selectedAlertToMove: Ref<any> = ref({});
    const folderIdToBeCloned = ref<any>(router.currentRoute.value.query.folder ?? "default");
    const getAlertsByFolderId = async (store: any, folderId: any) => {
      try {
        //this is the condition where we are fetching the alerts from the server 
        // assigning it to the allAlertsListByFolderId in the store
        if (!store.state.organizationData.allAlertsListByFolderId[folderId]) {
          await getAlertsFn(store, folderId);
        } else {
          //this is the condition where we are assigning the alerts to the filteredResults so whenever 
          // we are not fetching the alerts again, we are just assigning the alerts to the filteredResults
         allAlerts.value = store.state.organizationData.allAlertsListByFolderId[folderId];
        }
      } catch (error) {
        throw error;
      }
    };
    const getAlertsFn = async (store: any, folderId: any, query = "", refreshResults = true) => {
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
      if (query){
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
        const res = await alertsService.listByFolderId(1,1000,"name",false,"",store?.state?.selectedOrganization?.identifier,folderId,query);
          var counter = 1;
          let localAllAlerts = [];
          //this is the alerts that we use to store
          localAllAlerts = res.data.list.map((alert: any) => {
            return {
              ...alert,
              uuid: getUUID(),
            };
          });

          // Fetch alert history data and aggregate by alert name
          try {
            // Get history for last 12 hours
            const endTime = Date.now() * 1000; // Convert to microseconds
            const startTime = endTime - (12 * 60 * 60 * 1000000); // 12 hours ago in microseconds

            const historyRes = await alertsService.getHistory(
              store?.state?.selectedOrganization?.identifier,
              {
                size: 10000,
                start_time: startTime,
                end_time: endTime
              }
            );

            // Aggregate history data by alert name
            const historyByAlert: any = {};
            if (historyRes.data && historyRes.data.hits) {
              historyRes.data.hits.forEach((entry: any) => {
                const alertName = entry.alert_name;
                if (!historyByAlert[alertName]) {
                  historyByAlert[alertName] = {
                    total: 0,
                    firing: 0,
                  };
                }
                historyByAlert[alertName].total++;
                const status = (entry.status || "").toLowerCase();
                if (status === "firing" || status === "error") {
                  historyByAlert[alertName].firing++;
                }
              });
            }

            // Merge history data with alerts
            localAllAlerts = localAllAlerts.map((alert: any) => {
              const history = historyByAlert[alert.name] || { total: 0, firing: 0 };
              return {
                ...alert,
                total_evaluations: history.total,
                firing_count: history.firing,
              };
            });
          } catch (historyError) {
            console.warn("Failed to fetch alert history:", historyError);
            // If history fetch fails, still show alerts with 0 counts
            localAllAlerts = localAllAlerts.map((alert: any) => ({
              ...alert,
              total_evaluations: 0,
              firing_count: 0,
            }));
          }
          //general alerts that we use to display (formatting the alerts into the table format)
          //localAllAlerts is the alerts that we use to store
          // PERFORMANCE OPTIMIZATION: Store raw condition data without conversion
          // Conversion happens lazily only when user expands an alert (in triggerExpand)
          localAllAlerts = localAllAlerts.map((data: any) => {
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
              period: data.is_real_time ? "" :  data?.trigger_condition?.period,
              frequency: data.is_real_time ? "" : frequency,
              frequency_type: data?.trigger_condition?.frequency_type,
              last_triggered_at: convertUnixToQuasarFormat(
                data.last_triggered_at,
              ),
              last_satisfied_at: convertUnixToQuasarFormat(
                data.last_satisfied_at,
              ),
              selected: false,
              type: data.condition.type,
              folder_name: {
                name: data.folder_name,
                id: data.folder_id,
              },
              is_real_time: data.is_real_time,
              total_evaluations: data.total_evaluations || 0,
              firing_count: data.firing_count || 0,
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
          if(folderId != activeFolderId.value && !query){
            dismiss();
            return;
          }
          //here we are actually assigning the localAllAlerts to the allAlerts to avoid the side effects of allAlerts are overriding the actual alerts if users are rapidly moving from one folder to another folder
          allAlerts.value = localAllAlerts;
          //this is the condition where we are setting the filteredResults 
          //1. If it is search across folders then also we are setting the filteredResults(which contains the filtered alerts)
          //2. If it is not search across folders then we are setting the filteredResults to the alerts(which contains all the alerts)
            //here we are setting the filteredResults to the alerts
            if(refreshResults){
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
      //here we are filtering the alerts by the activeTab
      //why allAlerts.value is used because we are not fetching the alerts again,
      // we are just assigning the alerts to the filteredResults
      if (activeTab.value === "scheduled") {
        filteredResults.value = allAlerts.value.filter(
          (alert: any) => !alert.is_real_time,
        );
      }
      //we filter the alerts by the realTime tab
      else if (activeTab.value === "realTime") {
        filteredResults.value = allAlerts.value.filter(
          (alert: any) => alert.is_real_time,
        );
      }
      //else we will return all the alerts
      else {
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
          const matchingFolder = folders.find((it: any) => it.folderId === folderQuery);


          activeFolderId.value = matchingFolder ? folderQuery : "default";
          filterAlertsByTab();
        },
        { immediate: true }
      );
    watch(
      () => activeFolderId.value,
      async (newVal) => {
        folderIdToBeCloned.value = newVal;
        selectedAlerts.value = [];
        allSelectedAlerts.value = false;

        if(newVal == router.currentRoute.value.query.folder){
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
      if(newQuery == "" && searchAcrossFolders.value){
        //here we are fetching the alerts by the folderId and then filtering the alerts by the activeTab
        //this is done because for empty searchQuery we need to fetch the alerts by the folderId
        await getAlertsByFolderId(store, activeFolderId.value);
       filterAlertsByTab();
      }
      else{
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
    const selectedPerPage = ref<number>(20);
    const pagination: any = ref({
      rowsPerPage: 20,
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
      return date.formatDate(formattedDate, "YYYY-MM-DDTHH:mm:ssZ");
    }

    const addAlert = () => {
      showAddAlertDialog.value = true;
    };

    const duplicateAlert = async (row: any) => {
      toBeClonedID.value = row.alert_id;
      toBeCloneAlertName.value = row.name;
      toBeClonestreamName.value = "";
      toBeClonestreamType.value = "";
      showForm.value = true;
      toBeClonedAlert.value = await getAlertById(row.alert_id);
    };
    const submitForm = async () => {


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
            alert_type: activeTab.value
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
            folder: activeFolderId.value
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
        page: "Add Alert"
      });
      } catch (error) {
        console.error('Navigation failed:', error);
      }

    };
    const refreshList = async (folderId: string) => {
      //here we are fetching the alerts from the server because after creating the alert we should get the latest alerts
      //and then we are setting the activeFolderId to the folderId
      //this is done to avoid multiple api calls , when we assign the folderId before fetching it will trigger the watch and it will fetch the alerts again
      //and we dont need to fetch the alerts again because we are already fetching the alerts in the getAlertsFn
      await getAlertsFn(store, folderId);
      await hideForm();
      activeFolderId.value = folderId;
    };
    const hideForm = async () => {
      showAddAlertDialog.value = false;
      await router.push({
        name: "alertList",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          folder: activeFolderId.value,
        },
      });
      track("Button Click", {
        button: "Hide Form",
        page: "Add Alert"
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
            if(filterQuery.value){
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
      // Find the alert based on uuid
      const alertToBeExported = await getAlertById(row.alert_id);

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
          row.folder_name?.id
        );
        $q.notify({
          type: "positive",
          message: t("alerts.alertTriggeredSuccess"),
          timeout: 2000,
        });
      } catch (error: any) {
        $q.notify({
          type: "negative",
          message: error?.response?.data?.message || "Failed to trigger alert",
          timeout: 2000,
        });
      }
    };

    const updateActiveFolderId = async (newVal: any) => {
      //this is the condition we kept because when we we click on the any folder that is there in the the row when we do search across folders
      //at that time if it is the same folder it wont trigger the watch and it will show the alerts of the filtered only 
      //so we are fetching the alerts by the folderId and then filtering the alerts by the activeTab this is done explicitly on only if users clicks on same folder
      if(newVal == activeFolderId.value){
        getAlertsByFolderId(store, newVal);
        filterAlertsByTab();
      }
      //here we are resetting the searchQuery, filterQuery, searchAcrossFolders, allSelectedAlerts, selectedAlerts
      //here we only reset if the value is not null
      if(searchQuery.value) searchQuery.value = "";
      if(filterQuery.value) filterQuery.value = "";
      if(searchAcrossFolders.value) searchAcrossFolders.value = false;
      if(allSelectedAlerts.value) allSelectedAlerts.value = false;
      if(selectedAlerts.value) selectedAlerts.value = [];
      activeFolderId.value = newVal;
      //here we are resetting the selected alerts
      //this is done because we need to reset the selected alerts when the user is changing the folder
      //this is not needed but we are doing it to avoid any potential issues
      filteredResults.value?.forEach((alert: any) => {
        alert.selected = false;
      });
    };

    const editAlert = async (row: any) => {
      const selectedAlert = await getAlertById(row.alert_id);
      showAddUpdateFn({ row: selectedAlert });
    };

    const moveAlertToAnotherFolder = (row: any) => {
      showMoveAlertDialog.value = true;
      selectedAlertToMove.value = [row.alert_id];
      activeFolderToMove.value = activeFolderId.value;
    };

    const updateAcrossFolders = async (
      activeFolderId: any,
      selectedFolderId: any,
    ) => {
      //here we are fetching the alerts of the selected folder first and then fetching the alerts of the active folder
      await getAlertsFn(store, selectedFolderId, "",false);
      await getAlertsFn(store, activeFolderId);
      showMoveAlertDialog.value = false;
      selectedAlertToMove.value = [];
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
      const selectedAlertsToMove = selectedAlerts.value.map((alert: any) => {
        return alert.alert_id;
      });
      selectedAlertToMove.value = selectedAlertsToMove;
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
      if(newVal == ""){
        filterAlertsByTab();
      }
      if (newVal) {
        filterAlertsByQuery(newVal);
      }
    });
    watch(searchAcrossFolders, (newVal) => {
      selectedAlerts.value = [];
      allSelectedAlerts.value = false;
      if(newVal){
        //here we are setting the searchQuery to null and then setting the filterQuery to the searchQuery
        //this is done because we want to clear the searchQuery and then set the filterQuery to the searchQuery
        searchQuery.value = null;
        searchQuery.value = filterQuery.value;
        filterQuery.value = null;
      }
      if(!newVal){
        //here we are setting the filterQuery to null and then setting the searchQuery to the filterQuery
        //here we are also setting the filteredResults to the allAlertsListByFolderId as we are not searching across folders
        //this is done because we want to clear the filterQuery and then set the searchQuery to the filterQuery
        filteredResults.value = store.state.organizationData.allAlertsListByFolderId[activeFolderId.value];
        filterQuery.value = null;
        filterQuery.value = searchQuery.value;
        searchQuery.value = null;
      }
    });
    watch(activeTab, async (newVal) => {
      //here we are resetting the filterQuery when the activeTab is changed
      //this is done because we need to trigger again the filterQuery watch
      if(filterQuery.value){
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
            const alertData = await getAlertById(alertId);
            if (alertData.hasOwnProperty("id")) {
              delete alertData.id;
            }
            return alertData;
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
            const value = typeof item.value === 'string' ? `'${item.value}'` : item.value;
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
          sqlMode: false,        // Display format (lowercase operators)
          addWherePrefix: false,
          formatValues: false,   // Simple display without type-aware formatting
        });

        // Wrap in parentheses if it's the root level and has content
        return isRoot && result ? `(${result})` : result;
      }
      //this function is used to filter the alerts by the local search not the global search
      //this will be used when the user is searching for the alerts in the same folder
    const filterAlertsByQuery = (query: string) => {
      let tempResults = allAlerts.value.filter((alert: any) =>
          alert.name.toLowerCase().includes(query.toLowerCase())
        )
        filteredResults.value = tempResults.filter((alert: any) => {
          //here we are filtering the alerts by the activeTab
          if(activeTab.value === "scheduled"){
            return !alert.is_real_time;
          } 
          //we filter the alerts by the realTime tab
          else if(activeTab.value === "realTime"){
            return alert.is_real_time;
          } 
          //else we will return all the alerts
          else {
            return true;
          }
        })
    }

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
          isResuming ? !alert.enabled : alert.enabled
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
          payload
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
          };
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
        activeFolderId.value
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
      const errorMessage = error.response?.data?.message || error?.message || "Error deleting alerts. Please try again.";
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

    const openSREChat = (alert?: any) => {
      store.state.sreChatContext = {
        type: 'alert',
        data: alert || null,
      };
      store.dispatch("setIsSREChatOpen", true);
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
      outlinedDelete,
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
      outlinedPause,
      outlinedPlayArrow,
      toggleAlertState,
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
      updateActiveFolderId,
      activeFolderId,
      editAlert,
      deleteAlertByAlertId,
      showMoveAlertDialog,
      outlinedDriveFileMove,
      selectedAlertToMove,
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
      expandedAlertHistory,
      isLoadingHistory,
      historyTableColumns,
      allSelectedAlerts,
      copyToClipboard,
      openMenu,
      outlinedMoreVert,
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
      openSREChat,
      config,
    };
  },
});
</script>

<style lang="scss">
.view-mode-tabs-container {
  margin-right: 24px;

  // Customize app-tabs for view mode switching
  ::v-deep .app-tabs {
    .q-tabs {
      min-height: 36px;
    }

    .q-tab {
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
.all-folders-toggle{
  :deep(.q-toggle__inner){
    height: 1.1em !important;
  }
  :deep(.q-toggle__label ){
    margin-top: 2px !important;
  }
}
</style>