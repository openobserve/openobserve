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
    class="h-full flex flex-col rounded-lg overflow-hidden"
    @mouseover="() => (isCurrentlyHoveredPanel = true)"
    @mouseleave="() => (isCurrentlyHoveredPanel = false)"
    :data-test="`dashboard-panel-container`"
    :data-test-panel-id="props.data.id"
    :data-test-panel-title="props.data.title"
  >
    <div
      :class="{
        'shrink-0': !viewOnly && !simplifiedPanelView,
        'drag-allow': !viewOnly && !simplifiedPanelView,
      }"
    >
      <div
        class="flex flex-nowrap items-center w-full min-h-7 py-1 px-2 border-b border-border-subtle rounded-t-lg"
        :class="{ 'border-b-transparent': isPanelLoading }"
        data-test="dashboard-panel-bar"
      >
        <OIcon
          v-if="!viewOnly && !simplifiedPanelView"
          name="drag-indicator" size="sm"
          data-test="dashboard-panel-drag"
        />
        <div
          :title="props.data.title"
          class="whitespace-nowrap overflow-hidden text-ellipsis text-[0.8125rem] font-medium text-(--color-text-primary) tracking-[0.02em]"
          data-test="dashboard-panel-header"
        >
          {{ props.data.title }}
        </div>
        <div class="flex-1" />

        <!-- Show Legends button (hidden when the chart has no data) -->
        <OButton
          v-if="
            isCurrentlyHoveredPanel &&
            props.showLegendsButton &&
            !PanleSchemaRendererRef?.noData &&
            ![
              'table', 'html', 'markdown', 'custom_chart',
              'geomap', 'maps', 'heatmap', 'metric', 'gauge',
            ].includes(props.data.type)
          "
          variant="ghost"
          size="icon"
          @click="showLegendsDialog = true"
          icon-left="format-list-bulleted"
          data-test="dashboard-show-legends-btn"
        >
          <OTooltip :content="t('dashboard.panelContainer.showLegends')" side="bottom" align="end" />
        </OButton>

        <!-- Add Annotations button -->
        <OButton
          v-if="
            !viewOnly &&
            !simplifiedPanelView &&
            isCurrentlyHoveredPanel &&
            [
              'area', 'area-stacked', 'bar', 'h-bar',
              'line', 'scatter', 'stacked', 'h-stacked',
            ].includes(props.data.type) &&
            PanleSchemaRendererRef?.checkIfPanelIsTimeSeries === true
          "
          variant="ghost"
          size="icon"
          @click="PanleSchemaRendererRef?.toggleAddAnnotationMode()"
          data-test="panel-schema-renderer-annotation-button"
        >
          <OIcon :name="PanleSchemaRendererRef?.isAddAnnotationMode ? 'cancel' : 'edit'" size="sm" />
          <OTooltip :content="PanleSchemaRendererRef?.isAddAnnotationMode ? t('dashboard.panelContainer.exitAnnotationsMode') : t('dashboard.panelContainer.addAnnotations')" side="bottom" align="end" />
        </OButton>

        <OIcon
          v-if="
            !viewOnly &&
            !simplifiedPanelView &&
            isCurrentlyHoveredPanel &&
            props.data.description != ''
          "
          name="info-outline"
          size="sm"
          class="cursor-pointer"
          data-test="dashboard-panel-description-info"
        >
          <OTooltip side="bottom" align="end" max-width="13.75rem">
            <template #content><div class="whitespace-pre-wrap">{{ props.data.description }}</div></template>
          </OTooltip>
        </OIcon>
        <OButton
          v-if="!viewOnly && !simplifiedPanelView && isCurrentlyHoveredPanel"
          variant="ghost"
          size="icon"
          @click="onPanelModifyClick('ViewPanel')"
          data-test="dashboard-panel-fullscreen-btn"
          icon-left="fullscreen"
        >
          <OTooltip side="bottom" :content="t('panel.fullScreen')" shortcut-id="panelView" />
        </OButton>
        <OButton
          v-if="dependentAdHocVariable"
          variant="ghost-warning"
          size="icon"
          @click="showViewPanel = true"
          data-test="dashboard-panel-dependent-adhoc-variable-btn"
          icon-left="warning"
        >
          <OTooltip side="bottom" align="end" max-width="13.75rem" :content="t('dashboard.panelContainer.dependentAdhocVariableWarning')" />
        </OButton>
        <!-- show error here -->
        <PanelErrorButtons
          :error="errorData"
          :maxQueryRangeWarning="maxQueryRangeWarning"
          :limitNumberOfSeriesWarningMessage="limitNumberOfSeriesWarningMessage"
          :isCachedDataDifferWithCurrentTimeRange="
            isCachedDataDifferWithCurrentTimeRange
          "
          :isPartialData="isPartialData"
          :isPanelLoading="isPanelLoading"
          :lastTriggeredAt="lastTriggeredAt"
          :viewOnly="viewOnly"
        />
        <OButton
          v-if="!viewOnly && !simplifiedPanelView"
          :variant="variablesDataUpdated ? 'ghost-warning' : 'ghost'"
          size="icon"
          @click="() => onRefreshPanel(false)"
          :title="t('panel.refreshPanel')"
          data-test="dashboard-panel-refresh-panel-btn"
          :disabled="isPanelLoading"
          icon-left="refresh"
        >
          <OTooltip :content="variablesDataUpdated ? t('panel.refreshToApplyVariables') : t('panel.refresh')" />
        </OButton>
        <!-- Direct delete icon (shown when simplifiedPanelView is true) -->
        <OButton
          v-if="!viewOnly && simplifiedPanelView"
          variant="ghost"
          size="icon"
          @click="onPanelModifyClick('DeletePanel')"
          :title="t('panel.deletePanel')"
          :data-test="`dashboard-delete-panel-${props.data.title}-btn`"
          icon-left="close"
        >
        </OButton>

        <!-- Dropdown menu (shown when simplifiedPanelView is false) -->
        <ODropdown
          side="bottom"
          align="end"
          v-if="!viewOnly && !simplifiedPanelView"
        >
          <template #trigger>
            <OButton
              variant="ghost"
              size="icon"
              :data-test="`dashboard-edit-panel-${props.data.title}-dropdown`"
            >
              <OIcon name="more-vert" size="sm" />
            </OButton>
          </template>
          <ODropdownItem
            v-if="!simplifiedPanelView"
            data-test="dashboard-edit-panel"
            @select="onPanelModifyClick('EditPanel')"
            shortcut-id="panelEdit"
          >
            <template #icon-left
              ><OIcon name="edit" size="sm"
            /></template>
            {{ t("panel.editPanel") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="!simplifiedPanelView"
            data-test="dashboard-edit-layout"
            @select="onPanelModifyClick('EditLayout')"
          >
            <template #icon-left
              ><OIcon name="dashboard-customize" size="sm"
            /></template>
            {{ t("panel.editLayout") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="!simplifiedPanelView"
            data-test="dashboard-duplicate-panel"
            @select="onPanelModifyClick('DuplicatePanel')"
            shortcut-id="panelDuplicate"
          >
            <template #icon-left
              ><OIcon name="content-copy" size="sm"
            /></template>
            {{ t("panel.duplicate") }}
          </ODropdownItem>
          <ODropdownItem
            data-test="dashboard-delete-panel"
            @select="onPanelModifyClick('DeletePanel')"
            shortcut-id="panelDelete"
          >
            <template #icon-left
              ><OIcon name="delete-outline" size="sm" class="text-current!"
            /></template>
            {{ t("panel.deletePanel") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="
              !simplifiedPanelView && metaData && metaData.queries?.length > 0
            "
            data-test="dashboard-query-inspector-panel"
            @select="showViewPanel = true"
            shortcut-id="panelQueryInspector"
          >
            <template #icon-left
              ><OIcon name="manage-search" size="sm"
            /></template>
            {{ t("panel.queryInspector") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="
              !simplifiedPanelView && metaData && metaData.queries?.length > 0
            "
            data-test="dashboard-panel-download-as-csv-btn"
            @select="
              PanleSchemaRendererRef?.downloadDataAsCSV(props.data.title)
            "
          >
            <template #icon-left
              ><OIcon name="file-download" size="sm"
            /></template>
            {{ t("panel.downloadAsCSV") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="
              !simplifiedPanelView && metaData && metaData.queries?.length > 0
            "
            data-test="dashboard-panel-download-as-json-btn"
            @select="
              PanleSchemaRendererRef?.downloadDataAsJSON(props.data.title)
            "
          >
            <template #icon-left
              ><OIcon name="data-object" size="sm"
            /></template>
            {{ t("panel.downloadAsJSON") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="
              !simplifiedPanelView && metaData && metaData.queries?.length > 0
            "
            :disabled="props.data.queryType != 'sql'"
            data-test="dashboard-move-to-logs-module"
            @select="onLogPanel"
            icon-left="search"
          >
            {{ t("panel.goToLogs") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="!simplifiedPanelView && config.isEnterprise === 'true'"
            data-test="dashboard-refresh-without-cache"
            @select="onPanelModifyClick('Refresh')"
            icon-left="cached"
          >
            {{ t("dashboard.panelContainer.refreshCacheReload") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="!simplifiedPanelView"
            data-test="dashboard-move-to-another-panel"
            @select="onPanelModifyClick('MovePanel')"
          >
            <template #icon-left
              ><OIcon name="drive-file-move" size="sm"
            /></template>
            {{ t("panel.moveToAnotherTab") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="
              !simplifiedPanelView && metaData && metaData.queries?.length > 0
            "
            data-test="dashboard-create-alert-from-panel"
            @select="onPanelModifyClick('CreateAlert')"
          >
            <template #icon-left
              ><OIcon name="shield-alert-outline" size="sm"
            /></template>
            {{ t("panel.createAlert") }}
          </ODropdownItem>
        </ODropdown>
      </div>
    </div>

    <!-- Panel-Level Variables (shown below drag-allow section) -->
    <div class="shrink-0">
      <slot name="panel-variables"></slot>
    </div>

    <div class="flex-1 min-h-0">
      <PanelSchemaRenderer
        :panelSchema="props.data"
        :selectedTimeObj="props.selectedTimeDate"
        :width="props.width"
        :height="props.height"
        :variablesData="props.variablesData"
        :currentVariablesData="props.currentVariablesData"
        :forceLoad="props.forceLoad"
        :searchType="searchType"
        :dashboard-id="props.dashboardId"
        :folder-id="props.folderId"
        :report-id="props.reportId"
        :runId="runId"
        :tabId="props.tabId"
        :tabName="props.tabName"
        :dashboardName="props.dashboardName"
        :folderName="props.folderName"
        :viewOnly="viewOnly"
        :shouldRefreshWithoutCache="props.shouldRefreshWithoutCache"
        @loading-state-change="handleLoadingStateChange"
        @metadata-update="metaDataValue"
        @limit-number-of-series-warning-message-update="
          handleLimitNumberOfSeriesWarningMessageUpdate
        "
        @result-metadata-update="handleResultMetadataUpdate"
        @last-triggered-at-update="handleLastTriggeredAtUpdate"
        @is-cached-data-differ-with-current-time-range-update="
          handleIsCachedDataDifferWithCurrentTimeRangeUpdate
        "
        @updated:data-zoom="$emit('updated:data-zoom', $event)"
        @update:initial-variable-values="
          (...args) => $emit('update:initial-variable-values', ...args)
        "
        @error="onError"
        @is-partial-data-update="handleIsPartialDataUpdate"
        @contextmenu="$emit('contextmenu', $event)"
        ref="PanleSchemaRendererRef"
        :allowAnnotationsAdd="true"
        :allowAlertCreation="allowAlertCreation"
        @show-legends="showLegendsDialog = true"
        :showLegendsButton="props.showLegendsButton"
      ></PanelSchemaRenderer>
    </div>

    <QueryInspector v-model:open="showViewPanel" :metaData="metaData" :data="props.data" data-test="query-inspector-dialog" />

    <ShowLegendsPopup
      v-model:open="showLegendsDialog"
      :panelData="currentPanelData"
      data-test="panel-container-legends-dialog"
    />

    <ConfirmDialog
      :title="t('panel.deletePanelTitle')"
      :message="t('panel.deletePanelMessage')"
      @update:ok="deletePanelDialog"
      @update:cancel="confirmDeletePanelDialog = false"
      v-model="confirmDeletePanelDialog"
    />

    <SinglePanelMove
      :title="t('panel.movePanelTitle')"
      :message="t('panel.movePanelMessage')"
      @update:ok="movePanelDialog"
      :key="confirmMovePanelDialog"
      @update:cancel="confirmMovePanelDialog = false"
      v-model="confirmMovePanelDialog"
      @refresh="$emit('refresh')"
    />
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  computed,
  defineAsyncComponent,
  watch,
  onBeforeUnmount,
  onMounted,
} from "vue";
import { panelDownloadRegistry, panelCsvRegistry } from "@/utils/panelDownloadRegistry";
import PanelSchemaRenderer from "./PanelSchemaRenderer.vue";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import { addPanel } from "@/utils/commons";
import ConfirmDialog from "../ConfirmDialog.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import SinglePanelMove from "@/components/dashboards/settings/SinglePanelMove.vue";
import RelativeTime from "@/components/common/RelativeTime.vue";
import {
  getFunctionErrorMessage,
  getUUID,
  processQueryMetadataErrors,
} from "@/utils/zincutils";
import useNotifications from "@/composables/useNotifications";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { isEqual } from "lodash-es";
import { b64EncodeUnicode } from "@/utils/zincutils";
import shortURL from "@/services/short_url";
import config from "@/aws-exports";
import { useI18n } from "vue-i18n";
import { toast } from "@/lib/feedback/Toast/useToast";
import { isInputFocused } from "@/utils/keyboardShortcuts";

const QueryInspector = defineAsyncComponent(() => {
  return import("@/components/dashboards/QueryInspector.vue");
});
const PanelErrorButtons = defineAsyncComponent(() => {
  return import("@/components/dashboards/PanelErrorButtons.vue");
});

export default defineComponent({
  name: "PanelContainer",
  emits: [
    "onDeletePanel",
    "onViewPanel",
    "updated:data-zoom",
    "onMovePanel",
    "refreshPanelRequest",
    "refresh",
    "update:initial-variable-values",
    "onEditLayout",
    "update:runId",
    "contextmenu",
  ],
  props: [
    "data",
    "selectedTimeDate",
    "viewOnly",
    "width",
    "height",
    "variablesData",
    "dashboardId",
    "metaData",
    "forceLoad",
    "searchType",
    "folderId",
    "reportId",
    "currentVariablesData",
    "runId",
    "tabId",
    "tabName",
    "dashboardName",
    "folderName",
    "allowAlertCreation",
    "panelVariablesConfig",
    "simplifiedPanelView",
    "shouldRefreshWithoutCache",
    "showLegendsButton",
  ],
  components: {
    PanelSchemaRenderer,
    QueryInspector,
    ConfirmDialog,
    SinglePanelMove,
    RelativeTime,
    PanelErrorButtons,
    OButton,
    OIcon,
    ODropdown,
    ODropdownItem,
    OTooltip,
    ShowLegendsPopup: defineAsyncComponent(() => {
      return import("@/components/dashboards/addPanel/ShowLegendsPopup.vue");
    }),
  },
  setup(props, { emit }) {
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const { t } = useI18n();
    const metaData = ref();
    const showViewPanel = ref(false);
    const showLegendsDialog = ref(false);
    const confirmDeletePanelDialog = ref(false);
    const confirmMovePanelDialog: any = ref(false);
    const {
      showPositiveNotification,
      showErrorNotification,
      showConfictErrorNotificationWithRefreshBtn,
    } = useNotifications();
    const metaDataValue = (metadata: any) => {
      metaData.value = metadata;
    };

    const maxQueryRangeWarning = ref("");

    const limitNumberOfSeriesWarningMessage = ref("");

    const handleResultMetadataUpdate = (metadata: any) => {
      maxQueryRangeWarning.value = processQueryMetadataErrors(
        metadata,
        store.state.timezone,
      );
    };

    // to store and show when the panel was last loaded
    const lastTriggeredAt = ref(null);
    const handleLastTriggeredAtUpdate = (data: any) => {
      lastTriggeredAt.value = data;
    };

    // to store and show warning if the cached data is different with current time range
    const isCachedDataDifferWithCurrentTimeRange: any = ref(false);
    const handleIsCachedDataDifferWithCurrentTimeRangeUpdate = (
      isDiffer: boolean,
    ) => {
      isCachedDataDifferWithCurrentTimeRange.value = isDiffer;
    };

    const handleLimitNumberOfSeriesWarningMessageUpdate = (message: string) => {
      limitNumberOfSeriesWarningMessage.value = message;
    };

    const showText = ref(false);

    // need PanleSchemaRendererRef for table download as a csv
    const PanleSchemaRendererRef: any = ref(null);

    //check if dependent adhoc variable exists
    const dependentAdHocVariable = computed(() => {
      if (!metaData.value) {
        return false;
      }

      const adhocVariables = props.variablesData.values
        ?.filter((it: any) => it.type === "dynamic_filters")
        ?.map((it: any) => it?.value)
        .flat()
        ?.filter((it: any) => it?.operator && it?.name && it?.value);

      const metaDataDynamic = metaData.value?.queries?.every((it: any) => {
        const vars = it?.variables?.filter(
          (it: any) => it.type === "dynamicVariable",
        );
        return vars?.length == adhocVariables?.length;
      });

      if (adhocVariables?.length == 0 || adhocVariables == undefined) {
        return false;
      }
      return !metaDataDynamic;
    });

    // for full screen button
    const isCurrentlyHoveredPanel: any = ref(false);

    //for edit panel
    const onEditPanel = (data: any) => {
      return router.push({
        path: "/dashboards/add_panel",
        query: {
          ...route.query,
          dashboard: String(route.query.dashboard),
          panelId: data.id,
          folder: route.query.folder ?? "default",
          tab: route.query.tab ?? data.panels[0]?.tabId,
        },
      });
    };
    const getOriginalQueryAndStream = (queryDetails: any, metadata: any) => {
      const originalQuery = metadata?.value?.queries[0]?.query;
      const streamName = queryDetails?.queries[0]?.fields?.stream;

      if (!originalQuery || !streamName) {
        return null;
      }

      return { originalQuery, streamName };
    };
    const constructLogsUrl = (
      streamName: string,
      encodedQuery: string,
      queryDetails: any,
      currentUrl: string,
      vrlFunctionQueryEncoded: string,
    ) => {
      const logsUrl = new URL(currentUrl + "/logs");
      logsUrl.searchParams.set(
        "stream_type",
        queryDetails.queries[0]?.fields?.stream_type,
      );
      logsUrl.searchParams.set("stream", streamName);
      logsUrl.searchParams.set(
        "from",
        metaData.value.queries[0]?.startTime.toString(),
      );
      logsUrl.searchParams.set(
        "to",
        metaData.value.queries[0]?.endTime.toString(),
      );
      logsUrl.searchParams.set("functionContent", vrlFunctionQueryEncoded);
      //this url paramater have been added to show the function editor in the logs page when the query has vrl function
      //otherwise it will be false and the function editor will not be shown
      if (vrlFunctionQueryEncoded.length > 0) {
        logsUrl.searchParams.set("fn_editor", "true");
      } else {
        logsUrl.searchParams.set("fn_editor", "false");
      }
      logsUrl.searchParams.set("sql_mode", "true");
      logsUrl.searchParams.set("query", encodedQuery);
      logsUrl.searchParams.set(
        "org_identifier",
        store.state.selectedOrganization.identifier,
      );
      if (store.state.zoConfig.quick_mode_enabled) {
        logsUrl.searchParams.set("quick_mode", "true");
      } else {
        logsUrl.searchParams.set("quick_mode", "false");
      }
      logsUrl.searchParams.set("show_histogram", "false");
      return logsUrl;
    };

    const onLogPanel = async () => {
      const showNotification = showPositiveNotification(
        t("dashboard.panelContainer.redirectingToLogs"),
        {
        },
      );
      const queryDetails = props.data;
      if (!queryDetails) {
        return;
      }

      const { originalQuery, streamName } =
        getOriginalQueryAndStream(queryDetails, metaData) || {};
      if (!originalQuery || !streamName) return;

      let modifiedQuery = originalQuery;

      modifiedQuery = modifiedQuery.replace(/`/g, '"');

      const encodedQuery: any = b64EncodeUnicode(modifiedQuery);

      const vrlFunctionQuery = queryDetails.queries[0]?.vrlFunctionQuery;
      const vrlFunctionQueryEncoded: any = b64EncodeUnicode(vrlFunctionQuery);

      const pos = window.location.pathname.indexOf("/web/");
      const currentUrl =
        pos > -1
          ? window.location.origin +
            window.location.pathname.slice(0, pos) +
            "/web"
          : window.location.origin;

      const logsUrl = constructLogsUrl(
        streamName,
        encodedQuery,
        queryDetails,
        currentUrl,
        vrlFunctionQueryEncoded,
      );

      // Use short_url service to shorten the URL and redirect
      try {
        const org_identifier = store.state.selectedOrganization.identifier;
        const response = await shortURL.create(
          org_identifier,
          logsUrl.toString(),
        );
        const shortUrl = response?.data?.short_url;
        if (shortUrl) {
          window.open(shortUrl, "_blank");
        } else {
          window.open(logsUrl.toString(), "_blank");
        }
        showNotification();
      } catch (error) {
        window.open(logsUrl.toString(), "_blank");
      }
    };

    //create a duplicate panel
    const onDuplicatePanel = async (data: any): Promise<void> => {
      // Show a loading spinner notification.
      const dismiss = toast({
        variant: "loading",
        message: t("dashboard.panelContainer.pleaseWait"),
              timeout: 0,
});

      // Generate a unique panel ID.
      const panelId =
        "Panel_ID" + Math.floor(Math.random() * (99999 - 10 + 1)) + 10;

      // Duplicate the panel data with the new ID.
      const panelData = JSON.parse(JSON.stringify(data));
      panelData.id = panelId;

      try {
        // Add the duplicated panel to the dashboard.
        await addPanel(
          store,
          route.query.dashboard,
          panelData,
          route.query.folder ?? "default",
          route.query.tab ?? data.panels[0]?.tabId,
        );

        // Show a success notification.
        showPositiveNotification(t("panel.panelDuplicatedSuccessfully"));

        // Navigate to the new panel.
        router.push({
          path: "/dashboards/add_panel",
          query: {
            ...route.query,
            dashboard: String(route.query.dashboard),
            panelId: panelId,
            folder: route.query.folder ?? "default",
            tab: route.query.tab ?? data.panels[0]?.tabId,
          },
        });
        return;
      } catch (error: any) {
        // Show an error notification.

        if (error?.response?.status === 409) {
          showConfictErrorNotificationWithRefreshBtn(
            error?.response?.data?.message ??
              error?.message ??
              t("panel.panelDuplicationFailed"),
          );
        } else {
          showErrorNotification(
            error?.message ?? t("panel.panelDuplicationFailed"),
          );
        }
      }
      // Hide the loading spinner notification.
      dismiss();
    };

    const deletePanelDialog = async (data: any) => {
      emit("onDeletePanel", props.data.id);
    };

    const movePanelDialog = async (selectedTabId: any) => {
      emit("onMovePanel", props.data.id, selectedTabId);
    };

    const isPanelLoading = ref(false);

    const handleLoadingStateChange = (isLoading: any) => {
      isPanelLoading.value = isLoading;
    };

    // Initialize dashboard run ID management
    const runId = ref(props.runId || getUUID().replace(/-/g, ""));

    // Watch for changes in the runId prop and update local runId
    watch(
      () => props.runId,
      (newRunId) => {
        if (newRunId) {
          runId.value = newRunId;
        }
      },
    );

    const generateNewDashboardRunId = () => {
      const newRunId = getUUID().replace(/-/g, "");
      runId.value = newRunId;
      // Emit the new run ID to parent component
      emit("update:runId", newRunId);
      return newRunId;
    };

    const onRefreshPanel = async (shouldRefreshWithoutCache = false) => {
      // Need to generate a new run id when refreshing the panel
      generateNewDashboardRunId();

      if (isPanelLoading.value) return;

      isPanelLoading.value = true;
      try {
        await emit(
          "refreshPanelRequest",
          props.data.id,
          shouldRefreshWithoutCache,
        );
      } finally {
        isPanelLoading.value = false;
      }
    };
    const createVariableRegex = (name: any) =>
      new RegExp(
        `(?:\\$\\{?\\s*${name}\\s*(?::\\s*(?:csv|pipe|doublequote|singlequote)\\s*)?\\}?)|(?:\\{\\{\\s*${name}\\s*(?::\\s*(?:csv|pipe|doublequote|singlequote)\\s*)?\\}\\})`,
      );

    const getDependentVariablesData = () =>
      props.variablesData?.values
        ?.filter((it: any) => it.type != "dynamic_filters") // ad hoc filters are not considered as dependent filters as they are globally applied
        ?.filter((it: any) => {
          const regexForVariable = createVariableRegex(it.name);
          return props.data.queries
            ?.map((q: any) => regexForVariable.test(q?.query))
            ?.includes(true);
        });

    // Check if any dependent variable's value has changed
    const variablesDataUpdated = computed(() => {
      // Get dependent variables
      const dependentVariables = getDependentVariablesData();

      // Validate dependentVariables and currentVariablesData
      if (!Array.isArray(dependentVariables)) {
        return false;
      }
      if (!Array.isArray(props.currentVariablesData.values)) {
        return false;
      }

      // Check if any dependent variable's value has changed
      return dependentVariables.some((dependentVariable) => {
        if (!dependentVariable || !dependentVariable.name) {
          return false;
        }

        // Find the corresponding variable in currentVariablesData
        const refreshedVariable = props.currentVariablesData.values.find(
          (varData: any) => varData.name === dependentVariable.name,
        );

        if (!refreshedVariable) {
          return false; // Assume no change if no matching variable
        }

        // Compare values
        const currentValue = dependentVariable.value;
        const refreshedValue = refreshedVariable.value;

        // Handle both array and primitive types for value comparison
        return Array.isArray(currentValue)
          ? !isEqual(currentValue, refreshedValue)
          : currentValue !== refreshedValue;
      });
    });

    const errorData = ref("");
    const onError = (error: any) => {
      if (typeof error === "string") {
        errorData.value = error;
      } else {
        errorData.value = error?.message ?? "";
      }
    };

    const isPartialData = ref(false);

    const handleIsPartialDataUpdate = (isPartial: boolean) => {
      isPartialData.value = isPartial;
    };

    // Register in the module-level download registry so that
    // window.oo_logAllPanelsJSON() can print panel data from the console,
    // and in panelCsvRegistry so window.oo_getAllPanelsCsv() can collect CSV data.
    onMounted(() => {
      const panelId = props.data?.id;
      if (panelId) {
        panelDownloadRegistry.set(panelId, () =>
          PanleSchemaRendererRef.value?.logDataAsJSON(props.data?.title),
        );
        panelCsvRegistry.set(panelId, () =>
          PanleSchemaRendererRef.value?.getPanelCsvData(props.data?.title) ?? null,
        );
      }
    });

    // Add cleanup on component unmount
    onBeforeUnmount(() => {
      // Unregister from download registry
      const panelId = props.data?.id;
      if (panelId) {
        panelDownloadRegistry.delete(panelId);
        panelCsvRegistry.delete(panelId);
      }

      // Clear any pending timeouts or intervals
      // Reset refs to help with garbage collection
      metaData.value = null;
      errorData.value = "";

      // Clear the PanelSchemaRenderer reference
      if (PanleSchemaRendererRef.value) {
        PanleSchemaRendererRef.value = null;
      }
    });

    const currentPanelData = computed(() => {
      // panelData is a ref exposed by PanelSchemaRenderer
      const rendererData = PanleSchemaRendererRef.value?.panelData || {};
      return {
        ...rendererData,
        config: props.data?.config || {},
      };
    });

    // ── Panel hover keyboard shortcuts ────────────────────────────────────
    // Direct keydown listener — avoids ShortcutManager conflicts when many
    // panels are mounted at the same time. Only fires when this panel is hovered.
    const handlePanelKeydown = (e: KeyboardEvent) => {
      if (!isCurrentlyHoveredPanel.value) return;
      if (isInputFocused()) return;
      // These are single-letter shortcuts — never fire while a modifier is held.
      // Otherwise combos like Alt+Left (panel-editor "Discard & go back") leaking
      // a still-held Alt into the next keystroke would wrongly trigger edit/view.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === "v" || e.key === "V") {
        e.preventDefault();
        emit("onViewPanel", props.data.id);
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        showViewPanel.value = true;
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        onEditPanel(props.data);
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        onDuplicatePanel(props.data);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        // Mac: physical Delete key fires Backspace; Fn+Delete fires Delete
        e.preventDefault();
        confirmDeletePanelDialog.value = true;
      }
    };

    onMounted(() => window.addEventListener("keydown", handlePanelKeydown));
    onBeforeUnmount(() =>
      window.removeEventListener("keydown", handlePanelKeydown),
    );

    return {
      props,
      onEditPanel,
      onLogPanel,
      onDuplicatePanel,
      deletePanelDialog,
      isCurrentlyHoveredPanel,
      showViewPanel,
      dependentAdHocVariable,
      confirmDeletePanelDialog,
      showText,
      PanleSchemaRendererRef,
      confirmMovePanelDialog,
      movePanelDialog,
      onRefreshPanel,
      variablesDataUpdated,
      onError,
      errorData,
      isPanelLoading,
      handleLoadingStateChange,
      limitNumberOfSeriesWarningMessage,
      handleLimitNumberOfSeriesWarningMessageUpdate,
      isPartialData,
      handleIsPartialDataUpdate,
      config,
      t,
      showLegendsDialog,
      currentPanelData,
      outlinedRunningWithErrors: "running-with-errors",
      outlinedReportProblem: "report-problem",
      outlinedDashboardCustomize: "dashboard-customize",
      outlinedFileDownload: "file-download",
      store,
      metaDataValue,
      handleResultMetadataUpdate,
      handleLastTriggeredAtUpdate,
      isCachedDataDifferWithCurrentTimeRange,
      handleIsCachedDataDifferWithCurrentTimeRangeUpdate,
      lastTriggeredAt,
      maxQueryRangeWarning,
      metaData,
    };
  },
  methods: {
    onPanelModifyClick(evt: any) {
      if (evt == "ViewPanel") {
        this.$emit("onViewPanel", this.props.data.id);
      } else if (evt == "EditPanel") {
        this.onEditPanel(this.props.data);
      } else if (evt == "DeletePanel") {
        this.confirmDeletePanelDialog = true;
      } else if (evt == "DuplicatePanel") {
        this.onDuplicatePanel(this.props.data);
      } else if (evt == "MovePanel") {
        this.confirmMovePanelDialog = true;
      } else if (evt == "EditLayout") {
        this.$emit("onEditLayout", this.props.data.id);
      } else if (evt == "CreateAlert") {
        this.createAlertFromPanel();
      } else if (evt == "Refresh") {
        this.onRefreshPanel(true);
      } else {
      }
    },
    createAlertFromPanel() {
      if (!this.props.data.queries || this.props.data.queries.length === 0) {
        toast({
          variant: "error",
          message: this.t("panel.noQueriesToCreateAlert"),
        });
        return;
      }

      const query = this.props.data.queries[0];
      if (!query.fields?.stream) {
        toast({
          variant: "error",
          message: this.t("panel.panelQueryMustHaveStream"),
        });
        return;
      }

      const unsupportedTypes = ["markdown", "html", "geomap", "sankey"];
      if (unsupportedTypes.includes(this.props.data.type)) {
        toast({
          variant: "warning",
          message: this.t("panel.unsupportedPanelTypeAlert", {
            type: this.props.data.type,
          }),
        });
      }

      const panelData = {
        panelTitle: this.props.data.title,
        panelType: this.props.data.type,
        queries: this.props.data.queries || [],
        queryType: this.props.data.queryType,
        metadata: this.metaData,
        timeRange: this.props.selectedTimeDate,
      };

      const encodedData = encodeURIComponent(JSON.stringify(panelData));
      this.$router.push({
        name: "addAlert",
        query: {
          org_identifier: this.store.state.selectedOrganization.identifier,
          folder: "default",
          fromPanel: "true",
          panelData: encodedData,
        },
      });
    },
  },
});
</script>
