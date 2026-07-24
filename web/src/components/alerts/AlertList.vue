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
  <div data-test="alert-list-page" class="flex h-full flex-col">
    <OPageLayout
      bleed
      v-if="!showAddAlertDialog && !showImportAlertDialog"
      :title="t('alerts.header')"
      :subtitle="t('alerts.subtitle')"
      icon="shield-alert-outline"
    >
      <template #actions>
        <!-- Import button -->
        <OButton
          :class="isCompactToolbar ? 'min-w-0! px-2! py-0!' : ''"
          variant="outline"
          size="sm"
          @click="importAlert"
          data-test="alert-import"
          icon-left="upload-file"
        >
          <template v-if="!isCompactToolbar">{{ t(`dashboard.import`) }}</template>
          <OTooltip
            v-if="isCompactToolbar"
            :content="t('dashboard.import')"
            side="bottom"
            shortcut-id="alertsImport"
          />
        </OButton>
        <!-- Add button — routes to anomaly creation on anomaly tab, alert creation otherwise -->
        <OButton
          data-test="alert-list-add-alert-btn"
          variant="primary"
          size="sm"
          :disabled="!destinations.length || !templates.length"
          :title="!destinations.length ? t('alerts.noDestinations') : ''"
          @click="
            activeTab === 'anomalyDetection'
              ? router.push({
                  name: 'addAnomalyDetection',
                  query: {
                    org_identifier: store.state.selectedOrganization.identifier,
                    folder: activeFolderId,
                    tab: activeTab,
                  },
                })
              : showAddUpdateFn({})
          "
          >{{ t(`alerts.add`) }}</OButton
        >
      </template>

      <div data-test="alert-list-splitter" class="flex min-h-0 flex-1">
        <!-- Left: FolderList -->
        <div class="w-rail h-full shrink-0">
          <div class="h-full">
            <FolderList type="alerts" @update:activeFolderId="updateActiveFolderId" />
          </div>
        </div>
        <!-- Right: Table -->
        <div class="h-full min-w-0 flex-1">
          <div class="bg-card-glass-bg h-full">
            <!-- Alert List Table (shows all alert types including anomaly detection rows) -->
            <OTable
              :frame="false"
              v-model:selected-ids="selectedAlertIds"
              selection="multiple"
              data-test="alert-list-table"
              :data="displayedAlerts"
              :columns="columns"
              show-index
              row-key="alert_id"
              :loading="loading"
              pagination="client"
              :page-size="pageSize"
              :page-size-options="pageSizeOptions"
              width="100%"
              :show-global-filter="false"
              :default-columns="false"
              :enable-column-resize="true"
              :persist-columns="true"
              table-id="alerts-alert-list"
              :row-class="alertRowClass"
              :get-row-style="alertRowStyle"
              @row-click="triggerExpand"
            >
              <!-- Summary strip: at-a-glance operational counts for the folder.
                     Rendered via OTable's #subheader slot so it sits BELOW the
                     search/tabs and above the rows. Always rendered (skeleton
                     while loading) so data arriving never shifts the layout. -->
              <template #subheader>
                <div
                  class="px-page-edge border-table-row-divider border-b py-1.5"
                  data-test="alert-list-summary"
                >
                  <OStatStrip
                    :items="summaryStats"
                    :loading="loading"
                    selectable
                    :selected-key="stateFilter"
                    @select="onStatSelect"
                  />
                </div>
              </template>

              <!-- Toolbar: alert-type filter + search (inline folder scope) + refresh. -->
              <template #toolbar>
                <div class="flex w-full items-center gap-2">
                  <OToggleGroup
                    :model-value="activeTab"
                    @update:model-value="
                      (v) => {
                        activeTab = v as string;
                        filterAlertsByTab();
                      }
                    "
                  >
                    <OToggleGroupItem value="all" size="sm" data-test="tab-all">
                      <template #icon-left
                        ><OIcon name="format-list-bulleted" size="sm"
                      /></template>
                      {{ t("alerts.all") }}
                    </OToggleGroupItem>
                    <OToggleGroupItem value="scheduled" size="sm" data-test="tab-scheduled">
                      <template #icon-left><OIcon name="schedule" size="sm" /></template>
                      {{ t("alerts.scheduled") }}
                    </OToggleGroupItem>
                    <OToggleGroupItem value="realTime" size="sm" data-test="tab-realTime">
                      <template #icon-left><OIcon name="bolt" size="sm" /></template>
                      {{ t("alerts.realTime") }}
                    </OToggleGroupItem>
                    <OToggleGroupItem
                      v-if="isAnomalyDetectionEnabled"
                      value="anomalyDetection"
                      size="sm"
                      data-test="tab-anomalyDetection"
                    >
                      <template #icon-left><OIcon name="query-stats" size="sm" /></template>
                      {{ t("alerts.anomalyDetection") }}
                    </OToggleGroupItem>
                  </OToggleGroup>
                  <div class="min-w-0 flex-1">
                    <OInput
                      v-model="dynamicQueryModel"
                      :placeholder="
                        searchAcrossFolders ? t('dashboard.searchAcross') : t('alerts.search')
                      "
                      :clearable="searchAcrossFolders"
                      @clear="clearSearchHistory"
                      data-test="alert-list-search-input"
                      class="w-full"
                    >
                      <template #icon-left>
                        <OIcon name="search" size="sm" />
                      </template>
                      <template #icon-right>
                        <OToggleGroup
                          :model-value="searchAcrossFolders ? 'all' : 'this'"
                          type="single"
                          class="mr-1 self-center"
                          @update:model-value="(v) => (searchAcrossFolders = v === 'all')"
                        >
                          <OToggleGroupItem
                            value="this"
                            size="xs"
                            icon-left="folder-outline"
                            data-test="alert-list-search-scope-current"
                            :title="t('alerts.searchThisFolderTooltip')"
                            >{{ t("alerts.searchThisFolder") }}</OToggleGroupItem
                          >
                          <OToggleGroupItem
                            value="all"
                            size="xs"
                            icon-left="search"
                            data-test="alert-list-search-across-folders-toggle"
                            :title="t('alerts.searchAllFoldersTooltip')"
                            >{{ t("alerts.searchAllFolders") }}</OToggleGroupItem
                          >
                        </OToggleGroup>
                      </template>
                    </OInput>
                  </div>
                </div>
              </template>
              <template #toolbar-trailing>
                <OButton
                  variant="outline"
                  size="icon-sm"
                  icon-left="refresh"
                  :loading="loading"
                  data-test="alert-list-refresh-btn"
                  @click="refreshAlerts"
                >
                  <OTooltip
                    side="bottom"
                    :content="t('alerts.reloadAlertsTooltip')"
                    shortcut-id="alertsRefresh"
                  />
                </OButton>
              </template>

              <template #cell-name="{ row }">
                <div class="flex min-w-0 items-center gap-2 overflow-hidden">
                  <!-- Type chip: glyph + colour by alert type -->
                  <span
                    class="rounded-default bg-surface-subtle grid h-6 w-6 shrink-0 place-items-center"
                  >
                    <OIcon :name="typeIconName(row)" size="sm" :class="typeIconClass(row)" />
                  </span>
                  <span class="truncate">{{ row.name || "--" }}</span>
                </div>
                <OTooltip
                  v-if="row.name"
                  :content="row.name"
                  content-class="max-w-100 whitespace-normal break-words text-xs"
                />
              </template>

              <template #cell-owner="{ row }">
                <OUserCell :value="row.owner" />
              </template>

              <template #cell-last_triggered_at="{ row }">
                <span class="inline-flex min-w-0 items-center gap-1.5">
                  <span
                    v-if="['hot', 'warm'].includes(recencyLevel(row.last_triggered_at_raw))"
                    class="h-1.5 w-1.5 shrink-0 rounded-full"
                    :class="
                      recencyLevel(row.last_triggered_at_raw) === 'hot'
                        ? 'bg-warning-500 motion-safe:animate-pulse'
                        : 'bg-text-muted'
                    "
                  />
                  <OTimeCell
                    :value="row.last_triggered_at_raw"
                    unit="us"
                    mode="relative"
                    :timezone="store.state.timezone"
                    :empty-label="t('alerts.anomaly.retrainNever')"
                  />
                </span>
              </template>

              <template #cell-last_satisfied_at="{ row }">
                <OTimeCell
                  :value="row.last_satisfied_at"
                  unit="iso"
                  mode="absolute"
                  :timezone="store.state.timezone"
                  :empty-label="t('alerts.anomaly.retrainNever')"
                />
              </template>

              <template #cell-last_trained_at="{ row }">
                <OTimeCell
                  :value="row.last_trained_at"
                  unit="iso"
                  mode="absolute"
                  :timezone="store.state.timezone"
                  empty-label="—"
                />
              </template>

              <template #cell-status="{ row }">
                <span v-if="row.status && row.status !== '--'" class="relative inline-flex">
                  <OTag type="alertStatus" :value="row.status" />
                  <OTooltip
                    v-if="row.status === 'failed' && row.last_error"
                    :max-width="'400px'"
                    :content="row.last_error"
                  />
                </span>
                <span v-else class="text-text-body">—</span>
              </template>

              <template #cell-state="{ row }">
                <OTag
                  :variant="stateVariant(row)"
                  size="sm"
                  :data-test="`alert-list-${row.name}-state`"
                >
                  <template #icon>
                    <OIcon :name="stateIconName(row)" size="xs" />
                  </template>
                  {{ stateLabel(row) }}
                </OTag>
              </template>

              <template #cell-period="{ row }">
                {{
                  row.period
                    ? row.period >= 60
                      ? row.period % 60 === 0
                        ? `${Math.floor(row.period / 60)} Hours`
                        : `${Math.floor(row.period / 60)} Hours ${row.period % 60} Mins`
                      : `${row.period} Mins`
                    : "--"
                }}
              </template>

              <template #cell-frequency="{ row }">
                {{
                  row.frequency
                    ? row.frequency + (row.frequency_type == "cron" ? "" : " Mins")
                    : "--"
                }}
              </template>

              <template #cell-folder_name="{ row }">
                <div @click.stop="updateActiveFolderId(row.folder_name.id)">
                  {{ row.folder_name.name }}
                </div>
              </template>

              <template #cell-actions="{ row }">
                <div class="actions-container flex items-center">
                  <div
                    data-test="alert-list-loading-alert"
                    v-if="alertStateLoadingMap[row.uuid]"
                    style="display: inline-block; width: 33.14px; height: auto"
                    class="ml-1 flex items-center justify-center"
                    :title="`Turning ${row.enabled ? 'Off' : 'On'}`"
                  >
                    <OSpinner size="xs" />
                  </div>
                  <OButton
                    v-else
                    :data-row-action="row.enabled ? 'pause' : 'resume'"
                    :data-test="`alert-list-${row.name}-pause-start-alert`"
                    class="ml-1"
                    :variant="row.enabled ? 'ghost-destructive' : 'ghost-success'"
                    size="icon-sm"
                    :icon-left="row.enabled ? 'pause' : 'play-arrow'"
                    @click.stop="toggleAlertState(row)"
                  >
                    <OTooltip
                      side="bottom"
                      :content="row.enabled ? t('alerts.pause') : t('alerts.start')"
                      :shortcut-id="row.enabled ? 'alertsRowPause' : undefined"
                    />
                  </OButton>
                  <OButton
                    data-row-action="edit"
                    :data-test="`alert-list-${row.name}-update-alert`"
                    variant="ghost"
                    size="icon-sm"
                    icon-left="edit"
                    @click.stop="editAlert(row)"
                  >
                    <OTooltip
                      side="bottom"
                      :content="t('alerts.edit')"
                      shortcut-id="alertsRowEdit"
                    />
                  </OButton>
                  <OButton
                    data-row-action="duplicate"
                    variant="ghost"
                    size="icon-sm"
                    icon-left="content-copy"
                    @click.stop="duplicateAlert(row)"
                    :data-test="`alert-list-${row.name}-clone-alert`"
                  >
                    <OTooltip
                      side="bottom"
                      :content="t('alerts.clone')"
                      shortcut-id="alertsRowDuplicate"
                    />
                  </OButton>
                  <!-- Hidden proxies so the row-hover shortcuts work for
                         actions that live in the more-menu dropdown (which is
                         teleported out of the row DOM): x = export, Del = delete. -->
                  <button
                    type="button"
                    data-row-action="export"
                    class="hidden"
                    tabindex="-1"
                    aria-hidden="true"
                    @click.stop="exportAlert(row)"
                  />
                  <button
                    type="button"
                    data-row-action="delete"
                    class="hidden"
                    tabindex="-1"
                    aria-hidden="true"
                    @click.stop="showDeleteDialogFn({ row })"
                  />
                  <ODropdown>
                    <template #trigger>
                      <OButton
                        variant="ghost"
                        size="icon-sm"
                        icon-left="more-vert"
                        @click.stop="openMenu($event, row)"
                        :data-test="`alert-list-${row.name}-more-options`"
                      />
                    </template>
                    <ODropdownItem
                      :data-test="`alert-list-${row.name}-move-alert`"
                      @select="moveAlertToAnotherFolder(row)"
                    >
                      <template #icon-left>
                        <OIcon name="drive-file-move" size="sm" />
                      </template>
                      {{ t("common.move") }}
                    </ODropdownItem>
                    <ODropdownSeparator />
                    <ODropdownItem
                      :data-test="`alert-list-${row.name}-delete-alert`"
                      variant="destructive"
                      shortcut-id="alertsRowDelete"
                      @select="showDeleteDialogFn({ row })"
                    >
                      <template #icon-left>
                        <OIcon name="delete" size="sm" />
                      </template>
                      {{ t("alerts.delete") }}
                    </ODropdownItem>
                    <ODropdownSeparator />
                    <ODropdownItem
                      :data-test="`alert-list-${row.name}-export-alert`"
                      shortcut-id="alertsRowExport"
                      @select="exportAlert(row)"
                    >
                      <template #icon-left>
                        <OIcon size="sm" name="download" />
                      </template>
                      {{ t("common.export") }}
                    </ODropdownItem>
                    <ODropdownSeparator />
                    <!-- Anomaly Detection: Trigger Detection + Re-train -->
                    <template v-if="row.type === 'anomaly'">
                      <ODropdownItem
                        :data-test="`alert-list-${row.name}-trigger-detection`"
                        @select="triggerAlert(row)"
                      >
                        <template #icon-left>
                          <OIcon size="sm" name="sound-sampler" />
                        </template>
                        {{ t("alerts.triggerDetection") }}
                      </ODropdownItem>
                      <ODropdownItem
                        :data-test="`alert-list-${row.name}-retrain-anomaly`"
                        @select="retrainAnomaly(row)"
                      >
                        <template #icon-left>
                          <OIcon size="sm" name="replay" />
                        </template>
                        {{ t("alerts.retrain") }}
                      </ODropdownItem>
                    </template>
                    <!-- Regular alerts: Trigger Alert item -->
                    <ODropdownItem
                      v-else
                      :data-test="`alert-list-${row.name}-trigger-alert`"
                      @select="triggerAlert(row)"
                    >
                      <template #icon-left>
                        <OIcon size="sm" name="sound-sampler" />
                      </template>
                      {{ t("alerts.triggerAlert") }}
                    </ODropdownItem>
                  </ODropdown>
                </div>
              </template>

              <template #empty>
                <OEmptyState
                  v-if="!templates.length"
                  size="hero"
                  preset="no-alert-templates"
                  :description="t('alerts.noTemplatesMsg')"
                  data-test="alert-list-create-template-text"
                  @action="routeTo('alertTemplates')"
                />
                <OEmptyState
                  v-else-if="!destinations.length"
                  size="hero"
                  preset="no-alert-destinations"
                  :description="t('alerts.noDestinationsMsg')"
                  data-test="alert-list-create-destination-text"
                  @action="routeTo('alertDestinations')"
                />
                <OEmptyState
                  v-else
                  size="hero"
                  preset="no-alerts"
                  :filtered="!!(filterQuery || searchQuery || stateFilter)"
                  @action="
                    (id) =>
                      id === 'clear-filters'
                        ? ((filterQuery = ''), (searchQuery = ''), (stateFilter = null))
                        : showAddUpdateFn({})
                  "
                />
              </template>

              <template #bottom>
                <div class="flex h-12 w-full items-center justify-between gap-1">
                  <div class="flex min-w-25 items-center text-xs font-normal">
                    <template v-if="selectedAlerts.length > 0"
                      >{{ selectedAlerts.length }} {{ t("alerts.conditionOf") }} {{ resultTotal }}
                      {{ t("alerts.selectedLabel") }}</template
                    >
                    <template v-else>{{ resultTotal }} {{ t("alerts.header") }}</template>
                  </div>

                  <OButton
                    v-if="selectedAlerts.length > 0"
                    data-test="alert-list-move-across-folders-btn"
                    variant="outline"
                    size="sm"
                    icon-left="drive-file-move"
                    @click="moveMultipleAlerts"
                    >{{ t("common.move") }}</OButton
                  >
                  <OButton
                    v-if="selectedAlerts.length > 0"
                    data-test="alert-list-export-alerts-btn"
                    variant="outline"
                    size="sm"
                    icon-left="download"
                    @click="multipleExportAlert"
                    >{{ t("common.export") }}</OButton
                  >
                  <OButton
                    v-if="selectedAlerts.length > 0"
                    data-test="alert-list-pause-alerts-btn"
                    variant="outline"
                    size="sm"
                    icon-left="pause"
                    @click="bulkToggleAlerts('pause')"
                    >{{ t("alerts.pause") }}</OButton
                  >
                  <OButton
                    v-if="selectedAlerts.length > 0"
                    data-test="alert-list-unpause-alerts-btn"
                    variant="outline"
                    size="sm"
                    icon-left="play-arrow"
                    @click="bulkToggleAlerts('resume')"
                    >{{ t("alerts.resume") }}</OButton
                  >
                  <OButton
                    v-if="selectedAlerts.length > 0"
                    data-test="alert-list-delete-alerts-btn"
                    variant="outline-destructive"
                    size="sm"
                    icon-left="delete"
                    :loading="bulkDeleteLoading"
                    @click="openBulkDeleteDialog"
                    >{{ t("common.delete") }}</OButton
                  >
                </div>
              </template>
            </OTable>
          </div>
        </div>
      </div>
    </OPageLayout>
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
        :folderId="activeFolderId"
        @update:alerts="refreshImportedAlerts"
        @update:destinations="refreshDestination"
        @update:templates="getTemplates"
      />
    </template>

    <ConfirmDialog
      :title="t('alerts.deleteAlertTitle')"
      :message="t('alerts.deleteAlertMessage')"
      @update:ok="deleteAlertByAlertId"
      @update:cancel="confirmDelete = false"
      v-model="confirmDelete"
    />

    <ConfirmDialog
      :title="t('alerts.deleteAlertsTitle')"
      :message="`Are you sure you want to delete ${selectedAlerts.length} alert(s)?`"
      @update:ok="bulkDeleteAlerts"
      @update:cancel="confirmBulkDelete = false"
      v-model="confirmBulkDelete"
    />

    <template>
      <ODialog
        data-test="alert-list-form-dialog"
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
        <div>
          <OInput
            data-test="to-be-clone-alert-name"
            v-model="toBeCloneAlertName"
            :label="t('alerts.alertName')"
          />
          <OSelect
            data-test="to-be-clone-stream-type"
            v-model="toBeClonestreamType"
            :label="t('alerts.streamType')"
            :options="streamTypes"
            @update:model-value="updateStreams()"
            class="mt-1"
          />
          <OSelect
            data-test="to-be-clone-stream-name"
            v-model="toBeClonestreamName"
            :disabled="!toBeClonestreamType"
            :label="t('alerts.stream_name')"
            :options="indexOptions"
            searchable
            @update:model-value="updateStreamName"
            class="mt-1 mb-2"
          />
          <div class="mb-4">
            <SelectFolderDropDown
              :type="'alerts'"
              @folder-selected="updateFolderIdToBeCloned"
              :activeFolderId="folderIdToBeCloned"
            />
          </div>
        </div>
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
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import type { Ref } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";

import { convertUnixToDateFormat as convertUnixToFormat } from "@/utils/date";
import { useI18n } from "vue-i18n";
import { debounce } from "lodash-es";
import alertsService from "@/services/alerts";
import destinationService from "@/services/alert_destination";
import templateService from "@/services/alert_templates";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import segment from "@/services/segment_analytics";
import config from "@/aws-exports";
import ImportAlert from "@/components/alerts/ImportAlert.vue";
import { getImageURL, getUUID, verifyOrganizationStatus } from "@/utils/zincutils";
import { copyToClipboard } from "@/utils/clipboard";
import { useReo } from "@/services/reodotdev_analytics";
import type { Alert } from "@/ts/interfaces/index";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import FolderList from "../common/sidebar/FolderList.vue";

import MoveAcrossFolders from "../common/sidebar/MoveAcrossFolders.vue";
import { nextTick } from "vue";
import SelectFolderDropDown from "../common/sidebar/SelectFolderDropDown.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import AlertHistoryDrawer from "@/components/alerts/AlertHistoryDrawer.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import { buildConditionsString } from "@/utils/alerts/conditionsFormatter";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OStatStrip from "@/lib/data/StatStrip/OStatStrip.vue";
import type { StatItem } from "@/lib/data/StatStrip/OStatStrip.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { OTableColumnDef } from "@/lib/core/Table/OTable.types";
import { toast } from "@/lib/feedback/Toast/useToast";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { focusSearchInput, isInputFocused } from "@/utils/keyboardShortcuts";
import { COL } from "@/lib/core/Table/OTable.types";
// import alertList from "./alerts";

export default defineComponent({
  name: "AlertList",
  components: {
    OPageLayout,
    AddAlert: defineAsyncComponent(() => import("@/components/alerts/AddAlert.vue")),
    OEmptyState,
    ConfirmDialog,
    ImportAlert,
    FolderList,
    MoveAcrossFolders,
    OToggleGroup,
    OToggleGroupItem,
    OInput,
    OTooltip,
    SelectFolderDropDown,
    AlertHistoryDrawer,
    OButton,
    OIcon,
    ODialog,
    ODropdown,
    ODropdownItem,
    ODropdownSeparator,
    OSpinner,
    OSelect,
    OTable,
    OTimeCell,
    OUserCell,
    OTag,
    OStatStrip,
  },
  emits: ["update:changeRecordPerPage", "update:maxRecordToReturn"],
  setup() {
    const store = useStore();
    const { t } = useI18n();
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
    const selectedDelete: any = ref(null);
    const isUpdated: any = ref(false);
    const confirmDelete = ref<boolean>(false);
    const splitterModel = ref(200);
    const showForm = ref(false);
    const indexOptions = ref([]);
    const schemaList = ref([]);
    const streams: any = ref({});
    const isFetchingStreams = ref(false);
    // Start in the loading state so the table shows the skeleton on first
    // render instead of briefly flashing the empty state before the fetch.
    const loading = ref(true);
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
    const activeFolderId = ref<any>(router.currentRoute.value.query.folder ?? "default");
    const showMoveAlertDialog = ref(false);
    const showAlertDetailsDrawer = ref(false);
    const selectedAlertDetails: Ref<any> = ref(null);

    const triggerExpand = (row: any) => {
      // Open drawer instead of inline expansion
      const alert = row;

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
              const column = item.column || "field";
              const operator = item.operator || "=";
              const value = typeof item.value === "string" ? `'${item.value}'` : item.value;
              return `${column} ${operator} ${value}`;
            });
            displayConditions = parts.length > 0 ? `(${parts.join(" AND ")})` : "--";
          } else {
            // Unknown format or empty
            displayConditions = typeof conditionData === "string" ? conditionData : "--";
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

    // ESC and click-outside dismissal are handled by ODrawer itself (reka-ui
    // DismissableLayer → @escape-key-down / @interact-outside), which also knows
    // to ignore clicks inside portaled dropdowns opened from within the drawer.

    onMounted(() => {
      window.addEventListener("resize", onWindowResize);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("resize", onWindowResize);
    });

    // Show anomaly detection only when the backend is an enterprise or cloud build.
    // The frontend build flag alone is not sufficient — an enterprise UI can be
    // pointed at an OSS backend which does not have the feature.
    // The backend can also disable it at runtime via O2_ANOMALY_DETECTION_DISABLED,
    // surfaced as anomaly_detection_enabled in the config API response.
    const isAnomalyDetectionEnabled = computed(
      () =>
        store.state.zoConfig.build_type !== "opensource" &&
        config.isEnterprise === "true" &&
        store.state.zoConfig.anomaly_detection_enabled === true,
    );

    // Initialize activeTab from URL query parameter, default to "all".
    // Prevent forcing anomalyDetection tab when the feature is not available.
    const rawTab = (router.currentRoute.value.query.tab as string) || "all";
    const activeTab = ref(
      rawTab === "anomalyDetection" && !isAnomalyDetectionEnabled.value ? "all" : rawTab,
    );

    const filteredResults: Ref<any[]> = ref([]);

    // ── "Calm Signal" table helpers ─────────────────────────────────────────
    // Recency of the last trigger, bucketed for the trigger-time dot + the
    // recently-fired row highlight. Derived from the RAW microsecond timestamp
    // (last_triggered_at_raw) so it stays correct regardless of display timezone.
    const RECENT_TRIGGER_MS = 15 * 60 * 1000; // "hot" — fired in the last 15 min
    const RECENT_TRIGGER_DAY_MS = 24 * 60 * 60 * 1000; // "warm" — within a day
    const triggerAgeMs = (rawMicros: unknown): number | null => {
      const n = Number(rawMicros);
      if (!rawMicros || !Number.isFinite(n) || n <= 0) return null;
      return Date.now() - n / 1000; // microseconds → milliseconds
    };
    const recencyLevel = (rawMicros: unknown): "hot" | "warm" | "cold" | "none" => {
      const age = triggerAgeMs(rawMicros);
      if (age === null) return "none";
      if (age <= RECENT_TRIGGER_MS) return "hot";
      if (age <= RECENT_TRIGGER_DAY_MS) return "warm";
      return "cold";
    };

    // ── Alert operational state (single source of truth) ────────────────────
    // failed  → an anomaly whose model training failed (needs attention)
    // active  → enabled and running
    // paused  → disabled
    const alertState = (row: any): "active" | "paused" | "failed" => {
      if (row?.is_real_time === "anomaly" && String(row?.status).toLowerCase() === "failed")
        return "failed";
      return row?.enabled ? "active" : "paused";
    };

    // Full-row highlight — only the EXCEPTIONS get a wash, so attention goes to
    // what's off, not what's fine: failed=light red, paused=muted grey, active
    // stays clean (its state still reads from the green left rail).
    const alertRowClass = (row: any): string => {
      const s = alertState(row);
      return s === "failed" ? "!bg-status-error-bg" : s === "paused" ? "!bg-surface-panel" : "";
    };

    // Extreme-left state rail — a full-height colour bar at the very start of the
    // row (inset box-shadow so it paints regardless of border-collapse). rem width
    // + token colour keep it theme-aware and hardcode-free.
    const alertRowStyle = (row: any): Record<string, string> => {
      const s = alertState(row);
      const color =
        s === "failed"
          ? "var(--color-error-500)"
          : s === "paused"
            ? "var(--color-grey-400)"
            : "var(--color-success-500)";
      return { boxShadow: `inset 0.25rem 0 0 0 ${color}` };
    };

    // Type chip (the "left chip"): glyph + colour by alert type.
    const typeIconName = (row: any): IconName =>
      row?.is_real_time === "anomaly" ? "query-stats" : row?.is_real_time ? "bolt" : "schedule";
    const typeIconClass = (row: any): string =>
      row?.is_real_time === "anomaly"
        ? "text-status-info-text"
        : row?.is_real_time
          ? "text-status-warning-text"
          : "text-text-secondary";

    // Redesigned State chip (icon + colour + word).
    const stateVariant = (row: any): BadgeVariant => {
      const s = alertState(row);
      return s === "failed" ? "error-soft" : s === "paused" ? "default-soft" : "success-soft";
    };
    const stateIconName = (row: any): IconName => {
      const s = alertState(row);
      return s === "failed" ? "error-outline" : s === "paused" ? "pause" : "check-circle";
    };
    const stateLabel = (row: any): string => {
      const s = alertState(row);
      return s === "failed"
        ? t("alerts.stateFailed")
        : s === "paused"
          ? t("alerts.statePaused")
          : t("alerts.stateActive");
    };

    // At-a-glance operational counts for the summary strip. Counts over the rows
    // currently shown (folder + tab + search) so it tracks what the user sees.
    const stateCounts = computed(() => {
      const rows = filteredResults.value || [];
      let active = 0;
      let paused = 0;
      let failed = 0;
      let recent = 0;
      for (const r of rows) {
        if (r.enabled) active += 1;
        else paused += 1;
        if (r.is_real_time === "anomaly" && String(r.status).toLowerCase() === "failed")
          failed += 1;
        if (recencyLevel(r.last_triggered_at_raw) === "hot") recent += 1;
      }
      return { active, paused, failed, recent, total: rows.length };
    });

    // Stat tiles for the summary strip. `tone` is the single source of colour so
    // states stay consistent with the row-level State pills. When the folder is
    // empty (no data at all) every tile shows a muted "—"; once there IS data,
    // real counts show — including a legitimate "0". The `max` gives each state
    // tile a proportion bar (its share of the total).
    const summaryStats = computed<StatItem[]>(() => {
      const c = stateCounts.value;
      const hasData = c.total > 0;
      const v = (n: number): string | number => (hasData ? n : "—");
      const share = hasData ? c.total : undefined;
      // Severity-descending so what needs attention sits on the left (matches the
      // Incidents / Eval Jobs strips): failed (error) → recent (warning) → active
      // (healthy) → paused (inert) → Total last.
      return [
        {
          key: "failed",
          label: t("alerts.summaryFailed"),
          value: v(c.failed),
          icon: "error-outline",
          tone: "error",
          max: share,
          dataTest: "alert-summary-failed",
        },
        {
          key: "recent",
          label: t("alerts.summaryRecent"),
          value: v(c.recent),
          icon: "bolt",
          tone: "warning",
          max: share,
          dataTest: "alert-summary-recent",
        },
        {
          key: "active",
          label: t("alerts.summaryActive"),
          value: v(c.active),
          icon: "check-circle",
          tone: "success",
          max: share,
          dataTest: "alert-summary-active",
        },
        {
          key: "paused",
          label: t("alerts.summaryPaused"),
          value: v(c.paused),
          icon: "pause",
          tone: "neutral",
          max: share,
          dataTest: "alert-summary-paused",
        },
        {
          key: "total",
          label: t("alerts.summaryTotal"),
          value: v(c.total),
          icon: "format-list-bulleted",
          tone: "primary",
          // Total is clickable (clears the filter) but never shows the ring — the
          // selected key is only ever a real state, never "total". No bar (its
          // share of itself is always 100%).
          dataTest: "alert-summary-total",
        },
      ];
    });

    // ── Stat-tile quick filter ──────────────────────────────────────────────
    // Clicking a summary tile filters the table to that state (toggle); the
    // "total" tile clears it. Counts on the tiles stay full (from filteredResults)
    // so you always see the folder totals; only the table rows are filtered.
    const stateFilter = ref<"active" | "paused" | "failed" | "recent" | null>(null);
    const displayedAlerts = computed(() => {
      const rows = filteredResults.value || [];
      const f = stateFilter.value;
      if (!f) return rows;
      if (f === "recent")
        return rows.filter((r: any) => recencyLevel(r.last_triggered_at_raw) === "hot");
      return rows.filter((r: any) => alertState(r) === f);
    });
    const onStatSelect = (key: string) => {
      if (key === "total") {
        stateFilter.value = null;
        return;
      }
      stateFilter.value =
        stateFilter.value === key ? null : (key as "active" | "paused" | "failed" | "recent");
    };

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

    const columns = computed<OTableColumnDef[]>(() => {
      const baseColumns: OTableColumnDef[] = [
        {
          id: "name",
          accessorKey: "name",
          header: t("alerts.name"),
          sortable: true,
          hideable: true,
          size: 280,
          minSize: 320,
          // Flex: fills the leftover width on load, freezes on first resize.
          meta: { align: "left", flex: true },
        },
        // "state" (Active / Paused) — a single at-a-glance operational state for
        // EVERY alert type, derived from `enabled`. Sits right after the name so
        // it's always visible without horizontal scroll. Distinct from the
        // anomaly-only "status" (training) column: this answers "is it running?".
        {
          id: "state",
          accessorKey: "enabled",
          header: t("alerts.state"),
          cell: " ",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.status,
          meta: { align: "left" },
        },
        {
          id: "owner",
          accessorKey: "owner",
          header: t("alerts.owner"),
          cell: " ",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.owner,
          meta: { align: "left" },
        },
        // "period" (Look back window) — all tabs except realTime
        ...(activeTab.value !== "realTime"
          ? [
              {
                id: "period",
                accessorKey: "period",
                header: t("alerts.period"),
                cell: " ",
                sortable: true,
                resizable: true,
                hideable: true,
                size: 150,
                meta: { align: "left" },
              } as OTableColumnDef,
            ]
          : []),
        // "frequency" (Check every) — all tabs except realTime
        ...(activeTab.value !== "realTime"
          ? [
              {
                id: "frequency",
                accessorKey: "frequency",
                header: t("alerts.frequency"),
                cell: " ",
                sortable: true,
                resizable: true,
                hideable: true,
                size: COL.frequency,
                meta: { align: "left" },
              } as OTableColumnDef,
            ]
          : []),
        {
          id: "last_triggered_at",
          accessorKey: "last_triggered_at",
          header: t("alerts.lastTriggered"),
          cell: " ",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.dateAbsolute,
          meta: { align: "left" },
        },
        {
          id: "last_satisfied_at",
          accessorKey: "last_satisfied_at",
          header: t("alerts.lastSatisfied"),
          cell: " ",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.dateAbsolute,
          meta: { align: "left" },
        },
        // Anomaly Detection columns — shown on anomalyDetection and all tabs
        ...(activeTab.value === "anomalyDetection" || activeTab.value === "all"
          ? [
              {
                id: "last_trained_at",
                accessorKey: "last_trained_at",
                header: t("alerts.lastTrainedAt"),
                cell: " ",
                sortable: true,
                resizable: true,
                hideable: true,
                size: COL.dateAbsolute,
                meta: { align: "left" },
              } as OTableColumnDef,
              {
                id: "status",
                accessorKey: "status",
                header: t("alerts.status"),
                cell: " ",
                sortable: true,
                resizable: true,
                hideable: true,
                size: COL.status,
                meta: { align: "left" },
              } as OTableColumnDef,
            ]
          : []),
        {
          id: "actions",
          header: t("alerts.actions"),
          isAction: true,
          sortable: false,
          size: 150,
          meta: { align: "center", cellClass: "actions-column", actionCount: 4 },
        },
      ];

      // insert folder_name column after the name column if applicable
      if (searchAcrossFolders.value && searchQuery.value !== "") {
        baseColumns.splice(1, 0, {
          id: "folder_name",
          accessorKey: "folder_name",
          header: "Folder",
          cell: " ",
          sortable: true,
          resizable: true,
          hideable: true,
          size: COL.folder,
          meta: { align: "left" },
        } as OTableColumnDef);
      }

      return baseColumns;
    });

    const destinations = ref([0]);
    const templates = ref([0]);
    const selectedAlertIds = ref<string[]>([]);
    const selectedAlerts = computed({
      get: () =>
        filteredResults.value.filter((row: any) => selectedAlertIds.value.includes(row.alert_id)),
      set: (val) => {
        if (val.length === 0) {
          selectedAlertIds.value = [];
        }
      },
    });
    const allSelectedAlerts = ref(false);
    const allAlerts: Ref<any[]> = ref([]);

    const searchQuery = ref<any>(savedAlertListFilters.searchQuery || "");
    const filterQuery = ref<any>(savedAlertListFilters.filterQuery || "");
    const searchAcrossFolders = ref<any>(savedAlertListFilters.searchAcrossFolders || false);
    const selectedAlertToMove: Ref<any[]> = ref([]);
    const selectedAnomalyConfigsToMove: Ref<any[]> = ref([]);
    const folderIdToBeCloned = ref<any>(router.currentRoute.value.query.folder ?? "default");
    // ---------------------------------------------------------------------------
    // Anomaly detection scaffolding — TEMPORARY until backend returns anomaly
    // data as part of the alert list API. Remove this block when that happens.
    // ---------------------------------------------------------------------------
    // Normalizes an anomaly-detection item returned by the merged alerts list API
    // (alert_type === "anomaly_detection") into the standard alert row shape.
    const normalizeAnomalyToAlertRow = (anomaly: any, _num?: number): any => ({
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
        ? convertUnixToDateFormat(anomaly.last_triggered_at)
        : "",
      // Raw microsecond epoch — drives the relative-time cell, recency dot and
      // recently-fired row highlight (timezone-independent).
      last_triggered_at_raw: anomaly.last_triggered_at ?? null,
      last_satisfied_at: anomaly.last_satisfied_at
        ? convertUnixToDateFormat(anomaly.last_satisfied_at)
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
        ? convertUnixToDateFormat(anomaly.last_trained_at)
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
      //this is the condition where we are fetching the alerts from the server
      // assigning it to the allAlertsListByFolderId in the store
      if (!store.state.organizationData.allAlertsListByFolderId[folderId]) {
        await getAlertsFn(store, folderId);
      } else {
        //this is the condition where we are assigning the alerts to the filteredResults so whenever
        // we are not fetching the alerts again, we are just assigning the alerts to the filteredResults
        allAlerts.value = store.state.organizationData.allAlertsListByFolderId[folderId];
        // Data is served synchronously from cache — clear the loading flag
        // (it starts true to avoid the empty-state flash) so the table renders
        // the cached rows instead of staying stuck on the skeleton.
        loading.value = false;
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
      if (query) {
        //here we reset the filteredResults before fetching the filtered alerts
        filteredResults.value = [];
      }
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading alerts...",
        timeout: 0,
      });
      if (query) {
        folderId = "";
      }
      loading.value = true;
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
            last_triggered_at: convertUnixToDateFormat(data.last_triggered_at),
            // Raw microsecond epoch — drives the relative-time cell, recency dot
            // and recently-fired row highlight (timezone-independent).
            last_triggered_at_raw: data.last_triggered_at ?? null,
            last_satisfied_at: convertUnixToDateFormat(data.last_satisfied_at),
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
        toast({
          variant: "error",
          message: "Error while pulling alerts.",
        });
      } finally {
        loading.value = false;
      }
    };
    const getAlertById = async (id: string) => {
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while loading alert...",
        timeout: 0,
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
        filteredResults.value = allAlerts.value.filter((alert: any) => !alert.is_real_time);
      } else if (activeTab.value === "realTime") {
        // Real-time: strictly boolean true — anomaly rows excluded
        filteredResults.value = allAlerts.value.filter((alert: any) => alert.is_real_time === true);
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

    const refreshAlerts = async () => {
      if (searchAcrossFolders.value && searchQuery.value) {
        await getAlertsFn(store, activeFolderId.value, searchQuery.value);
      } else {
        await getAlertsFn(store, activeFolderId.value);
      }
      filterAlertsByTab();
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
      { immediate: true },
    );
    watch(
      () => activeFolderId.value,
      async (newVal) => {
        folderIdToBeCloned.value = newVal;
        selectedAlerts.value = [];
        allSelectedAlerts.value = false;

        if (newVal == router.currentRoute.value.query.folder) {
          // Not refetching here — clear the initial loading flag so the table
          // doesn't stay stuck on the skeleton.
          loading.value = false;
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
            toast({
              variant: "error",
              message: "Failed to load alert for editing",
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
          toast({
            variant: "error",
            message: "Error while fetching destinations.",
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
          toast({
            variant: "error",
            message: "Error while fetching templates.",
          }),
        );
    };
    const pageSize = ref<number>(savedAlertListFilters.perPage || 20);
    const pageSizeOptions = [20, 50, 100, 250, 500];
    const resultTotal = computed(function () {
      return displayedAlerts.value?.length;
    });

    // No timezone suffix in this table, unlike the other lists.
    const convertUnixToDateFormat = (unixMicroseconds: any) =>
      convertUnixToFormat(unixMicroseconds, "YYYY-MM-DD HH:mm:ss");

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
          toast({
            variant: "error",
            message: "Please select stream type ",
          });
          return;
        }
        if (!toBeClonestreamName.value) {
          toast({
            variant: "error",
            message: "Please select stream name",
          });
          return;
        }
        isSubmitting.value = true;
        const dismiss = toast({
          variant: "loading",
          message: "Please wait...",
          timeout: 0,
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
            folderIdToBeCloned.value,
          );
          dismiss();
          toast({
            variant: "success",
            message: "Anomaly detection cloned successfully",
          });
          showForm.value = false;
          await getAlertsFn(store, folderIdToBeCloned.value);
          activeFolderId.value = folderIdToBeCloned.value;
        } catch (e: any) {
          dismiss();
          toast({
            variant: "error",
            message: e?.response?.data?.message || "Failed to clone anomaly detection",
          });
        } finally {
          isSubmitting.value = false;
        }
        return;
      }

      if (!toBeClonedAlert.value) {
        toast({
          variant: "error",
          message: "Alert not found",
        });
        return;
      }
      if (!toBeClonestreamType.value) {
        toast({
          variant: "error",
          message: "Please select stream type ",
        });
        return;
      }
      if (!toBeClonestreamName.value) {
        toast({
          variant: "error",
          message: "Please select stream name",
        });
        return;
      }
      isSubmitting.value = true;
      const dismiss = toast({
        variant: "loading",
        message: "Please wait...",
        timeout: 0,
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
              toast({
                variant: "success",
                message: "Alert Cloned Successfully",
              });
              showForm.value = false;
              await getAlertsFn(store, folderIdToBeCloned.value);
              activeFolderId.value = folderIdToBeCloned.value;
            } else {
              toast({
                variant: "error",
                message: res.data.message,
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
            toast({
              variant: "error",
              message: e.response.data.message,
            });
          })
          .finally(() => {
            isSubmitting.value = false;
          });
      } catch (e: any) {
        showForm.value = true;
        isSubmitting.value = false;
        toast({
          variant: "error",
          message: e.data.message,
        });
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
            toast({
              variant: "success",
              message: res.data.message,
            });
            await getAlertsFn(store, activeFolderId.value);
            if (filterQuery.value) {
              filterAlertsByQuery(filterQuery.value);
            }
          } else {
            toast({
              variant: "error",
              message: res.data.message,
            });
          }
        })
        .catch((err) => {
          if (err.response?.status == 403) {
            return;
          }
          toast({
            variant: "error",
            message: err?.data?.message || "Error while deleting alert.",
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
        filteredOptions = options.filter((column: any) => column.toLowerCase().indexOf(value) > -1);
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
        indexOptions.value = streams.value[toBeClonestreamType.value].map((data: any) => {
          return data.name;
        });
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
          toast({
            variant: "success",
            message: isEnabled ? "Alert Resumed Successfully" : "Alert Paused Successfully",
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

      if (Object.prototype.hasOwnProperty.call(alertToBeExported, "id")) {
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
        toast({
          variant: "success",
          message: t("alerts.alertTriggeredSuccess"),
        });
        if (row.type === "anomaly") {
          await getAlertsFn(store, activeFolderId.value);
        }
      } catch (error: any) {
        toast({
          variant: "error",
          message: error?.response?.data?.message || "Failed to trigger alert",
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
        toast({
          variant: "success",
          message: "Retraining triggered",
        });
      } catch (error: any) {
        toast({
          variant: "error",
          message: error?.response?.data?.message || "Failed to trigger retraining",
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

    const updateAcrossFolders = async (activeFolderId: any, selectedFolderId: any) => {
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
        return searchAcrossFolders.value ? searchQuery.value : filterQuery.value;
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
      const dismiss = toast({
        variant: "loading",
        message: "Please wait while searching for dashboards...",
        timeout: 0,
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
          store.state.organizationData.allAlertsListByFolderId[activeFolderId.value] || [];
        allAlerts.value = currentFolderAlerts;
        filterQuery.value = null;
        searchQuery.value = null;
        filterAlertsByTab();
      }
    });
    // Persist filter state to Vuex so it survives navigation to add/edit screens
    watch([searchQuery, filterQuery, searchAcrossFolders, pageSize], () => {
      store.commit("setAlertListFilters", {
        searchQuery: searchQuery.value || "",
        filterQuery: filterQuery.value || "",
        searchAcrossFolders: !!searchAcrossFolders.value,
        perPage: pageSize.value,
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

    const openMenu = (event: Event, _row?: unknown) => {
      event.stopPropagation();
    };

    const multipleExportAlert = async () => {
      try {
        const dismiss = toast({
          variant: "loading",
          message: "Exporting alerts...",
          timeout: 0, // Set timeout to 0 to keep it showing until dismissed
        });

        const alertToBeExported = [];
        const selectedAlertsToExport = selectedAlerts.value.map((alert: any) => alert.alert_id);

        const alertsData = await Promise.all(
          selectedAlertsToExport.map(async (alertId: string) => {
            const res = await alertsService.export_by_id(
              store.state.selectedOrganization.identifier,
              alertId,
            );
            const data = res.data;
            if (Object.prototype.hasOwnProperty.call(data, "id")) delete data.id;
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
        toast({
          variant: "success",
          message: `Successfully exported ${selectedAlertsToExport.length} alert${selectedAlertsToExport.length > 1 ? "s" : ""}`,
        });
        selectedAlerts.value = [];
        allSelectedAlerts.value = false;
      } catch (error) {
        console.error("Error exporting alerts:", error);
        toast({
          variant: "error",
          message: "Error exporting alerts. Please try again.",
        });
      }
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
          const value = typeof item.value === "string" ? `'${item.value}'` : item.value;
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
      const dismiss = toast({
        variant: "loading",
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
          toast({
            variant: "error",
            message: `No alerts to ${action}`,
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
          toast({
            variant: "success",
            message: `Alerts ${action}d successfully`,
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
        toast({
          variant: "error",
          message: `Error ${action}ing alerts. Please try again.`,
        });
      }
    };

    const confirmBulkDelete = ref<boolean>(false);
    const bulkDeleteLoading = ref<boolean>(false);

    const openBulkDeleteDialog = () => {
      confirmBulkDelete.value = true;
    };

    const bulkDeleteAlerts = async () => {
      bulkDeleteLoading.value = true;
      const dismiss = toast({
        variant: "loading",
        message: "Deleting alerts...",
        timeout: 0,
      });

      try {
        if (selectedAlerts.value.length === 0) {
          toast({
            variant: "error",
            message: "No alerts selected for deletion",
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
            toast({
              variant: "warning",
              message: `${successCount} alert(s) deleted successfully, ${failCount} failed`,
              timeout: 5000,
            });
          } else if (failCount > 0) {
            // All failed
            toast({
              variant: "error",
              message: `Failed to delete ${failCount} alert(s)`,
            });
          } else {
            // All successful
            toast({
              variant: "success",
              message: `${successCount} alert(s) deleted successfully`,
            });
          }
        } else {
          // Fallback success message
          toast({
            variant: "success",
            message: `${selectedAlerts.value.length} alert(s) deleted successfully`,
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
          toast({
            variant: "error",
            message: errorMessage,
          });
        }
      } finally {
        bulkDeleteLoading.value = false;
      }

      confirmBulkDelete.value = false;
    };

    // ── Keyboard shortcuts ──────────────────────────────────────────────
    useShortcuts([
      {
        id: "alertsCreate",
        handler: () => {
          if (isInputFocused()) return;
          // Mirror the Add button so the URL updates (action=add / route push),
          // otherwise "go back"/discard can't return to the list.
          if (!destinations.value.length || !templates.value.length) return;
          if (activeTab.value === "anomalyDetection") {
            router.push({
              name: "addAnomalyDetection",
              query: {
                org_identifier: store.state.selectedOrganization.identifier,
                folder: activeFolderId.value,
                tab: activeTab.value,
              },
            });
          } else {
            showAddUpdateFn({});
          }
        },
      },
      {
        id: "alertsImport",
        handler: () => {
          if (isInputFocused()) return;
          importAlert();
        },
      },
      {
        id: "alertsRefresh",
        handler: () => {
          if (isInputFocused()) return;
          refreshAlerts();
        },
      },
      {
        id: "alertsFocusSearch",
        handler: () => {
          focusSearchInput("alert-list-search-input");
        },
      },
    ]);

    return {
      t,
      store,
      router,
      columns,
      recencyLevel,
      alertRowClass,
      alertRowStyle,
      typeIconName,
      typeIconClass,
      stateVariant,
      stateIconName,
      stateLabel,
      stateCounts,
      summaryStats,
      stateFilter,
      displayedAlerts,
      onStatSelect,
      formData,
      hideForm,
      confirmDelete,
      selectedDelete,
      updateStreams,
      updateStreamName,
      resultTotal,
      refreshList,
      pageSize,
      pageSizeOptions,
      addAlert,
      isUpdated,
      showAddUpdateFn,
      showDeleteDialogFn,
      duplicateAlert,
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
      loading,
      isSubmitting,
      filterQuery,
      getImageURL,
      activeTab,
      destinations,
      verifyOrganizationStatus,
      folders,
      splitterModel,
      alertStateLoadingMap,
      toggleAlertState,
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
      selectedAlertIds,
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
      bulkDeleteLoading,
      config,
      isCompactToolbar,
      isAnomalyDetectionEnabled,
      refreshAlerts,
    };
  },
});
</script>
