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
  <div :key="store.state.selectedOrganization.identifier" class="h-full">
    <div
      ref="fullscreenDiv"
      :class="[
        {
          fullscreen: isFullscreen,
          'print-mode-container': store.state.printMode,
        },
        isFullscreen ? 'bg-surface-base!' : '',
        store.state.printMode === true ? 'pb-6' : '',
        kioskMode && !kioskPointerActive ? 'cursor-none [&_*]:cursor-none!' : '',
      ]"
      class="h-full"
      :data-kiosk="kioskMode ? 'true' : undefined"
    >
      <OPageLayout
        bleed
        :main-panel="false"
        :header-class="
          kioskMode
            ? 'hidden'
            : isFullscreen || store.state.printMode === true
              ? 'stickyHeader fullscreenHeader bg-surface-panel'
              : 'shrink-0'
        "
        :subtitle="folderNameFromFolderId"
        :icon="!isFullscreen && store.state.printMode !== true ? undefined : 'dashboard'"
        :back="
          !isFullscreen && store.state.printMode !== true
            ? {
                label: t('dashboard.header'),
                onClick: goBackToDashboardList,
                dataTest: 'dashboard-back-btn',
              }
            : undefined
        "
      >
        <template #title>
          <span data-test="dashboard-name-title">{{ currentDashboardData.data?.title }}</span>
          <OBadge
            v-if="isEditingLayout"
            variant="primary-soft"
            size="sm"
            icon="edit"
            class="ms-2 align-middle"
            data-test="dashboard-edit-badge"
            >{{ t("dashboard.layoutEdit.editing") }}</OBadge
          >
        </template>
        <template #actions>
          <!-- Add panel is the most-used action, so it leads the toolbar. -->
          <OButton
            v-if="!isFullscreen && !isEditingLayout"
            v-show="store.state.printMode !== true"
            variant="outline"
            size="icon-toolbar"
            @click="addPanelData"
            data-test="dashboard-panel-add"
            icon-left="add"
            :aria-label="hasNewPanelDraft ? t('dashboard.panelDraft.addPanelDot') : t('panel.add')"
          >
            <OTooltip
              :content="hasNewPanelDraft ? t('dashboard.panelDraft.addPanelDot') : t('panel.add')"
              shortcut-id="dashboardAddPanel"
            />
            <!-- A button's children are presentational, so the draft state is also in the button's own name. -->
            <span
              v-if="hasNewPanelDraft"
              role="img"
              :aria-label="t('dashboard.panelDraft.addPanelDot')"
              class="bg-button-pending-bg ring-button-pending-bg/30 pointer-events-none absolute -end-1 -top-1 size-2.5 rounded-full ring-4"
              data-test="dashboard-panel-add-draft-dot"
            />
          </OButton>
          <!-- <DateTimePicker 
            class="ms-2"
            ref="refDateTime"
            v-model="selectedDate"
            /> -->
          <!-- for Print Mode -->
          <!-- if time is relative, show start and end time -->
          <!-- format: YYYY/MM/DD HH:mm - YYYY/MM/DD HH:mm (TIMEZONE) -->
          <div
            class="pt-1.25"
            v-if="
              store.state.printMode === true && currentTimeObj.start_time && currentTimeObj.end_time
            "
          >
            {{ timeString }} ({{ store.state.timezone }})
          </div>
          <!-- do not show date time picker for print mode -->
          <DateTimePickerDashboard
            v-if="selectedDate"
            v-show="store.state.printMode === false"
            ref="dateTimePicker"
            class="dashboard-icons h-7.5 [transition:all_0.2s_ease] max-md:[&_.date-time-label]:hidden"
            size="sm"
            :modelValue="pickedDate ?? selectedDate"
            :auto-apply-dashboard="true"
            :initialTimezone="initialTimezone"
            :disable="arePanelsLoading"
            @update:modelValue="timeGate.onPick"
            @show="timeGate.onShow"
            @hide="onTimePickerHide"
            @timezone-change="timeGate.flush"
            data-test="dashboard-global-date-time-picker"
          />
          <!-- Kiosk keeps this mounted on every width: it owns the refresh value and its URL sync. -->
          <AutoRefreshInterval
            v-if="!isMobile || kioskMode"
            v-model="refreshInterval"
            trigger
            :min-refresh-interval="store.state?.zoConfig?.min_auto_refresh_interval || 5"
            @trigger="onAutoRefreshTick"
            class="dashboard-icons hideOnPrintMode h-7.5 [transition:all_0.2s_ease]"
            size="sm"
          />
          <OButtonGroup v-show="store.state.printMode !== true">
            <!-- Wrapper mode: a child-mode tooltip would hover-bind only the icon, not the labelled button. -->
            <OTooltip
              v-if="config.isEnterprise == 'true' && arePanelsLoading"
              :content="t('panel.cancel')"
              :disabled="!isMobile"
            >
              <OButton
                variant="cancel-query"
                :size="isMobile ? 'icon-toolbar' : 'sm-toolbar'"
                @click="cancelQuery"
                :aria-label="t('panel.cancel')"
                data-test="dashboard-cancel-btn"
                :icon-left="isMobile ? 'cancel' : undefined"
              >
                <!-- Both labels share one grid cell: Cancel keeps the Refresh width and still fits a longer translation. -->
                <span v-if="!isMobile" class="grid items-center justify-items-center">
                  <span
                    class="invisible col-start-1 row-start-1 flex items-center gap-1.5"
                    aria-hidden="true"
                  >
                    <OIcon name="refresh" size="sm" />{{ t("dashboard.viewDashboard.refresh") }}
                  </span>
                  <span class="col-start-1 row-start-1">{{ t("panel.cancel") }}</span>
                </span>
              </OButton>
            </OTooltip>
            <OTooltip v-else :content="refreshTooltip" shortcut-id="dashboardRefresh">
              <OButton
                :variant="refreshVariant"
                :size="isMobile ? 'icon-toolbar' : 'sm-toolbar'"
                @click="refreshData()"
                :disabled="arePanelsLoading"
                :loading="arePanelsLoading"
                :aria-label="t('dashboard.viewDashboard.refresh')"
                data-test="dashboard-refresh-btn"
                :icon-left="isAutoRunOn ? 'autorenew' : 'refresh'"
              >
                <template v-if="!isMobile">{{ t("dashboard.viewDashboard.refresh") }}</template>
              </OButton>
            </OTooltip>
            <ODropdown align="end" side="bottom">
              <template #trigger>
                <OButton
                  :variant="refreshOptionsVariant"
                  size="icon-toolbar"
                  class="w-5"
                  :aria-label="t('dashboard.viewDashboard.moreRefreshOptions')"
                  data-test="dashboard-refresh-options-btn"
                  icon-left="arrow-drop-down"
                />
              </template>
              <ODropdownItem
                data-test="dashboard-refresh-without-cache-btn"
                icon-left="cached"
                :disabled="arePanelsLoading"
                @select="refreshData(true)"
              >
                {{ t("dashboard.viewDashboard.refreshCacheReload") }}
              </ODropdownItem>
              <template v-if="isAutoRunAvailable">
                <ODropdownSeparator />
                <ODropdownItem data-test="dashboard-auto-run-toggle-btn" @select="toggleAutoRun">
                  <template #icon-left>
                    <OIcon
                      :name="isAutoRunOn ? 'autorenew' : 'sync-disabled'"
                      size="sm"
                      :class="isAutoRunOn ? 'text-accent' : ''"
                    />
                  </template>
                  <span>
                    <div class="font-medium">
                      {{ isAutoRunOn ? t("search.turnOffLiveMode") : t("search.turnOnLiveMode") }}
                    </div>
                    <div class="text-text-secondary text-xs">
                      {{ t("dashboard.viewDashboard.autoRunDescription") }}
                    </div>
                    <div class="text-text-secondary text-xs" data-test="dashboard-auto-run-scope">
                      {{ t("dashboard.viewDashboard.autoRunScope") }}
                    </div>
                  </span>
                </ODropdownItem>
              </template>
            </ODropdown>
          </OButtonGroup>
          <OButton
            v-if="!isFullscreen && !isEditingLayout"
            v-show="store.state.printMode !== true"
            variant="outline"
            :size="isMobile ? 'icon-toolbar' : 'sm-toolbar'"
            icon-left="edit"
            :aria-label="t('dashboard.layoutEdit.enter')"
            data-test="dashboard-edit-btn"
            @click="enterLayoutEdit"
          >
            <template v-if="!isMobile">{{ t("dashboard.layoutEdit.edit") }}</template>
            <OTooltip :content="t('dashboard.layoutEdit.enter')" />
          </OButton>
          <template v-if="isEditingLayout">
            <div v-if="!isMobile" class="flex h-5 items-stretch">
              <OSeparator vertical />
            </div>
            <template v-if="!isMobile">
              <OButton
                variant="outline"
                size="icon-toolbar"
                icon-left="undo"
                :disabled="!canUndoLayout || isSavingLayout"
                :aria-label="t('dashboard.layoutEdit.undo')"
                data-test="dashboard-edit-undo-btn"
                @click="undoLayout"
              >
                <OTooltip
                  :content="t('dashboard.layoutEdit.undo')"
                  shortcut-id="dashboardLayoutUndo"
                />
              </OButton>
              <OButton
                variant="outline"
                size="icon-toolbar"
                icon-left="redo"
                :disabled="!canRedoLayout || isSavingLayout"
                :aria-label="t('dashboard.layoutEdit.redo')"
                data-test="dashboard-edit-redo-btn"
                @click="redoLayout"
              >
                <OTooltip
                  :content="t('dashboard.layoutEdit.redo')"
                  shortcut-id="dashboardLayoutRedo"
                />
              </OButton>
              <span
                class="text-text-secondary text-xs whitespace-nowrap"
                aria-live="polite"
                data-test="dashboard-edit-changes-count"
                >{{
                  t("dashboard.layoutEdit.changes", { count: layoutChangeCount }, layoutChangeCount)
                }}</span
              >
              <OButton
                variant="ghost"
                size="sm-toolbar"
                icon-left="close"
                :disabled="isSavingLayout"
                data-test="dashboard-edit-discard-btn"
                @click="requestExitLayoutEdit"
              >
                {{ t("dashboard.layoutEdit.discard") }}
                <OTooltip
                  :content="t('dashboard.layoutEdit.discardTooltip')"
                  shortcut-id="dashboardLayoutExit"
                />
              </OButton>
            </template>
            <OButton
              variant="primary"
              size="sm-toolbar"
              icon-left="check"
              :disabled="layoutChangeCount === 0"
              :loading="isSavingLayout"
              data-test="dashboard-edit-save-btn"
              @click="saveLayout"
            >
              {{ t("dashboard.layoutEdit.save") }}
              <OTooltip
                :content="t('dashboard.layoutEdit.saveTooltip')"
                shortcut-id="dashboardSave"
              />
            </OButton>
          </template>
        </template>

        <template #actions-overflow>
          <AutoRefreshInterval
            v-if="isMobile && !kioskMode"
            v-model="refreshInterval"
            trigger
            :min-refresh-interval="store.state?.zoConfig?.min_auto_refresh_interval || 5"
            @trigger="onAutoRefreshTick"
            class="dashboard-icons hideOnPrintMode h-7.5 [transition:all_0.2s_ease]"
            size="sm"
          />
          <!-- These save, print or reload outside the draft, so edit mode hides them until Save or Discard. -->
          <template v-if="!isEditingLayout">
            <ExportDashboard
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              :dashboardId="currentDashboardData.data?.dashboardId"
            />
            <ShareButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              :url="dashboardShareURL"
              @copy:success="onDashboardShared"
              variant="outline"
              size="icon-toolbar"
              data-test="dashboard-share-btn"
            />
            <OButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-toolbar"
              data-test="dashboard-setting-btn"
              @click="openSettingsDialog"
              icon-left="settings"
            >
              <OTooltip :content="t('dashboard.setting')" />
            </OButton>
            <OButton
              variant="outline"
              size="icon-toolbar"
              @click="printDashboard"
              data-test="dashboard-print-btn"
            >
              <template #icon-left
                ><OIcon :name="store.state.printMode === true ? 'close' : 'print'" size="sm"
              /></template>
              <OTooltip
                :content="store.state.printMode === true ? t('common.close') : t('dashboard.print')"
              />
            </OButton>
            <OButton
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-toolbar"
              @click="toggleFullscreen"
              data-test="dashboard-fullscreen-btn"
            >
              <template #icon-left
                ><OIcon :name="isFullscreen ? 'fullscreen-exit' : 'fullscreen'" size="sm"
              /></template>
              <OTooltip
                :content="isFullscreen ? t('dashboard.exitFullscreen') : t('dashboard.fullscreen')"
                shortcut-id="dashboardFullscreen"
              />
            </OButton>
            <KioskSetupPopover
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              :current-refresh-seconds="refreshInterval"
              :min-refresh-seconds="store.state?.zoConfig?.min_auto_refresh_interval || 5"
              @open="enterKiosk"
            />
            <OButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-toolbar"
              @click="openScheduledReports"
              data-test="view-dashboard-scheduled-reports"
            >
              <template #icon-left><OIcon name="description" size="sm" /></template>
              <OTooltip :content="t('dashboard.scheduledDashboards')" />
            </OButton>
            <OButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              variant="outline"
              size="icon-toolbar"
              data-test="dashboard-json-edit-btn"
              @click="openJsonEditor"
              icon-left="code"
            >
              <OTooltip :content="t('dashboard.editJson')" />
            </OButton>
            <!-- Pin as org-wide home dashboard: a low-frequency, set-once
                   action, so it sits at the far right, icon-only. Filled pin +
                   highlighted variant signal the "already home" state. -->
            <OButton
              v-if="!isFullscreen"
              v-show="store.state.printMode !== true"
              :variant="isHome(dashboardId) ? 'secondary' : 'outline'"
              size="icon-toolbar"
              :class="isHome(dashboardId) ? 'text-primary border-button-outline-border border' : ''"
              @click="toggleHomeDashboard"
              data-test="dashboard-view-set-home-btn"
              :icon-left="isHome(dashboardId) ? 'keep' : 'keep-outline'"
            >
              <OTooltip
                :content="
                  isHome(dashboardId) ? t('dashboard.removeFromHome') : t('dashboard.setAsHomeDesc')
                "
              />
            </OButton>
          </template>
          <template v-if="isEditingLayout && isMobile">
            <OButton
              variant="outline"
              size="icon-toolbar"
              icon-left="undo"
              :disabled="!canUndoLayout || isSavingLayout"
              :aria-label="t('dashboard.layoutEdit.undo')"
              data-test="dashboard-edit-undo-btn"
              @click="undoLayout"
            >
              <OTooltip :content="t('dashboard.layoutEdit.undo')" />
            </OButton>
            <OButton
              variant="outline"
              size="icon-toolbar"
              icon-left="redo"
              :disabled="!canRedoLayout || isSavingLayout"
              :aria-label="t('dashboard.layoutEdit.redo')"
              data-test="dashboard-edit-redo-btn"
              @click="redoLayout"
            >
              <OTooltip :content="t('dashboard.layoutEdit.redo')" />
            </OButton>
            <OButton
              variant="ghost"
              size="sm-toolbar"
              icon-left="close"
              :disabled="isSavingLayout"
              data-test="dashboard-edit-discard-btn"
              @click="requestExitLayoutEdit"
            >
              {{ t("dashboard.layoutEdit.discard") }}
            </OButton>
          </template>
        </template>

        <KioskStrip
          v-if="kioskMode && !playlistEmbed"
          :title="currentDashboardData.data?.title"
          :position="playlistPosition"
          :time-range-label="kioskTimeRange"
          :refresh-seconds="refreshInterval"
          :health="kioskHealth"
          :last-success-at="kioskLastSuccessAt"
          :timezone="store.state.timezone"
          :loading="arePanelsLoading"
          :countdown="kioskCountdown"
          @exit="exitKiosk"
        />
        <div v-if="playlistHolding" class="fixed inset-0 z-50">
          <PlaylistHoldingCard
            :label="playlistHolding.label"
            :title="playlistHolding.title"
            :note="playlistHolding.note"
          />
        </div>
        <OBanner
          v-if="hasUnsavedConflict"
          variant="warning"
          icon="warning"
          dense
          inline-actions
          class="mx-page-edge mt-2 shrink-0"
          data-test="dashboard-unsaved-conflict-banner"
        >
          {{
            saveConflictState.myChange
              ? t("dashboard.saveConflict.notSavedChange", { change: saveConflictState.myChange })
              : t("dashboard.saveConflict.notSaved")
          }}
          <template #actions>
            <OButton
              variant="outline"
              size="sm"
              data-test="dashboard-unsaved-conflict-resolve"
              @click="resolveSaveConflict"
            >
              {{ t("dashboard.saveConflict.resolve") }}
            </OButton>
          </template>
        </OBanner>

        <RenderDashboardCharts
          :frame="false"
          :class="store.state.printMode ? '' : 'min-h-0 flex-1'"
          :key="currentDashboardData.data?.dashboardId + '-' + dashboardRemountKey"
          v-if="selectedDate"
          ref="renderDashboardChartsRef"
          @variablesData="variablesDataUpdated"
          @refreshedVariablesDataUpdated="refreshedVariablesDataUpdated"
          @variablesManagerReady="onVariablesManagerReady"
          :initialVariableValues="initialVariableValues"
          :viewOnly="store.state.printMode || kioskMode"
          :kiosk="kioskMode"
          :readOnlySelectors="playlistEmbed || playlistPageActive"
          :fitToScreen="kioskMode && kioskFit"
          :layoutMode="layoutMode"
          @layoutChange="onLayoutChange"
          :dashboardData="currentDashboardData.data"
          :folderId="route.query.folder"
          :reportId="reportId"
          :currentTimeObj="currentTimeObjPerPanel"
          :shouldRefreshWithoutCacheObj="shouldRefreshWithoutCachePerPanel"
          :dashboardName="currentDashboardData.data?.title"
          :folderName="folderNameFromFolderId"
          :selectedDateForViewPanel="selectedDate"
          :allowAlertCreation="true"
          @onDeletePanel="onDeletePanel"
          @onMovePanel="onMovePanel"
          @updated:data-zoom="onDataZoom"
          @refresh="loadDashboard"
          @refreshPanelRequest="refreshPanelRequest"
          @openEditLayout="openLayoutConfig"
          :showTabs="true"
          :forceLoad="store.state.printMode"
          :searchType="searchType"
          :showLegendsButton="true"
          @panelsValues="handleEmittedData"
          @searchRequestTraceIds="searchRequestTraceIds"
          :runId="runId"
          @update:runId="updateRunId"
          @send-to-ai-chat="(value, append) => $emit('sendToAiChat', value, append)"
        />
        <DashboardSettings
          v-model:open="showDashboardSettingsDialog"
          @refresh="loadDashboard"
          @close="showDashboardSettingsDialog = false"
        />

        <PanelLayoutSettings
          v-if="selectedPanelConfig.data"
          v-model:open="selectedPanelConfig.show"
          :layout="selectedPanelConfig.data.layout"
          @save:layout="savePanelLayout"
          @close="selectedPanelConfig.show = false"
        />

        <ScheduledDashboards
          v-model:open="showScheduledReportsDialog"
          :reports="scheduledReports"
          :loading="isLoadingReports"
          :folderId="folderId"
          :dashboardId="dashboardId"
          :tabId="tabId"
          :tabs="currentDashboardData?.data?.tabs || []"
        />

        <DashboardJsonEditor
          v-model:open="showJsonEditorDialog"
          :dashboard-data="currentDashboardData.data"
          :save-json-dashboard="saveJsonDashboard"
        />

        <ODialog
          :open="discardDialog.open"
          size="sm"
          :title="t('dashboard.layoutEdit.discardTitle')"
          :secondary-button-label="
            discardDialog.reason === 'leave'
              ? t('dashboard.layoutEdit.stay')
              : t('dashboard.layoutEdit.keepEditing')
          "
          :primary-button-label="
            discardDialog.reason === 'leave'
              ? t('dashboard.layoutEdit.discardAndLeave')
              : t('dashboard.layoutEdit.discard')
          "
          primary-button-variant="destructive"
          initial-focus="secondary"
          data-test="dashboard-edit-discard-dialog"
          @update:open="(open) => !open && settleDiscard(false)"
          @click:secondary="settleDiscard(false)"
          @click:primary="settleDiscard(true)"
        >
          {{
            discardDialog.reason === "leave"
              ? t(
                  "dashboard.layoutEdit.leaveMessage",
                  { count: layoutChangeCount },
                  layoutChangeCount,
                )
              : t(
                  "dashboard.layoutEdit.discardMessage",
                  { count: layoutChangeCount },
                  layoutChangeCount,
                )
          }}
        </ODialog>
      </OPageLayout>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  watch,
  nextTick,
  provide,
  defineAsyncComponent,
  reactive,
  onMounted,
  onUnmounted,
  onBeforeMount,
  computed,
} from "vue";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import ShareButton from "@/components/common/ShareButton.vue";
import analytics from "@/services/product_analytics";
import DateTimePickerDashboard from "@/components/DateTimePickerDashboard.vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from "vue-router";
import { getDashboard, movePanelToAnotherTab, getFoldersList } from "../../utils/commons.ts";
import { parseDuration, generateDurationLabel } from "../../utils/date";
import { useRoute } from "vue-router";
import { useListBackNavigation } from "@/composables/useListBackNavigation";
import { deletePanel } from "../../utils/commons";
import {
  getPanelTimeFromURL,
  convertPanelTimeRangeToPicker,
} from "@/utils/dashboard/panelTimeUtils";
import AutoRefreshInterval from "@/components/AutoRefreshInterval.vue";
import ExportDashboard from "@/components/dashboards/ExportDashboard.vue";
import RenderDashboardCharts from "./RenderDashboardCharts.vue";
import useNotifications from "@/composables/useNotifications";
import {
  onDashboardConflictResolved,
  useDashboardSaveConflict,
  useDashboardSaveConflictDialog,
} from "@/composables/dashboard/useDashboardSaveConflict";
import { dashboardSaveConflictState } from "@/composables/dashboard/dashboardSaveConflictState";
import { DASHBOARD_FRESH_PANEL_TIME } from "@/composables/dashboard/dashboardFreshPanelTime";
import { useHomeDashboard } from "@/composables/useHomeDashboard";
import reports from "@/services/reports";
import config from "@/aws-exports";
import useCancelQuery from "@/composables/dashboard/useCancelQuery";
import { useAutoRunToggle } from "@/composables/dashboard/useAutoRunToggle";
import { useDashboardTimeGate } from "@/composables/dashboard/useDashboardTimeGate";
import {
  createDashboardFreshOnOpen,
  DASHBOARD_FRESH_ON_OPEN,
} from "@/composables/dashboard/dashboardFreshOnOpen";
import PanelLayoutSettings from "./PanelLayoutSettings.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import { useLayoutEditDraft } from "@/composables/dashboard/useLayoutEditDraft";
import { hasPanelDraft } from "@/composables/dashboard/usePanelDraft";
import { useLoading } from "@/composables/useLoading";
import { isEqual } from "lodash-es";
import { panelIdToBeRefreshed } from "@/utils/dashboard/convertCustomChartData";
import { getUUID } from "@/utils/zincutils";
import { createDashboardsContextProvider, contextRegistry } from "@/composables/contextProviders";
import {
  arePickerValuesEqual,
  hasPanelTime,
  isEffectivePanelTimeRelative,
  pickerValueToTimeObj,
  queryChangeAffectsPanelTimes,
  toPickerSavedDate,
} from "@/utils/dashboard/panelTimeUtils";
import { useAiDashboardEvents } from "@/composables/useAiDashboardEvents";
import type { AiDashboardEvent } from "@/composables/useAiDashboardEvents";
import {
  getManager,
  getShortcutDef,
  resolveShortcutKeys,
  useShortcuts,
} from "@/lib/vue-shortcut-manager";
import { isInputFocused, isMacOS } from "@/utils/keyboardShortcuts";
import useBreakpoint from "@/composables/useBreakpoint";
import { queryClient } from "@/composables/query/queryClient";
import { annotationKeys } from "@/services/dashboard_annotations.querykeys";
import KioskStrip from "@/components/dashboards/kiosk/KioskStrip.vue";
import KioskSetupPopover from "@/components/dashboards/kiosk/KioskSetupPopover.vue";
import { KIOSK_PANEL_HEALTH_KEY, useKioskRefresh } from "@/composables/dashboard/useKioskRefresh";
import {
  applyKioskTheme,
  clearKioskTheme,
  useIdleReveal,
} from "@/composables/dashboard/useKioskDisplay";
import {
  buildKioskQuery,
  formatRelativePeriod,
  isFitEnabled,
  isKioskEnabled,
  parseKioskTheme,
  pickKioskParams,
  resolveKioskRefresh,
  stripKioskParams,
} from "@/utils/dashboard/kiosk";
import {
  PLAYLIST_VIEW_PATH,
  isPlaylistEmbed,
  isPlaylistPage,
  missingReasonFor,
  parsePlaylistMisses,
  parsePlaylistQuery,
  pickPlaylistParams,
  stripPlaylistParams,
} from "@/utils/dashboard/playlist";
import { usePlaylistFrame, usePlaylistPage } from "@/composables/dashboard/usePlaylistFrame";
import PlaylistHoldingCard from "@/components/dashboards/kiosk/PlaylistHoldingCard.vue";
import { pingBackend } from "@/services/health";
import { raw } from "@/types/i18n";

const DashboardJsonEditor = defineAsyncComponent(() => {
  return import("./DashboardJsonEditor.vue");
});

const DashboardSettings = defineAsyncComponent(() => {
  return import("./DashboardSettings.vue");
});

const ScheduledDashboards = defineAsyncComponent(() => {
  return import("./ScheduledDashboards.vue");
});

export default defineComponent({
  name: "ViewDashboard",
  emits: ["onDeletePanel", "sendToAiChat"],
  components: {
    OBanner,
    OPageLayout,
    DateTimePickerDashboard,
    ShareButton,
    AutoRefreshInterval,
    ExportDashboard,
    DashboardSettings,
    RenderDashboardCharts,
    ScheduledDashboards,
    PanelLayoutSettings,
    DashboardJsonEditor,
    OButton,
    OButtonGroup,
    ODropdown,
    ODropdownItem,
    ODropdownSeparator,
    OIcon,
    OTooltip,
    OBadge,
    OSeparator,
    ODialog,
    KioskStrip,
    KioskSetupPopover,
    PlaylistHoldingCard,
  },
  setup() {
    const { t } = useI18nTyped();
    const { isMobile } = useBreakpoint();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const currentDashboardData = reactive({
      data: {},
    });
    const showScheduledReportsDialog = ref(false);

    // Set before the first render so a reloaded TV never flashes the app chrome.
    if (isKioskEnabled(route.query.kiosk) && !store.state.kioskMode) {
      store.dispatch("setKioskMode", true);
    }
    const kioskMode = computed(() => store.state.kioskMode === true);
    const kioskFit = computed(() => isFitEnabled(route.query.fit));
    const { active: kioskPointerActive } = useIdleReveal(kioskMode);

    // One slide of a TV playlist: inside the player's frame, or a full page when framing is blocked.
    const playlistEmbed =
      isKioskEnabled(route.query.kiosk) &&
      isPlaylistEmbed(route.query) &&
      typeof window !== "undefined" &&
      window.parent !== window;
    const playlistPageConfig =
      isKioskEnabled(route.query.kiosk) && !playlistEmbed && isPlaylistPage(route.query)
        ? parsePlaylistQuery(route.query)
        : null;
    // Filled in once the kiosk health exists; a playlist slide never falls back to the dashboard list.
    const playlistReporters = {
      missing: (_reason: "notFound" | "forbidden") => false,
      error: () => false,
    };

    const { showPositiveNotification, showErrorNotification } = useNotifications();
    const saveConflict = useDashboardSaveConflict();

    // Variables manager will be initialized by RenderDashboardCharts
    // and we'll receive a reference to it via the @variablesManagerReady event
    const variablesManager = ref(null);

    let moment: any = () => {};

    const folderNameFromFolderId = computed(() => {
      if (store.state.organizationData.folders.length === 0) {
        return "";
      }
      return (
        store.state.organizationData.folders.find(
          (item: any) => item.folderId === (route.query.folder ?? "default"),
        )?.name ?? "default"
      );
    });

    const importMoment = async () => {
      const momentModule: any = await import("moment-timezone");
      moment = momentModule.default;
    };

    const scheduledReports = ref([]);
    const isLoadingReports = ref(false);

    const dashboardId = computed(() => route.query.dashboard);

    const folderId = computed(() => route.query.folder);

    // Set/remove this dashboard as the single org-wide home dashboard, shared
    // reactive state with the dashboard list and HomeView via the composable.
    const { isHome, setHomeDashboard, clearHomeDashboard } = useHomeDashboard(t);
    const toggleHomeDashboard = () => {
      const id = dashboardId.value as string | undefined;
      if (!id) return;
      const org = store.state.selectedOrganization?.identifier;
      if (isHome(id)) {
        clearHomeDashboard(org);
      } else {
        setHomeDashboard(org, {
          dashboardId: id,
          folderId: (folderId.value as string) ?? "default",
          label: currentDashboardData.data?.title ?? t("dashboard.viewDashboard.dashboard"),
        });
      }
    };

    const tabId = computed(() => route.query.tab);

    const reportId = computed(() => route.query.tab);

    const renderDashboardChartsRef = ref(null);

    // Initialize dashboard run ID management
    const runId = ref(getUUID().replace(/-/g, ""));

    const generateNewDashboardRunId = () => {
      runId.value = getUUID().replace(/-/g, "");
      return runId.value;
    };

    onBeforeMount(async () => {
      await importMoment();
      setTimeString();
    });

    // [START] date picker related variables --------

    /**
     * Retrieves the selected date from the query parameters.
     */
    const getSelectedDateFromQueryParams = (params) => ({
      valueType: params.period ? "relative" : params.from && params.to ? "absolute" : "relative",
      startTime: params.from ? params.from : null,
      endTime: params.to ? params.to : null,
      relativeTimePeriod: params.period ? params.period : "15m",
    });

    // Everything that loads data reads this, never the live picker: a range still waiting must not reach a panel.
    const getAppliedGlobalTime = () => pickerValueToTimeObj(selectedDate.value);

    const setTimeForVariables = () => {
      const appliedTime = getAppliedGlobalTime();
      if (appliedTime && dateTimePicker.value) {
        // Update only the variables time object
        currentTimeObjPerPanel.value = {
          ...currentTimeObjPerPanel.value,
          __variables: appliedTime,
        };
      }
    };

    const dateTimePicker = ref(null); // holds a reference to the date time picker

    // The applied range: what panels, the URL and the Share link use. The picker's own value is `pickedDate`.
    const selectedDate = ref(null);

    // holds the current time for the dashboard
    const currentTimeObj = ref({});

    // refresh interval v-model
    const refreshInterval = ref(0);

    // initial timezone, which will come from the route query
    const initialTimezone = ref(route.query.timezone ?? null);

    // search_type for search query
    const searchType = ref(route.query.searchtype ?? null);

    // dispatch setPrintMode, to set print mode
    const setPrint = (printMode: any) => {
      store.dispatch("setPrintMode", printMode);
    };

    const timeString = ref("");

    const printDashboard = () => {
      // set print mode as true
      setPrint(store.state.printMode != true);

      const query = {
        ...route.query,
        print: store.state.printMode,
      };

      // replace query params with print=true
      router.replace({ query });
    };

    // boolean to show/hide settings sidebar
    const showDashboardSettingsDialog = ref(false);

    const selectedPanelConfig = ref({
      data: null,
      show: false,
    });

    // selected tab
    const selectedTabId: any = ref(route.query.tab ?? null);
    // provide it to child components
    provide("selectedTabId", selectedTabId);

    const { isAutoRunAvailable, isAutoRunOn, toggleAutoRun } = useAutoRunToggle();
    // A wall screen has no Refresh button to apply a variable change, so kiosk applies it live.
    const applyVariablesLive = computed(() => isAutoRunOn.value || kioskMode.value);
    provide("dashboardAutoRun", applyVariablesLive);

    const showRangeInPicker = (value: any) =>
      dateTimePicker.value?.setSavedDate(toPickerSavedDate(value, store.state.timezone));

    const timeGate = useDashboardTimeGate({
      applied: selectedDate,
      isAutoRunOn: () => isAutoRunOn.value,
      showInPicker: showRangeInPicker,
    });

    const onTimePickerHide = () => {
      timeGate.onHide();
      setTimeForVariables();
    };

    const freshOnOpen = createDashboardFreshOnOpen({
      isAutoRunOn: () => isAutoRunOn.value,
      isRelativeRange: (panel) =>
        isEffectivePanelTimeRelative(panel, route.query, selectedDate.value),
    });
    provide(DASHBOARD_FRESH_ON_OPEN, freshOnOpen);
    // A cross-dashboard drilldown keeps this view mounted, so each dashboard it opens is a new visit.
    watch(
      () => route.query.dashboard,
      () => freshOnOpen.reset(),
    );

    // variables data
    const variablesData = reactive({});
    const refreshedVariablesData = reactive({}); // Flag to track if variables have changed

    const variablesDataUpdated = (data: any) => {
      // ONLY update the live variables data - DO NOT update URL
      // URL updates should happen ONLY after commitAll() is called (on refresh button click)
      Object.assign(variablesData, data);

      // URL sync happens in refreshData() after commitAll(), so the URL reflects
      // only COMMITTED variable values, not live changes
    };

    const refreshedVariablesDataUpdated = (variablesData: any) => {
      Object.assign(refreshedVariablesData, variablesData);
    };

    // Handler for when variables manager is ready from RenderDashboardCharts
    const onVariablesManagerReady = async (manager: any) => {
      variablesManager.value = manager;

      // Immediately update URL with initial committed values
      // This handles variables that don't require loading (constant, textbox, custom_value)
      await nextTick();
      if (selectedDate.value && variablesManager.value) {
        updateUrlWithCurrentState();
      }
    };

    // Watch for changes to committed variables data
    // This will trigger URL updates when variables finish loading (auto-commit for query_values)
    watch(
      () => {
        if (!variablesManager.value) return null;
        // Watch the committed variables data deeply
        return JSON.stringify(variablesManager.value.committedVariablesData);
      },
      async () => {
        // When committed variables change, update the URL
        // Skip during same-dashboard drilldown to avoid clobbering drilldown var-* params
        if (isDrilldownInProgress.value) return;
        await nextTick();
        if (selectedDate.value && variablesManager.value) {
          updateUrlWithCurrentState();
        }
      },
    );

    const isVariablesChanged = computed(() => {
      // If using variables manager, access hasUncommittedChanges directly from the manager
      // Explicitly dereference to ensure Vue tracks the dependency
      const manager = variablesManager.value;

      if (applyVariablesLive.value) return false;

      if (manager && "hasUncommittedChanges" in manager) {
        // Access the value (Vue auto-unwraps computed refs in composable returns)
        const hasChanges = manager.hasUncommittedChanges;
        return hasChanges;
      }
      // Legacy mode: Convert both objects to a consistent format for comparison
      const normalizeVariables = (obj) => {
        const normalized = JSON.parse(JSON.stringify(obj));
        // Sort arrays to ensure consistent ordering
        if (normalized.values) {
          normalized.values = normalized.values
            .map((variable) => {
              if (Array.isArray(variable.value)) {
                variable.value.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
              }
              return variable;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
        }
        return normalized;
      };

      const normalizedCurrent = normalizeVariables(variablesData);
      const normalizedRefreshed = normalizeVariables(refreshedVariablesData);

      return !isEqual(normalizedCurrent, normalizedRefreshed);
    });

    const isRefreshPending = computed(
      () => isVariablesChanged.value || timeGate.needsRefresh.value,
    );

    const refreshTooltip = computed(() => {
      if (isAutoRunOn.value) return t("dashboard.viewDashboard.autoRunDescription");
      if (timeGate.needsRefresh.value) {
        return isVariablesChanged.value
          ? t("dashboard.refreshToApplyTimeRangeAndVariables")
          : t("dashboard.refreshToApplyTimeRange");
      }
      return isVariablesChanged.value
        ? t("dashboard.viewDashboard.refreshToApplyVariables")
        : t("dashboard.viewDashboard.refresh");
    });
    // ======= [START] default variable values

    const initialVariableValues = reactive({
      value: {} as Record<string, any>,
    });
    Object.keys(route.query).forEach((key) => {
      if (key.startsWith("var-")) {
        const newKey = key.slice(4);
        initialVariableValues.value[newKey] = route.query[key];
      }
    });
    // ======= [END] default variable values

    onMounted(async () => {
      await loadDashboard();
      // Caught: a folder-list failure must not abort the panel setup below.
      await getFoldersList(store).catch(() => null);

      // Set up dashboard context provider
      const dashboardProvider = createDashboardsContextProvider(
        route,
        store,
        undefined,
        false,
        currentDashboardData,
      );
      contextRegistry.register("dashboards", dashboardProvider);
      contextRegistry.setActive("dashboards");

      // Compute panel times after dashboard loads
      // Wait for next tick to ensure dateTimePicker is initialized
      await nextTick();
      if (dateTimePicker.value) {
        computeAllPanelTimes();
      }
    });

    const setTimeString = () => {
      if (!moment()) return;
      timeString.value = ` ${moment(currentTimeObj.value?.start_time?.getTime() / 1000)
        .tz(store.state.timezone)
        .format("YYYY/MM/DD HH:mm")}
              -
               ${moment(currentTimeObj.value?.end_time?.getTime() / 1000)
                 .tz(store.state.timezone)
                 .format("YYYY/MM/DD HH:mm")}

                  `;
    };

    // Guard flag: true while a cross-dashboard load is in progress.
    // Prevents updateUrlWithCurrentState() from overwriting the incoming tab ID.
    const isDashboardLoading = ref(false);

    // Guard flag: true while a same-dashboard drilldown is being processed.
    // Prevents updateUrlWithCurrentState() from clobbering drilldown var-* params
    // with stale committed variable values before the manager has been updated.
    const isDrilldownInProgress = ref(false);

    // Guard flag: true while updateUrlWithCurrentState is updating the URL.
    // Prevents the var-* watcher from re-triggering when the app itself syncs
    // variable params to the URL (e.g., after a normal dropdown change).
    const isInternalUrlUpdate = ref(false);

    const loadDashboard = async (onlyIfRequired = false) => {
      // check if drilldown or soft-refresh request
      if (onlyIfRequired) {
        // if current dashboard id and tab is same,  skip loading
        if (
          currentDashboardData?.data?.dashboardId === route.query.dashboard &&
          // check for tab
          selectedTabId.value === route.query.tab
        ) {
          // Even for same dashboard+tab, check if var-* params changed
          // This handles same-dashboard drilldown where variables are passed via URL
          const urlVarParams: Record<string, any> = {};
          Object.keys(route.query).forEach((key) => {
            if (key.startsWith("var-")) {
              urlVarParams[key.slice(4)] = route.query[key];
            }
          });

          const currentVarParams: Record<string, any> = {};
          Object.keys(initialVariableValues.value).forEach((name) => {
            currentVarParams[name] = initialVariableValues.value[name];
          });

          const sortedStringify = (obj: Record<string, any>) =>
            JSON.stringify(Object.fromEntries(Object.entries(obj).sort()));
          const hasVarChanges = sortedStringify(urlVarParams) !== sortedStringify(currentVarParams);

          if (!hasVarChanges) {
            return; // Truly nothing changed
          }
          // Fall through — variable values changed, need to re-apply
        }
      }

      let dashboard;
      try {
        dashboard = await getDashboard(
          store,
          route.query.dashboard,
          route.query.folder ?? "default",
        );

        if (!dashboard || typeof dashboard !== "object" || !Object.keys(dashboard).length) {
          if (playlistReporters.missing("notFound")) return;
          showErrorNotification(t("dashboard.viewDashboard.dashboardNotFound"));
          goBackToDashboardList();
          return;
        }
      } catch (error: any) {
        const missingReason = missingReasonFor(error?.response?.status);
        if (missingReason ? playlistReporters.missing(missingReason) : playlistReporters.error()) {
          return;
        }
        showErrorNotification(error?.message || t("dashboard.viewDashboard.failedToLoadDashboard"));
        goBackToDashboardList();
        return;
      }

      // Set the dashboard data - RenderDashboardCharts will initialize the variables manager
      currentDashboardData.data = dashboard;

      // set selected tab from query params
      const selectedTab = dashboard?.tabs?.find((tab: any) => tab.tabId === route.query.tab);

      selectedTabId.value = selectedTab ? selectedTab.tabId : dashboard?.tabs?.[0]?.tabId;

      // if variables data is null, set it to empty list
      if (!(dashboard?.variables && dashboard?.variables?.list.length)) {
        variablesData.isVariablesLoading = false;
        variablesData.values = [];
        refreshedVariablesData.isVariablesLoading = false;
        refreshedVariablesData.values = [];
      }

      const previousAppliedDate = selectedDate.value;

      // check if route has time related query params
      // if not, take dashboard default time settings
      if (!((route.query.from && route.query.to) || route.query.period)) {
        // if dashboard has relative time settings
        if (
          (currentDashboardData.data?.defaultDatetimeDuration?.type ?? "relative") === "relative"
        ) {
          selectedDate.value = {
            valueType: "relative",
            relativeTimePeriod:
              currentDashboardData.data?.defaultDatetimeDuration?.relativeTimePeriod ?? "15m",
          };
        } else {
          // else, dashboard will have absolute time settings
          selectedDate.value = {
            valueType: "absolute",
            startTime: currentDashboardData.data?.defaultDatetimeDuration?.startTime,
            endTime: currentDashboardData.data?.defaultDatetimeDuration?.endTime,
          };
        }
      } else {
        // take route time related query params
        selectedDate.value = getSelectedDateFromQueryParams(route.query);
      }

      if (previousAppliedDate && !arePickerValuesEqual(previousAppliedDate, selectedDate.value)) {
        showAppliedDateInPicker();
      }
    };

    // The mounted picker reads its v-model only once, so a range applied by another dashboard's URL is pushed in.
    const showAppliedDateInPicker = () => {
      if (!dateTimePicker.value || !selectedDate.value) return;

      timeGate.adopt();
      showRangeInPicker(selectedDate.value);
    };

    // [START] cancel running queries

    const arePanelsLoading = ref(false);

    const handleEmittedData = (allPanelsLoaded) => {
      arePanelsLoading.value = !allPanelsLoaded;
    };

    const { traceIdRef, searchRequestTraceIds, cancelQuery } = useCancelQuery(t);

    // [END] cancel running queries

    const openSettingsDialog = () => {
      showDashboardSettingsDialog.value = true;
    };

    const openLayoutConfig = (id: string) => {
      selectedPanelConfig.value.show = true;

      const panelData = getPanelFromTab(selectedTabId.value, id);

      if (!panelData) {
        return;
      }

      selectedPanelConfig.value.data = JSON.parse(JSON.stringify(panelData));
    };

    // The layout dialog only exists in edit mode, so its result is one draft step, never a save.
    const savePanelLayout = async (layout) => {
      const panel = getPanelFromTab(selectedTabId.value, selectedPanelConfig.value.data?.id);

      selectedPanelConfig.value.show = false;
      selectedPanelConfig.value.data = null;

      if (!panel || !layout || !isEditingLayout.value) return;
      panel.layout = layout;

      await nextTick();
      renderDashboardChartsRef.value?.syncGridToLayout?.();
      layoutDraft.record();
    };

    const layoutDraft = useLayoutEditDraft(() => currentDashboardData.data, {
      onApply: () => renderDashboardChartsRef.value?.syncGridToLayout?.(),
    });
    const isEditingLayout = layoutDraft.isEditing;
    const layoutChangeCount = layoutDraft.changeCount;
    const canUndoLayout = layoutDraft.canUndo;
    const canRedoLayout = layoutDraft.canRedo;
    const layoutMode = computed(() => (isEditingLayout.value ? "edit" : "view"));
    const isSavingLayout = ref(false);

    const enterLayoutEdit = () => {
      if (store.state.printMode || kioskMode.value) return;
      layoutDraft.start();
    };

    const onLayoutChange = () => {
      layoutDraft.record();
    };

    const undoLayout = () => {
      if (!isSavingLayout.value) layoutDraft.undo();
    };

    const redoLayout = () => {
      if (!isSavingLayout.value) layoutDraft.redo();
    };

    // The page keeps my unsaved edit on screen, so it must say it is not saved until the conflict is resolved.
    const hasUnsavedConflict = computed(
      () =>
        !!dashboardSaveConflictState.unresolvedDashboardId &&
        dashboardSaveConflictState.unresolvedDashboardId === String(route.query.dashboard),
    );
    const { reopen: reopenSaveConflict, reload: reloadSaveConflict } =
      useDashboardSaveConflictDialog();
    // Set when the edit-mode Save lost a conflict, so Discard can resolve that conflict too.
    let layoutSaveConflicted = false;

    const saveLayout = async () => {
      if (!layoutDraft.isDirty.value || isSavingLayout.value) return;
      isSavingLayout.value = true;
      try {
        // saveDashboardData owns the toast and the 409 path; a failed save keeps the draft.
        const saved = await renderDashboardChartsRef.value?.saveDashboardData?.execute?.();
        if (saved) layoutDraft.finish();
        else if (hasUnsavedConflict.value) layoutSaveConflicted = true;
      } finally {
        isSavingLayout.value = false;
      }
    };

    const discardDialog = reactive({ open: false, reason: "exit" as "exit" | "leave" });
    let resolveDiscard: ((confirmed: boolean) => void) | null = null;

    const confirmDiscard = (reason: "exit" | "leave") =>
      new Promise<boolean>((resolve) => {
        resolveDiscard?.(false);
        resolveDiscard = resolve;
        discardDialog.reason = reason;
        discardDialog.open = true;
      });

    const settleDiscard = (confirmed: boolean) => {
      discardDialog.open = false;
      const resolve = resolveDiscard;
      resolveDiscard = null;
      resolve?.(confirmed);
    };

    const requestExitLayoutEdit = async () => {
      if (!isEditingLayout.value || isSavingLayout.value) return;
      if (layoutDraft.isDirty.value && !(await confirmDiscard("exit"))) return;
      layoutDraft.discard();
      // Discarding the layout that lost a save conflict is the conflict's Reload: show the latest and drop the not-saved banner.
      if (layoutSaveConflicted && hasUnsavedConflict.value) await reloadSaveConflict();
      layoutSaveConflicted = false;
    };

    // Esc belongs to an open dialog or menu first; the layout only hears it when nothing else would.
    const onLayoutEscape = () => {
      if (!isEditingLayout.value || discardDialog.open) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"]')) return;
      requestExitLayoutEdit();
    };

    // A dashboard-scoped Esc shadows the global one that closes the AI chat, so it exists only while editing.
    let layoutEscapeId: string | undefined;
    const toggleLayoutEscape = (editing: boolean) => {
      const manager = getManager();
      if (layoutEscapeId) manager?.unregisterById(layoutEscapeId);
      layoutEscapeId = undefined;
      const def = getShortcutDef("dashboardLayoutExit");
      const key = def && resolveShortcutKeys(def, isMacOS())[0];
      if (!editing || !manager || !def || !key) return;
      layoutEscapeId = manager.register({
        id: def.id,
        key,
        scope: def.scope,
        handler: onLayoutEscape,
      });
    };
    watch(isEditingLayout, toggleLayoutEscape, { flush: "sync" });

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!layoutDraft.isDirty.value) return;
      event.preventDefault();
      event.returnValue = "";
    };

    // A reload or drilldown swaps the dashboard object, which the draft no longer describes.
    watch(
      () => currentDashboardData.data,
      (_next, previous) => {
        if (isEditingLayout.value) layoutDraft.discard(previous);
      },
    );

    // ===== Panel Time Configuration =====

    // Compute effective time for a specific panel
    // Priority: 1. URL params (highest) → 2. panel_time_range → 3. global time AS-IS
    const computePanelTime = (panel: any, globalTime: any) => {
      if (!panel) return globalTime;

      // Priority 1: Check URL params for this panel (highest priority)
      // URL params always win, even if panel_time_range is null
      const urlPanelTime = getPanelTimeFromURL(panel.id, route.query);
      if (urlPanelTime) {
        return pickerValueToTimeObj(urlPanelTime);
      }

      // Priority 2: Use panel's configured time range (if set)
      if (panel.config?.panel_time_range) {
        const pickerValue = convertPanelTimeRangeToPicker(panel.config.panel_time_range);
        if (pickerValue) {
          return pickerValueToTimeObj(pickerValue);
        }
      }

      // Priority 3: No custom time → use global time AS-IS (no conversion)
      return globalTime;
    };

    // Compute time for a single specific panel (for panel-level refresh)
    const computeSinglePanelTime = (panelId: string) => {
      if (!currentDashboardData.data?.tabs || !dateTimePicker.value) {
        return;
      }

      // Find the panel across all tabs
      let targetPanel: any = null;
      for (const tab of currentDashboardData.data.tabs) {
        const found = tab.panels?.find((p: any) => p.id === panelId);
        if (found) {
          targetPanel = found;
          break;
        }
      }

      const globalTime = getAppliedGlobalTime();
      if (!targetPanel || !globalTime) {
        return;
      }

      // Check if panel has its own time configuration
      if (hasPanelTime(targetPanel)) {
        // Panel has panel-level time - only update this specific panel's time
        // DO NOT update __global to avoid triggering refreshes in other panels
        const effectiveTime = computePanelTime(targetPanel, globalTime);
        if (effectiveTime) {
          // CRITICAL: Update only this panel's time property, don't replace entire object
          currentTimeObjPerPanel.value[panelId] = effectiveTime;
        }
      } else {
        // Panel depends on global time
        // Create a panel-specific time entry (even though it normally uses __global)
        // This allows refreshing ONLY this panel without affecting other global-dependent panels
        // CRITICAL: Update only this panel's time property, don't replace entire object
        currentTimeObjPerPanel.value[panelId] = globalTime;
      }
    };

    provide(DASHBOARD_FRESH_PANEL_TIME, (panelId) => {
      if (!applyVariablesLive.value) return undefined;
      const panel = currentDashboardData.data?.tabs
        ?.flatMap((tab: any) => tab.panels ?? [])
        .find((p: any) => p.id === panelId);
      const globalTime = panel && getAppliedGlobalTime();
      if (!globalTime) return undefined;
      return hasPanelTime(panel) ? computePanelTime(panel, globalTime) : globalTime;
    });

    // Helper: Check if two time objects are equal
    const areTimesEqual = (time1: any, time2: any) => {
      if (!time1 || !time2) return false;
      return (
        time1.start_time?.getTime() === time2.start_time?.getTime() &&
        time1.end_time?.getTime() === time2.end_time?.getTime()
      );
    };

    const spanOf = (time: any) =>
      time?.start_time && time?.end_time
        ? time.end_time.getTime() - time.start_time.getTime()
        : null;

    // Compute times for all panels in all tabs
    // @param forceRefresh - If true, always create new time objects to force all panels to refresh
    const computeAllPanelTimes = (forceRefresh = false) => {
      const globalTime = getAppliedGlobalTime();
      if (!currentDashboardData.data?.tabs || !dateTimePicker.value || !globalTime) {
        return;
      }

      // A non-forced recompute must not advance a relative range: its resolved now drifts a few hundred ms between calls during load, refiring every global panel's time watcher (cache paint → spurious refetch).
      const existingGlobalTime = currentTimeObjPerPanel.value.__global;
      const isRelativeGlobal = selectedDate.value?.valueType === "relative";
      const globalTimeChanged = isRelativeGlobal
        ? spanOf(existingGlobalTime) !== spanOf(globalTime)
        : !areTimesEqual(existingGlobalTime, globalTime);
      const shouldUpdateGlobal = forceRefresh || !existingGlobalTime || globalTimeChanged;

      // Build the new panel times object
      const newPanelTimes: Record<string, any> = {
        __global: shouldUpdateGlobal ? globalTime : existingGlobalTime,
      };

      // For panels with panel-level time, compute and compare with existing
      currentDashboardData.data.tabs.forEach((tab: any) => {
        tab.panels?.forEach((panel: any) => {
          if (panel.id) {
            // Check if panel has its own time configuration
            if (hasPanelTime(panel)) {
              // Panel has its own time → compute it
              const effectiveTime = computePanelTime(panel, globalTime);
              if (effectiveTime) {
                if (forceRefresh) {
                  // Force refresh: always use new time object to trigger reactivity
                  newPanelTimes[panel.id] = effectiveTime;
                } else {
                  // Smart update: only update if the time has actually changed
                  const existingTime = currentTimeObjPerPanel.value[panel.id];
                  if (!areTimesEqual(existingTime, effectiveTime)) {
                    newPanelTimes[panel.id] = effectiveTime;
                  } else {
                    // Preserve the existing time object reference to avoid triggering reactivity
                    newPanelTimes[panel.id] = existingTime;
                  }
                }
              }
            }
            // If panel doesn't have panel-level time, it will use __global (don't add to object)
          }
        });
      });

      // CRITICAL: Update individual properties instead of replacing the entire object
      // This prevents triggering reactivity for panels whose time hasn't changed
      // Remove keys that no longer exist
      Object.keys(currentTimeObjPerPanel.value).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(newPanelTimes, key)) {
          delete currentTimeObjPerPanel.value[key];
        }
      });
      // Update or add keys
      Object.keys(newPanelTimes).forEach((key) => {
        if (currentTimeObjPerPanel.value[key] !== newPanelTimes[key]) {
          currentTimeObjPerPanel.value[key] = newPanelTimes[key];
        }
      });
    };

    // when the applied range changes, update the current time object for the dashboard
    watch(selectedDate, async () => {
      const appliedTime = getAppliedGlobalTime();
      if (appliedTime && dateTimePicker.value) {
        // CRITICAL: Clear panelIdToBeRefreshed to ensure all panels refresh
        // When global date time changes, all panels should update
        panelIdToBeRefreshed.value = null;

        currentTimeObj.value = appliedTime;

        // DON'T reset currentTimeObjPerPanel here - let computeAllPanelTimes() handle it
        // This prevents losing panel-specific times during the update

        // Compute panel-specific times with forceRefresh=true
        // This ensures all panels refresh when global date time changes
        computeAllPanelTimes(true);

        setTimeString();

        // Ensure all updates are settled before updating URL
        await nextTick();

        // Update URL to reflect the new global date time
        // This ensures URL stays in sync when user changes the date picker
        updateUrlWithCurrentState();
      }
    });

    // Watch for URL query changes to handle panel time updates
    watch(
      () => route.query,
      (newQuery, oldQuery) => {
        // An applied variable rewrites var-* here; recomputing would re-run every relative panel-time panel.
        if (queryChangeAffectsPanelTimes(newQuery, oldQuery)) {
          computeAllPanelTimes();
        }
      },
      { deep: true },
    );

    // Sync selectedTabId from URL changes (handles back/forward navigation and drilldown)
    watch(
      () => route.query.tab,
      (newTabId) => {
        if (newTabId && newTabId !== selectedTabId.value) {
          selectedTabId.value = newTabId;
          // Variable re-reading is handled by the var-* watcher below
        }
      },
    );

    // Watch for cross-dashboard navigation (e.g. drilldown to a different dashboard)
    watch(
      () => route.query.dashboard,
      async (newDashboardId, oldDashboardId) => {
        // Skip initial mount call (oldDashboardId is undefined on first run);
        // loadDashboard() is already called during onMounted setup.
        if (!oldDashboardId) return;
        if (newDashboardId && newDashboardId !== oldDashboardId) {
          isDashboardLoading.value = true;
          try {
            await loadDashboard();
          } finally {
            isDashboardLoading.value = false;
          }
        }
      },
    );

    // Watch for var-* query param changes (handles same-dashboard drilldown)
    // When a drilldown targets the same dashboard, only var-* params change in the URL.
    // This watcher detects that and re-reads variable values from the URL.
    watch(
      () => {
        const varParams: Record<string, any> = {};
        Object.keys(route.query).forEach((key) => {
          if (key.startsWith("var-")) {
            varParams[key] = route.query[key];
          }
        });
        return JSON.stringify(varParams);
      },
      async (newVarParamsStr, oldVarParamsStr) => {
        if (newVarParamsStr === oldVarParamsStr) {
          return;
        }
        // Skip during cross-dashboard navigation (loadDashboard handles it)
        if (isDashboardLoading.value) {
          return;
        }

        // Skip if this URL change was caused by updateUrlWithCurrentState (app-initiated sync)
        // This prevents redundant loadFromUrl+commitAll when user changes a variable via dropdown
        if (isInternalUrlUpdate.value) {
          return;
        }

        // Set drilldown guard to prevent updateUrlWithCurrentState from clobbering
        // the new var-* params before the manager processes them
        try {
          isDrilldownInProgress.value = true;

          // Re-read variable values from URL into initialVariableValues
          const newInitialVars: Record<string, any> = {};
          Object.keys(route.query).forEach((key) => {
            if (key.startsWith("var-")) {
              const newKey = key.slice(4);
              newInitialVars[newKey] = route.query[key];
            }
          });

          // Update initialVariableValues prop
          initialVariableValues.value = newInitialVars;

          // Directly call updateInitialVariableValues on RenderDashboardCharts
          // The emit chain from usePanelDrilldown doesn't reliably reach RenderDashboardCharts,
          // so we call the exposed method directly via the component ref
          if (renderDashboardChartsRef.value?.updateInitialVariableValues) {
            await renderDashboardChartsRef.value.updateInitialVariableValues();
          }

          // Clear the drilldown guard after reactivity settles
          await nextTick();
          await nextTick();

          // Now sync the full URL state (adds back from/to, refresh, print, etc.)
          // The drilldown's router.push may not include all params (e.g. when passAllVariables is false),
          // so we need updateUrlWithCurrentState to fill in the missing ones.
          // Only runs if updateInitialVariableValues() succeeded — avoids writing stale state on error.
          updateUrlWithCurrentState();
        } finally {
          isDrilldownInProgress.value = false;
        }
      },
    );

    const getPanelFromTab = (tabId: string, panelId: string) => {
      const tab = currentDashboardData.data.tabs.find((tab) => tab.tabId === tabId);

      if (!tab || !tab.panels) {
        return null;
      }

      return tab.panels.find((panel) => panel.id === panelId);
    };

    const getQueryParamsForDuration = (data: any) => {
      if (!data) {
        return {};
      }

      // Primary check: use valueType if available
      if (data.valueType === "relative" && data.relativeTimePeriod) {
        return {
          period: data.relativeTimePeriod,
        };
      } else if (data.valueType === "absolute" && data.startTime && data.endTime) {
        return {
          from: data.startTime,
          to: data.endTime,
        };
      }

      // Fallback for backward compatibility (when valueType is missing)
      if (data.relativeTimePeriod) {
        return {
          period: data.relativeTimePeriod,
        };
      } else if (data.startTime && data.endTime) {
        return {
          from: data.startTime,
          to: data.endTime,
        };
      }

      return {};
    };

    // [END] date picker related variables

    // Fallback-only: a dashboard opened from the Favorites pseudo-folder carries the folder it lives in, so rebuilding from route.query.folder here (rather than Favorites) is only reached when there's no real history to go back to.
    const goBackToDashboardList = useListBackNavigation({
      // The Infrastructure pages push into a dashboard the same way the listing does, so back belongs there rather than on a listing the user never saw.
      isListPath: (path) =>
        path === "/dashboards" || path.endsWith("/dashboards") || path.startsWith("/infra/"),
      fallback: () => ({
        path: "/dashboards",
        query: {
          folder: route.query.folder ?? "default",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      }),
    });

    const hasNewPanelDraft = computed(() =>
      hasPanelDraft({
        userEmail: String(store.state.userInfo?.email ?? ""),
        org: String(store.state.selectedOrganization?.identifier ?? ""),
        dashboardId: String(route.query.dashboard ?? ""),
      }),
    );

    //add panel
    const addPanelData = () => {
      return router.push({
        path: "/dashboards/add_panel",
        query: {
          ...route.query,
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
          tab: route.query.tab ?? currentDashboardData?.data?.tabs?.[0]?.tabId,
        },
      });
    };

    // Refresh is the dashboard's main action, but in layout edit Save owns the primary slot.
    const refreshVariant = computed(() => {
      if (isRefreshPending.value) return "pending";
      return isEditingLayout.value ? "outline" : "primary";
    });

    const refreshOptionsVariant = computed(() => {
      if (config.isEnterprise == "true" && arePanelsLoading.value) return "cancel-query";
      return refreshVariant.value;
    });

    const refreshData = async (withoutCache = false) => {
      if (!arePanelsLoading.value) await runRefresh(withoutCache);
    };

    const runRefresh = async (withoutCache = false) => {
      // CRITICAL FIX: Clear panelIdToBeRefreshed for global refresh
      // This allows all panels to refresh, not just the one previously refreshed
      panelIdToBeRefreshed.value = null;

      // A global refresh overrides every per-panel choice; panels read the flag when their query fires.
      shouldRefreshWithoutCachePerPanel.value = { __global: withoutCache === true };

      // Annotations added elsewhere never expire this tab's cache, and a fixed range keeps the same key.
      if (dashboardId.value) {
        void queryClient.invalidateQueries({
          queryKey: annotationKeys.dashboard(
            store.state.selectedOrganization.identifier,
            String(dashboardId.value),
          ),
          refetchType: "none",
        });
      }

      // Generate new run ID for whole dashboard refresh
      generateNewDashboardRunId();

      // Sync panel-level datetime pickers FIRST (updates URL)
      await renderDashboardChartsRef.value?.syncAllPanelDateTimePickers();

      // Applied before the recompute below, which reads the applied range and not the picker.
      timeGate.refresh();

      // Recompute all panel times after syncing
      // Pass forceRefresh=true to ensure ALL panels refresh (create new time objects)
      computeAllPanelTimes(true);

      // Commit all live variable changes to committed state
      renderDashboardChartsRef.value?.commitAllVariables();
    };

    // Kiosk runs its own watchdog ticker, so the toolbar timer only drives the normal view.
    const onAutoRefreshTick = () => {
      if (!kioskMode.value) refreshData();
    };

    const kioskRefresh = useKioskRefresh({
      enabled: kioskMode,
      intervalSeconds: refreshInterval,
      isLoading: arePanelsLoading,
      // The first cycle can fire before the picker exists, while the dashboard definition still loads.
      refresh: () => (dateTimePicker.value ? runRefresh() : undefined),
      cancel: () => cancelQuery(),
      probe: pingBackend,
    });
    provide(KIOSK_PANEL_HEALTH_KEY, kioskRefresh.registry);

    const playlistFrame = usePlaylistFrame(playlistEmbed, {
      title: computed(() => currentDashboardData.data?.title),
      health: kioskRefresh.health,
      failingCount: kioskRefresh.failingCount,
      lastSuccessAt: kioskRefresh.lastSuccessAt,
    });
    const playlistPage = usePlaylistPage({
      enabled: !!playlistPageConfig,
      config: playlistPageConfig,
      misses: parsePlaylistMisses(route.query),
      ready: computed(
        () =>
          kioskRefresh.lastSuccessAt.value !== null || kioskRefresh.health.value.level === "bad",
      ),
      outage: computed(() => kioskRefresh.health.value.level === "bad"),
      resolveHref: (query) =>
        window.location.origin + router.resolve({ path: PLAYLIST_VIEW_PATH, query }).href,
    });
    playlistReporters.missing = (reason) => {
      if (!playlistEmbed) return playlistPage.reportMissing(reason);
      playlistFrame.reportMissing(reason);
      return true;
    };
    playlistReporters.error = () => {
      if (!playlistEmbed) return playlistPage.reportError();
      playlistFrame.reportError();
      return true;
    };
    const playlistPosition = computed(() =>
      playlistPage.active
        ? t("dashboard.playlist.position", {
            current: playlistPage.position.value.index + 1,
            total: playlistPage.position.value.count,
          })
        : null,
    );
    const playlistHolding = computed(() => {
      if (!playlistPage.active) return null;
      const { index, count } = playlistPage.position.value;
      const waiting =
        playlistPage.missing.value !== null ||
        playlistPage.leaving.value ||
        (kioskRefresh.lastSuccessAt.value === null && kioskRefresh.health.value.level !== "bad");
      if (!waiting) return null;
      const name = currentDashboardData.data?.title
        ? raw(currentDashboardData.data.title)
        : t("dashboard.playlist.slideName", { number: index + 1 });
      const missing = playlistPage.missing.value;
      return {
        label: t("dashboard.playlist.loadingSlide", { current: index + 1, total: count }),
        title: currentDashboardData.data?.title ?? null,
        note: missing
          ? missing === "forbidden"
            ? t("dashboard.playlist.skippedForbidden", { name })
            : t("dashboard.playlist.skippedNotFound", { name })
          : null,
      };
    });

    const onDataZoom = (event: any) => {
      const selectedDateObj = {
        start: new Date(event.start),
        end: new Date(event.end),
      };
      // Truncate seconds and milliseconds from the dates
      selectedDateObj.start.setMilliseconds(0);
      selectedDateObj.end.setMilliseconds(0);

      // Compare the truncated dates
      if (selectedDateObj.start.getTime() === selectedDateObj.end.getTime()) {
        // Increment the end date by 1 minute
        selectedDateObj.end.setMinutes(selectedDateObj.end.getMinutes() + 1);
      }

      // set it as a absolute time
      dateTimePicker?.value?.setCustomDate("absolute", selectedDateObj);

      // The picker reports the zoomed range here; a zoom applies at once even while Auto Run is off.
      dateTimePicker.value.refresh();
      timeGate.refresh();
    };

    // ------- work with query params ----------
    onMounted(async () => {
      const params = route.query;

      if (params.refresh && kioskMode.value) {
        // A TV must keep refreshing: a too-low value is raised to the server minimum, not turned off.
        refreshInterval.value = resolveKioskRefresh(
          params.refresh,
          store.state?.zoConfig?.min_auto_refresh_interval,
        );
      } else if (params.refresh) {
        const refreshInSecs = parseDuration(params.refresh);
        if (store.state?.zoConfig?.min_auto_refresh_interval) {
          if (refreshInSecs < store.state?.zoConfig?.min_auto_refresh_interval) {
            refreshInterval.value = 0;
          } else {
            refreshInterval.value = refreshInSecs;
          }
        }
      }

      // check if timezone query params exist
      // will be used for initial time zone only, so remove it from query
      if (params.timezone && !kioskMode.value) {
        // get the query params
        const query = {
          ...route.query,
        };

        // remove timezone from query
        delete query.timezone;

        // replace route with query params
        router.replace({
          query,
        });
      }

      if (kioskMode.value) {
        setPrint(false);
        applyKioskTheme(store, parseKioskTheme(route.query.theme));
      } else if (params.print !== undefined) {
        // set print mode
        setPrint(params.print == "true" ? true : false);
      } else {
        // set print mode as false which is default in store
        router.replace({
          query: {
            ...route.query,
            print: store.state.printMode,
          },
        });
      }
      // This is removed due to the bug of the new date time component
      // and is now rendered when the setup method is called
      // instead of onActivated
      // if (params.period || (params.to && params.from)) {
      //   selectedDate.value = getSelectedDateFromQueryParams(params);
      // }

      // resize charts if needed
      await nextTick();
      window.dispatchEvent(new Event("resize"));
    });

    // Get current variable params from manager (uses new centralized getUrlParams method)
    const getVariableParamsFromManager = (): Record<string, any> => {
      if (renderDashboardChartsRef.value?.getUrlParams) {
        return renderDashboardChartsRef.value.getUrlParams({ useLive: false });
      }
      return {};
    };

    // Helper function to update URL with current state
    const updateUrlWithCurrentState = () => {
      isInternalUrlUpdate.value = true;
      try {
        // Build variable params - prefer manager if available, otherwise use route.query
        let variableParams: Record<string, any> = {};

        if (variablesManager.value) {
          // Get from manager
          variableParams = getVariableParamsFromManager();

          // If manager returns empty but route.query has variables, use route.query
          // This handles the case where page just loaded and manager hasn't committed yet
          if (Object.keys(variableParams).length === 0) {
            Object.keys(route.query).forEach((key) => {
              if (key.startsWith("var-")) {
                variableParams[key] = route.query[key];
              }
            });
          }
        } else {
          // No manager, use route.query
          Object.keys(route.query).forEach((key) => {
            if (key.startsWith("var-")) {
              variableParams[key] = route.query[key];
            }
          });
        }

        // CRITICAL FIX: Generate panel time URL params for panels with panel_time_range
        // Only generate for the currently active tab to avoid polluting URL with inactive tabs
        const panelTimeParams: Record<string, any> = {};

        // Find the currently active tab and iterate through its panels only
        const activeTab = currentDashboardData?.data?.tabs?.find(
          (tab: any) => tab.tabId === selectedTabId.value,
        );
        if (currentDashboardData?.data?.tabs && selectedTabId.value) {
          if (activeTab?.panels) {
            activeTab.panels.forEach((panel: any) => {
              if (!panel.id) return;
              const panelId = panel.id;

              // Check if panel already has URL params (highest priority - preserve user changes)
              const hasExistingUrlParams = !!(
                route.query[`pt-period.${panelId}`] || route.query[`pt-from.${panelId}`]
              );

              if (hasExistingUrlParams) {
                // Preserve existing URL params (they may have been set by panel refresh)
                if (route.query[`pt-period.${panelId}`]) {
                  panelTimeParams[`pt-period.${panelId}`] = route.query[`pt-period.${panelId}`];
                }
                if (route.query[`pt-from.${panelId}`] && route.query[`pt-to.${panelId}`]) {
                  panelTimeParams[`pt-from.${panelId}`] = route.query[`pt-from.${panelId}`];
                  panelTimeParams[`pt-to.${panelId}`] = route.query[`pt-to.${panelId}`];
                }
              } else if (panel.config?.panel_time_range) {
                // Panel has an explicit custom time range configured (no URL params yet)
                const panelTimeRange = panel.config.panel_time_range;

                if (panelTimeRange.type === "relative" && panelTimeRange.relativeTimePeriod) {
                  panelTimeParams[`pt-period.${panelId}`] = panelTimeRange.relativeTimePeriod;
                } else if (
                  panelTimeRange.type === "absolute" &&
                  panelTimeRange.startTime &&
                  panelTimeRange.endTime
                ) {
                  panelTimeParams[`pt-from.${panelId}`] = panelTimeRange.startTime.toString();
                  panelTimeParams[`pt-to.${panelId}`] = panelTimeRange.endTime.toString();
                }
              } else if (panel.config?.panel_time_enabled) {
                // Panel has time picker enabled but no custom range → use global time (initial load only)
                const globalTimeParams = getQueryParamsForDuration(selectedDate.value);
                if (globalTimeParams.period) {
                  panelTimeParams[`pt-period.${panelId}`] = globalTimeParams.period;
                } else if (globalTimeParams.from && globalTimeParams.to) {
                  panelTimeParams[`pt-from.${panelId}`] = globalTimeParams.from.toString();
                  panelTimeParams[`pt-to.${panelId}`] = globalTimeParams.to.toString();
                }
              }
            });
          }
        }

        // Build set of existing panel IDs across ALL tabs (not just active tab)
        // This ensures we keep datetime params for panels in other tabs
        const existingPanelIds = new Set<string>();
        if (currentDashboardData.data?.tabs) {
          currentDashboardData.data.tabs.forEach((tab: any) => {
            if (tab.panels) {
              tab.panels.forEach((panel: any) => {
                if (panel.id) {
                  existingPanelIds.add(panel.id);
                }
              });
            }
          });
        }

        // Preserve only panel time params from URL for panels that still exist in ANY tab
        // This ensures deleted panel parameters are removed from the URL, but keeps params for other tabs
        Object.keys(route.query).forEach((key) => {
          if (key.startsWith("pt-")) {
            // Extract panel ID from parameter name (e.g., "pt-period.panel123" -> "panel123")
            const panelId = key.split(".").slice(1).join(".");

            // Only preserve if panel still exists in any tab of the dashboard
            if (panelId && existingPanelIds.has(panelId)) {
              panelTimeParams[key] = route.query[key];
            }
          }
        });

        // Get global time params - ensure we always have time params
        const timeParams = getQueryParamsForDuration(selectedDate.value);
        // Before the dashboard loads there is no picker value yet, so keep the range the link arrived with.
        if (!selectedDate.value) {
          if (route.query.period) timeParams.period = route.query.period;
          else if (route.query.from && route.query.to) {
            timeParams.from = route.query.from;
            timeParams.to = route.query.to;
          }
        }

        // Preserve the cell-explorer deep-link params so a shared "Copy link" reopens the drawer.
        const cellParams: Record<string, any> = {};
        for (const k of [
          "cell_panel",
          "cell_field",
          "cell_value",
          "cell_vtype",
          "cell_stream",
          "cell_stype",
          "cell_t0",
          "cell_t1",
          "cell_where",
          "cell_event_ts",
        ]) {
          if (route.query[k] !== undefined) cellParams[k] = route.query[k];
        }

        const newQuery = {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder,
          tab: selectedTabId.value,
          refresh: generateDurationLabel(refreshInterval.value),
          ...timeParams, // Global time params (period or from/to)
          ...variableParams, // Use variables from manager or route
          ...panelTimeParams, // Panel time params (generated + preserved)
          print: store.state.printMode,
          searchtype: route.query.searchtype,
          ...cellParams, // Keep cell-explorer deep link intact
          ...(kioskMode.value
            ? { ...pickKioskParams(route.query), ...pickPlaylistParams(route.query) }
            : {}),
        };

        // CRITICAL: Only update URL if query has actually changed
        // This prevents unnecessary route updates and panel recomputations
        const hasQueryChanged =
          Object.keys(newQuery).some((key) => newQuery[key] !== route.query[key]) ||
          Object.keys(route.query).some(
            (key) => !Object.prototype.hasOwnProperty.call(newQuery, key),
          );

        if (hasQueryChanged) {
          router.replace({ query: newQuery }).finally(() => {
            isInternalUrlUpdate.value = false;
          });
        } else {
          isInternalUrlUpdate.value = false;
        }
      } catch (e) {
        console.error(e);
        isInternalUrlUpdate.value = false;
      }
    };

    // whenever the refreshInterval or selectedTabId is changed, update the query params
    // Note: selectedDate changes are handled in the selectedDate watch above
    watch(
      [refreshInterval, selectedTabId],
      () => {
        if (isDashboardLoading.value) return; // skip during cross-dashboard navigation
        if (isDrilldownInProgress.value) return; // skip during same-dashboard drilldown
        generateNewDashboardRunId();
        updateUrlWithCurrentState();
      },
      { deep: true },
    );

    // Resolve only reopens the dialog: no save is attempted, and the dialog re-reads the working copy, so an edit-mode draft that moved on is what Overwrite saves.
    const resolveSaveConflict = () => reopenSaveConflict();

    onDashboardConflictResolved((dashboardId, outcome) => {
      if (dashboardId !== route.query.dashboard) return;
      layoutSaveConflicted = false;
      // Overwrite saved my layout, so edit mode ends as after a normal save; Reload drops the draft and its undo history.
      if (isEditingLayout.value) {
        if (outcome === "overwritten") layoutDraft.finish();
        else layoutDraft.discard();
      }
      loadDashboard();
    });

    // Read before the save helpers edit the cached dashboard in place.
    const panelTitleOf = (panelId: any) =>
      (currentDashboardData.data as any)?.tabs
        ?.flatMap((tab: any) => tab?.panels ?? [])
        .find((panel: any) => panel?.id === panelId)?.title ?? String(panelId);

    const onDeletePanel = async (panelId: any) => {
      const change = t("dashboard.saveConflict.change.deletedPanel", {
        name: panelTitleOf(panelId),
      });
      try {
        await deletePanel(
          store,
          route.query.dashboard,
          panelId,
          route.query.folder ?? "default",
          route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
        );
        await loadDashboard();

        showPositiveNotification(t("dashboard.viewDashboard.panelDeleted"), {
          timeout: 2000,
        });
      } catch (error: any) {
        if (saveConflict.isConflict(error)) {
          void saveConflict.openConflict({
            dashboardId: route.query.dashboard as string,
            folderId: (route.query.folder as string) ?? "default",
            change,
          });
        } else {
          showErrorNotification(
            error?.message ?? t("dashboard.viewDashboard.panelDeletionFailed"),
            {
              timeout: 2000,
            },
          );
        }
      }
    };

    // move single panel to another tab
    const onMovePanel = async (panelId: any, newTabId: any) => {
      const change = t("dashboard.saveConflict.change.movedPanel", { name: panelTitleOf(panelId) });
      try {
        await movePanelToAnotherTab(
          store,
          route.query.dashboard,
          panelId,
          route.query.folder ?? "default",
          route.query.tab ?? currentDashboardData.data.tabs[0].tabId,
          newTabId,
        );
        await loadDashboard();

        showPositiveNotification(t("dashboard.viewDashboard.panelMoved"), {
          timeout: 2000,
        });
      } catch (error: any) {
        if (saveConflict.isConflict(error)) {
          void saveConflict.openConflict({
            dashboardId: route.query.dashboard as string,
            folderId: (route.query.folder as string) ?? "default",
            change,
          });
        } else {
          showErrorNotification(error?.message ?? t("dashboard.viewDashboard.panelMoveFailed"), {
            timeout: 2000,
          });
        }
      }
    };

    const onDashboardShared = () => analytics.track("dashboard_shared");

    /**
     * Computed property for dashboard share URL
     * Converts relative time periods to absolute times for sharing
     */
    const dashboardShareURL = computed(() => {
      // Establish reactive dependency on route.fullPath to recompute when URL changes
      void route.fullPath;
      const urlObj = new URL(window.location.href);
      const urlSearchParams = urlObj?.searchParams;

      // if relative time period, convert to absolute time
      if (urlSearchParams?.has("period")) {
        urlSearchParams.delete("period");
        urlSearchParams.set("from", currentTimeObj?.value?.start_time?.getTime());
        urlSearchParams.set("to", currentTimeObj?.value?.end_time?.getTime());
      }

      return urlObj?.href;
    });

    // Fullscreen
    const fullscreenDiv = ref(null);
    const isFullscreen = ref(false);

    const toggleFullscreen = () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    };

    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        isFullscreen.value = false;
      }
    };

    // ===== Kiosk / TV mode =====
    const minRefreshSeconds = computed(() => store.state?.zoConfig?.min_auto_refresh_interval || 5);

    const kioskTimeRange = computed(() => {
      const relative =
        selectedDate.value?.valueType === "relative"
          ? formatRelativePeriod(selectedDate.value?.relativeTimePeriod, t)
          : null;
      if (relative) return relative;
      // Until the picker resolves the range, moment formats it as "Invalid date".
      const start = currentTimeObj.value?.start_time?.getTime?.();
      const end = currentTimeObj.value?.end_time?.getTime?.();
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        timeString.value.includes("Invalid")
      ) {
        return raw("");
      }
      return raw(timeString.value.replace(/\s+/g, " ").trim());
    });

    const leaveKioskState = () => {
      if (store.state.kioskMode) store.dispatch("setKioskMode", false);
      clearKioskTheme(store);
    };

    // Set only when TV mode was entered from the toolbar; a TV link opened directly has no prior view to restore.
    let refreshBeforeKiosk: number | null = null;
    const restoreRefreshBeforeKiosk = () => {
      if (refreshBeforeKiosk === null) return;
      refreshInterval.value = refreshBeforeKiosk;
      refreshBeforeKiosk = null;
    };

    const enterKiosk = async (options) => {
      if (isEditingLayout.value) return;
      const query = buildKioskQuery(route.query, options);
      setPrint(false);
      store.dispatch("setKioskMode", true);
      applyKioskTheme(store, parseKioskTheme(query.theme));
      refreshBeforeKiosk = refreshInterval.value;
      // Pushed, not replaced, so browser Back also leaves TV mode.
      await router.push({ query });
      // Only after the push: the interval watcher rewrites the URL and would otherwise cancel it.
      refreshInterval.value =
        options.refreshSeconds > 0 ? Math.max(options.refreshSeconds, minRefreshSeconds.value) : 0;
    };

    const exitKiosk = async () => {
      if (!kioskMode.value) return;
      leaveKioskState();
      const query = stripPlaylistParams(stripKioskParams(route.query));
      if (refreshBeforeKiosk !== null) query.refresh = generateDurationLabel(refreshBeforeKiosk);
      await router.replace({ query });
      // Only after the replace: the interval watcher rewrites the URL and would otherwise race it.
      restoreRefreshBeforeKiosk();
    };

    // Back/Forward across the kiosk entry flips the URL without going through enter/exit.
    watch(
      () => isKioskEnabled(route.query.kiosk),
      (enabled) => {
        if (enabled === kioskMode.value) return;
        if (enabled) {
          store.dispatch("setKioskMode", true);
          applyKioskTheme(store, parseKioskTheme(route.query.theme));
        } else {
          leaveKioskState();
          restoreRefreshBeforeKiosk();
        }
      },
    );

    const KIOSK_OPEN_POPUP = '[role="dialog"][data-state="open"], [role="menu"], [role="listbox"]';
    // Read before the popup's own Esc handler closes it, so that Esc only closes the variable dropdown.
    let escapeHitPopup = false;
    const onKioskEscapeCapture = (event: KeyboardEvent) => {
      if (event.key === "Escape") escapeHitPopup = !!document.querySelector(KIOSK_OPEN_POPUP);
    };

    const isTextEntry = (el: Element | null) =>
      !!el && (el.matches("input, textarea") || (el as HTMLElement).isContentEditable);

    const onKioskEscape = () => {
      if (!kioskMode.value) return;
      const hitPopup = escapeHitPopup || !!document.querySelector(KIOSK_OPEN_POPUP);
      escapeHitPopup = false;
      if (hitPopup || isTextEntry(document.activeElement)) return;
      exitKiosk();
    };

    // Registered only while in kiosk so it never shadows the global Esc that closes the AI chat.
    let kioskEscapeId: string | undefined;
    const toggleKioskEscape = (enabled: boolean) => {
      const manager = getManager();
      if (kioskEscapeId) manager?.unregisterById(kioskEscapeId);
      kioskEscapeId = undefined;
      window.removeEventListener("keydown", onKioskEscapeCapture, true);
      const def = getShortcutDef("dashboardKioskExit");
      const key = def && resolveShortcutKeys(def, isMacOS())[0];
      if (!enabled || !manager || !def || !key) return;
      window.addEventListener("keydown", onKioskEscapeCapture, true);
      kioskEscapeId = manager.register({
        id: def.id,
        key,
        scope: def.scope,
        // A focused select trigger counts as an input to the manager; onKioskEscape does its own text-entry check.
        allowInInput: true,
        handler: onKioskEscape,
      });
    };
    watch(kioskMode, toggleKioskEscape, { immediate: true, flush: "sync" });

    const openScheduledReports = () => {
      if (isLoadingReports.value) return;

      showScheduledReportsDialog.value = true;
      scheduledReports.value = [];
      isLoadingReports.value = true;

      // folder_id is intentionally omitted here: it filters by the REPORT's own
      // folder, not the dashboard's folder, so passing the dashboard folder id
      // would incorrectly exclude reports saved to a different report folder.
      reports
        .list(store.state.selectedOrganization.identifier, "", dashboardId.value)
        .then((response) => {
          scheduledReports.value = response.data;
        })
        .catch((error) => {
          showErrorNotification(
            error?.message || t("dashboard.viewDashboard.failedToFetchReports"),
          );
          isLoadingReports.value = false;
        })
        .finally(() => {
          isLoadingReports.value = false;
        });
    };

    // Cleanup references
    const cleanupRefs = () => {
      // Clear all component refs to prevent memory leaks
      if (dateTimePicker.value) {
        dateTimePicker.value = null;
      }
      if (renderDashboardChartsRef.value) {
        renderDashboardChartsRef.value = null;
      }
      if (fullscreenDiv.value) {
        fullscreenDiv.value = null;
      }
    };

    onMounted(() => {
      document.addEventListener("fullscreenchange", onFullscreenChange);
      window.addEventListener("beforeunload", onBeforeUnload);
    });

    // Force remount key — bumped on AI dashboard events to force RenderDashboardCharts to remount
    const dashboardRemountKey = ref(0);

    // Listen for AI assistant dashboard mutations to auto-refresh
    const { on: onDashboardEvent, off: offDashboardEvent } = useAiDashboardEvents();
    const handleAiDashboardEvent = async (event: AiDashboardEvent) => {
      const currentDashboardId = route.query.dashboard as string;
      const shouldReload = event.dashboardId === currentDashboardId;

      if (shouldReload && currentDashboardId) {
        // Clear cached dashboard data so getDashboard() fetches fresh from API
        delete store.state.organizationData.allDashboardData[currentDashboardId];
        await loadDashboard();
        // Bump key to force RenderDashboardCharts to fully remount with new data
        dashboardRemountKey.value++;
      }
    };
    onMounted(() => {
      onDashboardEvent(handleAiDashboardEvent);
    });

    onUnmounted(() => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      toggleLayoutEscape(false);
      toggleKioskEscape(false);
      leaveKioskState();

      // Clean up AI dashboard event listener
      offDashboardEvent(handleAiDashboardEvent);

      // Clean up dashboard context provider
      contextRegistry.unregister("dashboards");
      contextRegistry.setActive("");

      // Clear all refs
      cleanupRefs();
    });

    onMounted(() => {
      isFullscreen.value = false;
    });

    // printMode hides the app shell globally, so leaving by browser Back (not ✕) must still clear it.
    const clearPrintModeOnLeave = () => {
      if (store.state.printMode) setPrint(false);
      leaveKioskState();
    };

    // Unsaved layout edits are the store's cached dashboard object, so a confirmed leave must roll them back.
    onBeforeRouteLeave(() => {
      if (!layoutDraft.isDirty.value) {
        layoutDraft.finish();
        clearPrintModeOnLeave();
        return;
      }
      return confirmDiscard("leave").then((confirmed) => {
        if (!confirmed) return false;
        layoutDraft.discard();
        clearPrintModeOnLeave();
        return true;
      });
    });

    // Drilldown and Back/Forward to another dashboard reuse this page, so the leave guard never sees them.
    onBeforeRouteUpdate((to, from) => {
      if (to.query.dashboard === from.query.dashboard || !layoutDraft.isDirty.value) return;
      return confirmDiscard("leave").then((confirmed) => {
        if (!confirmed) return false;
        layoutDraft.discard();
        return true;
      });
    });

    const currentTimeObjPerPanel = ref({});
    const shouldRefreshWithoutCachePerPanel = ref({});

    const refreshPanelRequest = (panelId, shouldRefreshWithoutCache) => {
      // Set the panel ID to be refreshed
      panelIdToBeRefreshed.value = panelId;

      // Store the shouldRefreshWithoutCache value for this panel
      shouldRefreshWithoutCachePerPanel.value = {
        ...shouldRefreshWithoutCachePerPanel.value,
        [panelId]: shouldRefreshWithoutCache || false,
      };

      // Recompute time for this specific panel only
      computeSinglePanelTime(panelId);

      setTimeString();
    };

    const updateRunId = (newRunId) => {
      runId.value = newRunId;
    };

    // Add these new refs and methods
    const showJsonEditorDialog = ref(false);

    const openJsonEditor = () => {
      showJsonEditorDialog.value = true;
    };

    const saveJsonDashboard = useLoading(async (updatedJson: any) => {
      try {
        // Update the dashboard data
        currentDashboardData.data = JSON.parse(JSON.stringify(updatedJson));

        // Add a wait time for state update
        await nextTick();

        // Save changes using existing renderDashboardChartsRef
        if (renderDashboardChartsRef?.value?.saveDashboardData?.execute) {
          const saved = await renderDashboardChartsRef.value.saveDashboardData.execute(
            t("dashboard.saveConflict.change.editedJson"),
          );
          // A conflict opened the dialog with my JSON; reloading here would replace it on screen with the latest.
          if (!saved) return;

          // Reload the dashboard to reflect changes
          await loadDashboard();

          // The grid rebuilds only when panel ids change, so a layout-only JSON edit must move the widgets itself.
          await nextTick();
          renderDashboardChartsRef.value?.syncGridToLayout?.();
        } else {
          showErrorNotification(t("dashboard.viewDashboard.failedToUpdateJson"));
        }
      } catch (error) {
        showErrorNotification(error?.message || t("dashboard.viewDashboard.failedToSaveChanges"));
      } finally {
        showJsonEditorDialog.value = false;
      }
    });

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useShortcuts([
      {
        id: "dashboardRefresh",
        handler: () => {
          if (isInputFocused()) return;
          refreshData();
        },
      },
      {
        id: "dashboardAddPanel",
        handler: () => {
          if (isInputFocused() || isEditingLayout.value || kioskMode.value) return;
          addPanelData();
        },
      },
      {
        id: "dashboardSave",
        handler: () => {
          if (isInputFocused() || !isEditingLayout.value) return;
          saveLayout();
        },
      },
      {
        id: "dashboardLayoutUndo",
        handler: () => {
          if (isEditingLayout.value) undoLayout();
        },
      },
      {
        id: "dashboardLayoutRedo",
        handler: () => {
          if (isEditingLayout.value) redoLayout();
        },
      },
      {
        id: "dashboardFullscreen",
        handler: () => {
          if (isInputFocused() || isEditingLayout.value || kioskMode.value) return;
          toggleFullscreen();
        },
      },
      {
        id: "dashboardExport",
        handler: () => {
          if (isInputFocused() || kioskMode.value) return;
          // Trigger the whole-dashboard export (ExportDashboard button).
          (document.querySelector('[data-test="export-dashboard"]') as HTMLElement | null)?.click();
        },
      },
    ]);

    return {
      isMobile,
      currentDashboardData,
      dashboardRemountKey,
      toggleFullscreen,
      fullscreenDiv,
      isFullscreen,
      goBackToDashboardList,
      addPanelData,
      hasNewPanelDraft,
      toggleHomeDashboard,
      isHome,
      t,
      getDashboard,
      store,
      route,
      // date variables
      dateTimePicker,
      selectedDate,
      currentTimeObj,
      currentTimeObjPerPanel,
      shouldRefreshWithoutCachePerPanel,
      refreshInterval,
      // ----------------
      refreshData,
      isAutoRunAvailable,
      isAutoRunOn,
      toggleAutoRun,
      refreshVariant,
      refreshOptionsVariant,
      isVariablesChanged,
      isRefreshPending,
      refreshTooltip,
      timeGate,
      pickedDate: timeGate.picked,
      onTimePickerHide,
      refreshedVariablesDataUpdated,
      onDeletePanel,
      variablesData,
      variablesDataUpdated,
      showDashboardSettingsDialog,
      hasUnsavedConflict,
      resolveSaveConflict,
      saveConflictState: dashboardSaveConflictState,
      openSettingsDialog,
      loadDashboard,
      refreshPanelRequest,
      updateRunId,
      initialVariableValues,
      getQueryParamsForDuration,
      onDataZoom,
      dashboardShareURL,
      onDashboardShared,
      selectedTabId,
      onMovePanel,
      printDashboard,
      initialTimezone,
      timeString,
      searchType,
      openScheduledReports,
      showScheduledReportsDialog,
      isLoadingReports,
      scheduledReports,
      dashboardId,
      folderId,
      reportId,
      tabId,
      outlinedDescription: "description",
      searchRequestTraceIds,
      arePanelsLoading,
      cancelQuery,
      traceIdRef,
      handleEmittedData,
      config,
      openLayoutConfig,
      selectedPanelConfig,
      savePanelLayout,
      renderDashboardChartsRef,
      isEditingLayout,
      layoutChangeCount,
      canUndoLayout,
      canRedoLayout,
      layoutMode,
      isSavingLayout,
      enterLayoutEdit,
      onLayoutChange,
      undoLayout,
      redoLayout,
      saveLayout,
      requestExitLayoutEdit,
      discardDialog,
      settleDiscard,
      folderNameFromFolderId,
      showJsonEditorDialog,
      openJsonEditor,
      saveJsonDashboard,
      setTimeForVariables,
      runId,
      onVariablesManagerReady,
      kioskMode,
      kioskFit,
      kioskPointerActive,
      playlistEmbed,
      playlistPosition,
      playlistHolding,
      playlistPageActive: playlistPage.active,
      kioskHealth: kioskRefresh.health,
      kioskLastSuccessAt: kioskRefresh.lastSuccessAt,
      kioskCountdown: kioskRefresh.countdown,
      onAutoRefreshTick,
      kioskTimeRange,
      enterKiosk,
      exitKiosk,
    };
  },
});
</script>

<!-- eslint-disable-next-line vue/enforce-style-attribute -- must stay unscoped: the @media print block below targets ancestors outside this component (.o2-app-root, main, .o2-content-scroll, .scroll). `scoped` rewrites selectors to this component's own elements, so those rules would match nothing and dashboard printing would clip at viewport height. -->
<style>
/* keep(complex-state): fullscreen / sticky-header / print-mode toggled state
   classes (compound .stickyHeader.fullscreenHeader chain + high z-index stacking)
   plus a @media print block that must reach external ancestors
   (.o2-app-root, main, .o2-content-scroll, .scroll) — none expressible as
   component-scoped utilities, so the block stays an unscoped global. */
.stickyHeader {
  position: sticky;
  top: 0;
  z-index: 1001;
}

.stickyHeader.fullscreenHeader {
  top: 0;
  z-index: 5100 !important;
}

/* The fullscreen surface colour is `bg-surface-base!`, applied alongside this
   class in the template — a background colour has a utility, the viewport-pinning
   geometry below does not. */
.fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  z-index: 5000 !important;
  margin: 0 !important;
  padding: 0 !important;
}

.print-mode-container {
  /* Grow to the dashboard's natural content height and let the app's outer
     scroll wrapper (MainLayout's .o2-content-scroll) do the scrolling — the same
     model the @media print block below relies on. Pinning a viewport height here
     (100vh or 100%) capped the subtree, and OPageLayout's body (overflow-hidden)
     then clipped the trailing panels, so tall dashboards could never be scrolled
     to the bottom. `overflow: visible` keeps the sticky header pinned to the
     outer scroll wrapper rather than to a dead inner scroll box. */
  height: auto !important;
  overflow: visible !important;
}

@media print {
  .print-mode-container {
    height: auto !important;
    overflow: visible !important;
  }

  /* Make every ancestor flex/scroll container release its viewport height
   * so the absolute → block flow conversion in RenderDashboardCharts.vue's
   * print CSS can actually grow beyond one page. Without these, the .scroll
   * / overflow-y wrappers clip the dashboard at viewport-height in print. */
  .o2-app-root,
  main,
  .o2-content-scroll,
  .scroll {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
  }
}
</style>
