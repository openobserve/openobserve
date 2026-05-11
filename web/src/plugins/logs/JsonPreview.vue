<template>
  <div>
    <div class="q-pb-xs flex justify-start q-px-md copy-log-btn">
      <app-tabs
        v-if="filteredTabs.length"
        class="tw:mb-[0.375rem] logs-json-preview-tabs q-mr-sm tw:border tw:border-solid tw:border-[var(--o2-border-color)] tw:rounded-[0.25rem] tw:text-[]"
        data-test="logs-json-preview-tabs"
        :tabs="filteredTabs"
        v-model:active-tab="activeTab"
        @update:active-tab="handleTabChange"
      />

      <OButton
        :label="t('common.copyToClipboard')"
        size="sm-action"
        variant="outline"
        class="tw:mb-[0.375rem] q-mr-sm"
        @click="copyLogToClipboard"
      ><q-icon name="content_copy" size="14px" class="tw:mr-1" />{{ t('common.copyToClipboard') }}</OButton>
      <OButton
        v-if="showViewRelatedBtn"
        size="sm-action"
        variant="outline"
        class="log-preview-btn q-mr-sm"
        @click="openCorrelation"
        data-test="log-correlation-btn"
      >
        <q-icon name="link" size="14px" class="tw:mr-1" />{{ t('search.viewRelated') }}
        <q-tooltip>
          {{ t("search.viewRelatedTooltip") }}
        </q-tooltip>
      </OButton>
      <div
        v-if="
          showViewTraceBtn && (tracesStreams.length || isTracesStreamsLoading)
        "
        class="o2-input flex items-center logs-trace-selector"
      >
        <q-select
          data-test="log-search-index-list-select-stream"
          v-model="searchObj.meta.selectedTraceStream"
          :options="filteredTracesStreamOptions"
          input-debounce="0"
          filled
          size="xs"
          borderless
          dense
          fill-input
          behavior="menu"
          :title="searchObj.meta.selectedTraceStream"
          :loading="isTracesStreamsLoading"
        >
          <template #no-option>
            <div class="o2-input log-stream-search-input">
              <q-input
                data-test="alert-list-search-input"
                v-model="streamSearchValue"
                borderless
                filled
                debounce="500"
                autofocus
                dense
                size="xs"
                @update:model-value="filterStreamFn"
                class="q-ml-auto q-mb-xs no-border q-pa-xs"
                :placeholder="t('search.searchStream')"
              >
                <template #prepend>
                  <q-icon name="search" class="cursor-pointer" />
                </template>
              </q-input>
            </div>
            <q-item>
              <q-item-section> {{ t("search.noResult") }}</q-item-section>
            </q-item>
          </template>
          <template #before-options>
            <div class="o2-input log-stream-search-input">
              <q-input
                data-test="alert-list-search-input"
                v-model="streamSearchValue"
                borderless
                debounce="500"
                filled
                dense
                size="xs"
                autofocus
                @update:model-value="filterStreamFn"
                class="q-ml-auto q-mb-xs no-border q-pa-xs"
                :placeholder="t('search.searchStream')"
              >
                <template #prepend>
                  <q-icon name="search" class="cursor-pointer" />
                </template>
              </q-input>
            </div>
          </template>
        </q-select>
        <OButton
          data-test="trace-view-logs-btn"
          class="traces-view-logs-btn"
          size="sm-action"
          variant="outline"
          @click="redirectToTraces"
        ><OIcon name="account-tree" size="xs" class="tw:mr-1" />{{ t('search.viewTrace') }}</OButton>
      </div>
    </div>
    <div v-show="activeTab === 'unflattened'" class="q-pl-md">
      <q-spinner-hourglass v-if="loading" size="lg" color="primary" />
      <div v-if="!loading">
        <code-query-editor
          v-model:query="unflattendData"
          ref="queryEditorRef"
          :editor-id="`logs-json-preview-unflattened-json-editor-${previewId}`"
          class="monaco-editor"
          :class="mode"
          language="json"
        />
      </div>
    </div>
    <div v-show="activeTab !== 'unflattened'" class="q-pl-md">
      {
      <div
        class="log_json_content"
        v-for="(key, index) in Object.keys(value)"
        :key="key"
      >
        <ODropdown
          v-if="!hideFieldOptions"
          v-model:open="dropdownOpenMap[key]"
          side="bottom"
          align="start"
        >
          <template #trigger>
            <OButton
              data-test="log-details-include-exclude-field-btn"
              size="icon-xs"
              variant="ghost"
              class="q-ml-sm log-json-field-dropdown-btn"
              aria-label="Add icon"
            >
              <q-icon :name="dropdownOpenMap[key] ? 'arrow_drop_up' : 'arrow_drop_down'" size="14px" />
            </OButton>
          </template>
          <ODropdownItem
            v-if="
              !hideSearchTermActions &&
              searchObj.data.stream.selectedStreamFields.some((item: any) =>
                item.name === key ? item.isSchemaField : '',
              ) &&
              multiStreamFields.includes(key)
            "
            data-test="log-details-include-field-btn"
            @select.stop="addSearchTerm(key, value[key], 'include')"
          >
            <template #icon-left><EqualIcon class="tw:size-4" /></template>
            {{ t("common.includeSearchTerm") }}
          </ODropdownItem>
          <ODropdownItem
            v-if="
              !hideSearchTermActions &&
              searchObj.data.stream.selectedStreamFields.some((item: any) =>
                item.name === key ? item.isSchemaField : '',
              ) &&
              multiStreamFields.includes(key)
            "
            data-test="log-details-exclude-field-btn"
            @select.stop="addSearchTerm(key, value[key], 'exclude')"
          >
            <template #icon-left><NotEqualIcon class="tw:size-4" /></template>
            {{ t("common.excludeSearchTerm") }}
          </ODropdownItem>
          <ODropdownItem
            data-test="log-details-add-field-btn"
            @select.stop="addFieldToTable(key)"
            icon-left="visibility"
          >
            {{ addOrRemoveLabel(key) }}
          </ODropdownItem>
          <!-- Cross-link options -->
          <template v-if="getCrossLinksForField(key).length > 0">
            <ODropdownSeparator />
            <ODropdownItem
              v-for="crossLink in getCrossLinksForField(key)"
              :key="crossLink.name"
              :data-test="`log-details-cross-link-${crossLink.name}`"
              @select.stop="openCrossLink(crossLink.resolvedUrl)"
              icon-left="open-in-new"
            >
              {{ crossLink.name }}
            </ODropdownItem>
          </template>
          <ODropdownItem
            v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
            data-test="send-to-ai-chat-btn"
            @select.stop="sendToAiChat(JSON.stringify({ [key]: value[key] }))"
          >
            <template #icon-left>
              <q-img height="14px" width="14px" :src="getBtnLogo" />
            </template>
            Send to AI Chat
          </ODropdownItem>
          <ODropdownItem
            v-if="config.isEnterprise == 'true' && store.state.zoConfig.ai_enabled"
            data-test="redirect-to-regex-pattern-btn"
            @select.stop="createRegexPatternFromLogs(key, value[key])"
          >
            <template #icon-left>
              <q-img height="14px" width="14px" :src="regexIcon" />
            </template>
            {{ t("regex_patterns.create_regex_pattern_field") }}
          </ODropdownItem>
        </ODropdown>

        <span
          class="q-pl-xs"
          :data-test="`log-expand-detail-key-${key}`"
          :class="store.state.theme === 'dark' ? 'dark' : ''"
        >
          <span class="log-key">{{ key }}</span
          ><span class="log-separator">: </span
          ><span
            ><ChunkedContent
              v-if="getContentSize(value[key]) > 50000"
              :data="value[key]"
              :field-key="`json_preview_${key}`"
              :query-string="highlightQuery"
              :simple-mode="false" /><LogsHighLighting
              v-else
              :data="value[key]"
              :show-braces="false"
              :query-string="highlightQuery" /></span
          ><span v-if="index < Object.keys(value).length - 1">,</span>
        </span>
      </div>
      }
      <div
        v-if="showMenu"
        class="context-menu shadow-lg rounded-sm"
        :style="{
          position: 'fixed',
          top: `${menuY}px`,
          left: `${menuX}px`,
          zIndex: 9999,
        }"
        :class="
          store.state.theme === 'dark'
            ? 'context-menu-dark'
            : 'context-menu-light'
        "
      >
        <div class="context-menu-item" @click="copySelectedText">
          <q-icon name="content_copy" size="xs" class="q-mr-sm" />
          Copy
        </div>
        <div class="context-menu-item" @click="handleCreateRegex">
          <q-img
            :src="regexIconForContextMenu"
            class="q-mr-sm"
            style="width: 14px; height: 14px"
          />
          Create regex pattern
        </div>
      </div>
    </div>
    <ODialog data-test="json-preview-regex-pattern-dialog"
      v-if="config.isEnterprise == 'true'"
      v-model:open="typeOfRegexPattern"
      size="lg"
      title="What is the type of regex pattern you want to create?"
      :secondary-button-label="t('confirmDialog.cancel')"
      :primary-button-label="t('confirmDialog.ok')"
      @click:secondary="typeOfRegexPattern = false"
      @click:primary="confirmRegexPatternType"
    >
      <q-input
        type="text"
        data-test="regex-pattern-type-input"
        v-model="regexPatternType"
        color="input-border"
        label="Type of regex pattern (e.g. email, phone number, etc.)"
        bg-color="input-bg"
        class="showLabelOnTop"
        stack-label
        outlined
        filled
        dense
      />
    </ODialog>
  </div>
</template>

<script lang="ts">
import {
  ref,
  reactive,
  onBeforeMount,
  computed,
  nextTick,
  onMounted,
  watch,
  onUnmounted,
} from "vue";
import { getImageURL, getUUID } from "@/utils/zincutils";
import { useStore } from "vuex";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { useI18n } from "vue-i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";
import AppTabs from "@/components/common/AppTabs.vue";
import searchService from "@/services/search";
import { generateTraceContext } from "@/utils/zincutils";
import { defineAsyncComponent } from "vue";
import { useQuasar } from "quasar";
import config from "@/aws-exports";
import LogsHighLighting from "@/components/logs/LogsHighLighting.vue";
import ChunkedContent from "@/components/logs/ChunkedContent.vue";
import { searchState } from "@/composables/useLogs/searchState";
import { useServiceCorrelation } from "@/composables/useServiceCorrelation";
import OButton from "@/lib/core/Button/OButton.vue";
import ODialog from "@/lib/overlay/Dialog/ODialog.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";
import { AlignLeft, FileJson } from "lucide-vue-next";

export default {
  name: "JsonPreview",
  props: {
    value: {
      type: Object,
      required: true,
      default: () => ({}),
    },
    showCopyButton: {
      type: Boolean,
      default: true,
    },
    mode: {
      type: String,
      default: "sidebar",
    },
    streamName: {
      type: String,
      default: "",
      required: false,
    },
    highlightQuery: {
      type: String,
      default: "",
      required: false,
    },
    hideViewRelated: {
      type: Boolean,
      default: false,
    },
    hideSearchTermActions: {
      type: Boolean,
      default: false,
    },
    hideFieldOptions: {
      type: Boolean,
      default: false,
    },
  },
  components: {
    NotEqualIcon,
    EqualIcon,
    AppTabs,
    LogsHighLighting,
    ChunkedContent,
    OButton,
    ODialog,
    OIcon,
    ODropdown,
    ODropdownItem,
    ODropdownSeparator,
    CodeQueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
  },
  emits: [
    "copy",
    "addSearchTerm",
    "addFieldToTable",
    "view-trace",
    "sendToAiChat",
    "closeTable",
    "show-correlation",
  ],
  setup(props: any, { emit }: any) {
    const { t } = useI18n();
    const store = useStore();
    const activeTab = ref("flattened");

    const streamSearchValue = ref<string>("");

    const { getStreams } = useStreams();

    const filteredTracesStreamOptions = ref([]);

    const router = useRouter();

    const tracesStreams = ref([]);

    const queryEditorRef = ref<any>();

    const isTracesStreamsLoading = ref(false);

    const typeOfRegexPattern = ref(false);
    const regexPatternType = ref("");

    const previewId = ref("");
    const schemaToBeSearch = ref({});
    const dropdownOpenMap = reactive<Record<string, boolean>>({});

    const $q = useQuasar();
    const unflattendData: any = ref("");
    const loading = ref(false);

    const showMenu = ref(false);
    const menuX = ref(0);
    const menuY = ref(0);
    const selectedText = ref("");

    const tabs = [
      {
        value: "flattened",
        label: t("search.flattened"),
        icon: AlignLeft,
      },
      {
        value: "unflattened",
        label: t("search.original"),
        icon: FileJson,
      },
    ];

    const copyLogToClipboard = () => {
      emit(
        "copy",
        activeTab.value === "unflattened"
          ? JSON.parse(unflattendData.value)
          : props.value,
      );
    };
    const addSearchTerm = (
      field: string,
      field_value: string | number | boolean,
      action: string,
    ) => {
      emit("addSearchTerm", field, field_value, action);
    };
    const addFieldToTable = (value: string) => {
      emit("addFieldToTable", value);
    };
    const { searchObj, searchAggData } = searchState();

    // Cross-linking: get all matching cross-links for a field using result_schema data
    const getCrossLinksForField = (
      fieldName: string,
    ): Array<{ name: string; resolvedUrl: string }> => {
      if (!store.state.zoConfig?.enable_cross_linking) return [];

      const crossLinks = searchObj.data.crossLinks;
      if (!crossLinks) return [];

      const { stream_links = [], org_links = [] } = crossLinks;

      // Build alias→original map
      const aliasToOriginal: Record<string, string> = {};
      for (const link of [...stream_links, ...org_links]) {
        for (const f of link.fields || []) {
          if (f.alias) aliasToOriginal[f.alias] = f.name;
        }
      }

      const originalFieldName = aliasToOriginal[fieldName] || fieldName;
      const fieldValue = props.value?.[fieldName];

      const streamCoveredFields = new Set<string>();
      for (const link of stream_links) {
        for (const f of link.fields || []) {
          if (f.alias) streamCoveredFields.add(f.name);
        }
      }

      const results: Array<{ name: string; resolvedUrl: string }> = [];

      for (const link of stream_links) {
        if (
          link.fields?.some((f: any) => f.name === originalFieldName && f.alias)
        ) {
          const resolved = resolveCrossLinkUrl(
            link.url,
            originalFieldName,
            fieldValue,
          );
          results.push({ name: link.name, resolvedUrl: resolved });
        }
      }

      if (!streamCoveredFields.has(originalFieldName)) {
        for (const link of org_links) {
          if (
            link.fields?.some(
              (f: any) => f.name === originalFieldName && f.alias,
            )
          ) {
            const resolved = resolveCrossLinkUrl(
              link.url,
              originalFieldName,
              fieldValue,
            );
            results.push({ name: link.name, resolvedUrl: resolved });
          }
        }
      }

      return results;
    };

    const resolveCrossLinkUrl = (
      urlTemplate: string,
      fieldName: string,
      fieldValue: any,
    ): string => {
      const startTime = searchObj.data.datetime?.startTime || 0;
      const endTime = searchObj.data.datetime?.endTime || 0;
      const query = searchObj.data.crossLinkQuery || searchObj.data.query || "";

      return urlTemplate
        .replace(/\$\{field\.__name\}/g, encodeURIComponent(String(fieldName)))
        .replace(
          /\$\{field\.__value\}/g,
          encodeURIComponent(String(fieldValue ?? "")),
        )
        .replace(/\$\{start_time\}/g, String(startTime))
        .replace(/\$\{end_time\}/g, String(endTime))
        .replace(/\$\{query\}/g, encodeURIComponent(query))
        .replace(/\$\{query_encoded\}/g, btoa(query));
    };

    // Dropdown state for multi-link fields
    const crossLinkDropdownVisible = ref(false);
    const crossLinkDropdownX = ref(0);
    const crossLinkDropdownY = ref(0);
    const crossLinkDropdownItems = ref<
      Array<{ name: string; resolvedUrl: string }>
    >([]);

    const onCrossLinkClick = (event: MouseEvent, fieldName: string) => {
      const links = getCrossLinksForField(fieldName);
      if (links.length === 0) return;

      if (links.length === 1) {
        window.open(links[0].resolvedUrl, "_blank");
        return;
      }

      crossLinkDropdownItems.value = links;
      crossLinkDropdownX.value = event.clientX;
      crossLinkDropdownY.value = event.clientY;
      crossLinkDropdownVisible.value = true;
    };

    const openCrossLink = (url: string) => {
      window.open(url, "_blank");
      crossLinkDropdownVisible.value = false;
    };
    let multiStreamFields: any = ref([]);

    const showViewTraceBtn = ref(false);
    const showViewRelatedBtn = ref(false);

    // Initialize service correlation composable
    const { isCorrelationAvailable } = useServiceCorrelation();

    // Simple check: just verify correlation feature is available
    // The actual metric availability check happens when the button is clicked (in SearchResult.vue)
    onMounted(async () => {
      try {
        // Gate correlation feature behind enterprise check to avoid 403 errors
        if (config.isEnterprise !== "true") {
          showViewRelatedBtn.value = false;
          return;
        }

        // Show button if correlation is available AND we're in detail view (sidebar or expanded)
        // AND service_streams is enabled in config
        // AND hideViewRelated prop is not set (used by DetailTable drawer to hide the button)
        // Mode can be 'sidebar' (when opened from sidebar) or 'expanded' (when log row is expanded in table)
        const isDetailView =
          props.mode === "sidebar" || props.mode === "expanded";
        const serviceStreamsEnabled =
          store.state.zoConfig.service_streams_enabled !== false; // Default to true if not set

        if (isDetailView && serviceStreamsEnabled) {
          const available = await isCorrelationAvailable();
          showViewRelatedBtn.value =
            available &&
            isDetailView &&
            serviceStreamsEnabled &&
            !props.hideViewRelated;
        }
      } catch (err) {
        console.error(
          "[JsonPreview] Error checking correlation availability:",
          err,
        );
        showViewRelatedBtn.value = false;
      }
    });

    const getTracesStreams = async () => {
      isTracesStreamsLoading.value = true;
      try {
        getStreams("traces", false)
          .then((res: any) => {
            tracesStreams.value = res.list.map((option: any) => option.name);
            filteredTracesStreamOptions.value = JSON.parse(
              JSON.stringify(tracesStreams.value),
            );

            if (!searchObj.meta.selectedTraceStream.length)
              searchObj.meta.selectedTraceStream = tracesStreams.value[0];
          })
          .catch(() => Promise.reject())
          .finally(() => {
            isTracesStreamsLoading.value = false;
          });
      } catch (err: any) {
        isTracesStreamsLoading.value = false;
        console.error("Failed to get traces streams", err);
      }
    };

    const setViewTraceBtn = () => {
      // Hide view traces button when service_streams_enabled is true
      const serviceStreamsEnabled =
        store.state.zoConfig.service_streams_enabled !== false;

      showViewTraceBtn.value =
        !store.state.hiddenMenus.has("traces") && // Check if traces menu is hidden
        !serviceStreamsEnabled && // Hide when service streams is enabled
        props.value[
          store.state.organizationData?.organizationSettings
            ?.trace_id_field_name
        ];

      if (showViewTraceBtn.value && !filteredTracesStreamOptions.value.length)
        getTracesStreams();
    };

    onBeforeMount(() => {
      setViewTraceBtn();
      updateMultiStreamFields();
      previewId.value = getUUID();
    });

    onMounted(() => {
      // Handler for closing menu on outside click
      //because when user clicks on the log content with right click, the context menu is shown and when user clicks outside the log content, the context menu is closed
      const handleOutsideClick = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest(".q-btn")) {
          showMenu.value = false;
        }
      };
      //this is used to show the context menu when user right clicks on the log content
      // Handler for context menu using event delegation
      const handleContextMenu = (e: MouseEvent) => {
        // Only handle right clicks on the log content area
        const target = e.target as HTMLElement;
        if (target.closest(".log_json_content")) {
          e.preventDefault();
          e.stopPropagation();

          const selection = window.getSelection()?.toString().trim() || "";
          selectedText.value = selection;

          // Get window width
          const windowWidth = window.innerWidth;
          // Context menu width (from CSS) plus some padding
          const menuWidth = 220;
          // Calculate if menu would overflow
          const wouldOverflow = e.clientX + menuWidth > windowWidth;

          // Position menu to the left if it would overflow, otherwise to the right
          menuX.value = wouldOverflow
            ? e.clientX - menuWidth - 5
            : e.clientX + 15;
          menuY.value = e.clientY + 15;

          showMenu.value = true;
        }
      };

      // Add event listeners
      if (config.isEnterprise == "true" && store.state.zoConfig.ai_enabled) {
        window.addEventListener("click", handleOutsideClick);
        window.addEventListener("contextmenu", handleContextMenu);
      }

      // Cleanup
      //this is used to remove the event listeners when the component is unmounted
      //it is used to avoid memory leaks
      onUnmounted(() => {
        if (config.isEnterprise == "true" && store.state.zoConfig.ai_enabled) {
          window.removeEventListener("click", handleOutsideClick);
          window.removeEventListener("contextmenu", handleContextMenu);
        }
      });
    });

    const getOriginalData = async () => {
      setViewTraceBtn();

      if (
        !props.value._o2_id ||
        searchAggData.hasAggregation ||
        searchObj.data.stream.selectedStream.length > 1
      ) {
        return;
      }
      // Check if data exists in searchObj cache
      const cacheKey = `${props.value._o2_id}_${props.value._timestamp}`;
      if (searchObj.data.originalDataCache[cacheKey]) {
        unflattendData.value = searchObj.data.originalDataCache[cacheKey];
        return;
      }

      loading.value = true;

      try {
        const { traceparent, traceId } = generateTraceContext();

        const res = await searchService.search(
          {
            org_identifier: searchObj.organizationIdentifier,
            query: {
              query: {
                sql: `SELECT _original FROM "${props.streamName ? props.streamName : searchObj.data.stream.selectedStream}" where _o2_id = ${props.value._o2_id} and _timestamp = ${props.value._timestamp}`,
                start_time: props.value._timestamp - 10 * 60 * 1000,
                end_time: props.value._timestamp + 10 * 60 * 1000,
                size: 1,
                from: 0,
                quick_mode: false,
              },
            },
            page_type: searchObj.data.stream.streamType,
            traceparent,
          },
          "ui",
        );
        const formattedData = JSON.stringify(
          JSON.parse(res.data.hits[0]._original),
          null,
          2,
        );
        unflattendData.value = formattedData;
        //store the data in cache of searchObj
        searchObj.data.originalDataCache[cacheKey] = formattedData;
      } catch (err: any) {
        loading.value = false;
        $q.notify({
          message:
            err.response?.data?.message || "Failed to get the Original data",
          color: "negative",
          position: "bottom",
          timeout: 1500,
        });
      } finally {
        loading.value = false;
      }
    };

    const updateMultiStreamFields = () => {
      searchObj.data.stream.selectedStreamFields.forEach((item: any) => {
        if (
          item.streams?.length == searchObj.data.stream.selectedStream.length
        ) {
          multiStreamFields.value.push(item.name);
        }
      });
    };

    watch(activeTab, async () => {
      if (activeTab.value === "unflattened") {
        unflattendData.value = "";
        await getOriginalData();
      }
    });

    watch(
      () => searchObj.data.stream.selectedStreamFields,
      () => {
        updateMultiStreamFields();
      },
      {
        deep: true,
      },
    );

    const filterStreamFn = (val: any = "") => {
      filteredTracesStreamOptions.value = tracesStreams.value.filter(
        (stream: any) => {
          return stream.toLowerCase().indexOf(val.toLowerCase()) > -1;
        },
      );
    };

    const redirectToTraces = () => {
      emit("view-trace");
    };

    const openCorrelation = () => {
      emit("show-correlation", props.value);
    };

    const handleTabChange = async () => {
      if (activeTab.value === "unflattened") {
        await nextTick();
        if (!loading.value) {
          queryEditorRef.value.formatDocument();
        }
      }
    };

    const filteredTabs = computed(() => {
      return tabs.filter((tab) => {
        if (
          props.value._o2_id == undefined ||
          searchAggData.hasAggregation ||
          searchObj.data.stream.selectedStream.length > 1
        ) {
          return false;
        }
        return true;
      });
    });
    const addOrRemoveLabel = (key: string) => {
      if (searchObj.data.stream.selectedFields.includes(key)) {
        return t("common.removeFieldFromTable");
      }
      return t("common.addFieldToTable");
    };

    const sendToAiChat = (value: string, append: boolean = true) => {
      emit("closeTable");
      emit("sendToAiChat", value, append);
    };

    const getBtnLogo = computed(() => {
      return store.state.theme === "dark"
        ? getImageURL("images/common/ai_icon_dark.svg")
        : getImageURL("images/common/ai_icon_gradient.svg");
    });
    const regexIcon = computed(() => {
      return getImageURL(
        store.state.theme == "dark"
          ? "images/regex_pattern/regex_icon_dark.svg"
          : "images/regex_pattern/regex_icon_light.svg",
      );
    });
    const regexIconForContextMenu = computed(() => {
      return getImageURL(
        store.state.theme == "dark"
          ? "images/regex_pattern/regex_icon_dark.svg"
          : "images/regex_pattern/regex_icon_light.svg",
      );
    });

    const createRegexPatternFromLogs = (key: string, value: string) => {
      emit("closeTable");
      const promptToBeAdded = `Create a regex pattern for ${key} field that contains the following value: "${value}" from the ${searchObj.data.stream.selectedStream[0]} stream`;

      router.push({
        path: "/settings/regex_patterns",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          from: "logs",
        },
      });
      store.state.organizationData.regexPatternPrompt = promptToBeAdded;
      store.state.organizationData.regexPatternTestValue = value;
      emit("sendToAiChat", promptToBeAdded);
    };

    const handleCreateRegex = () => {
      showMenu.value = false;
      typeOfRegexPattern.value = true;
    };

    const confirmRegexPatternType = () => {
      typeOfRegexPattern.value = false;
      emit("closeTable");
      // inputMessage.value = `Create a regex pattern for ${store.state.organizationData.customRegexPatternFromLogs.key} field that contains the following value: "${store.state.organizationData.customRegexPatternFromLogs.value}" which should be a type of ${store.state.organizationData.customRegexPatternFromLogs.type} from the ${store.state.organizationData.customRegexPatternFromLogs.stream} stream`;

      const PromptToBeAdded = `Create a regex pattern for the following value: "${selectedText.value}" which should be a type of ${regexPatternType.value} from the ${searchObj.data.stream.selectedStream[0]} stream`;

      store.state.organizationData.regexPatternPrompt = PromptToBeAdded;
      store.state.organizationData.regexPatternTestValue = selectedText.value;
      router.push({
        path: "/settings/regex_patterns",
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          from: "logs",
        },
      });
      emit("sendToAiChat", PromptToBeAdded);
    };

    const copySelectedText = () => {
      if (selectedText.value) {
        navigator.clipboard
          .writeText(selectedText.value)
          .then(() => {
            showMenu.value = false;
            $q.notify({
              message: "Text copied to clipboard",
              color: "positive",
              position: "bottom",
              timeout: 1500,
            });
          })
          .catch(() => {
            $q.notify({
              message: "Failed to copy text",
              color: "negative",
              position: "bottom",
              timeout: 1500,
            });
          });
      }
    };

    const getContentSize = (data: any): number => {
      if (data === null || data === undefined) return 0;
      if (typeof data === "string") return data.length;
      if (typeof data === "object") {
        try {
          return JSON.stringify(data).length;
        } catch {
          return 0;
        }
      }
      return String(data).length;
    };

    return {
      t,
      copyLogToClipboard,
      getImageURL,
      addSearchTerm,
      addFieldToTable,
      dropdownOpenMap,
      store,
      searchObj,
      multiStreamFields,
      redirectToTraces,
      openCorrelation,
      filteredTracesStreamOptions,
      filterStreamFn,
      streamSearchValue,
      activeTab,
      showViewTraceBtn,
      showViewRelatedBtn,
      queryEditorRef,
      previewId,
      loading,
      unflattendData,
      schemaToBeSearch,
      filteredTabs,
      handleTabChange,
      isTracesStreamsLoading,
      tracesStreams,
      setViewTraceBtn,
      getOriginalData,
      getTracesStreams,
      addOrRemoveLabel,
      sendToAiChat,
      getBtnLogo,
      config,
      regexIcon,
      createRegexPatternFromLogs,
      showMenu,
      menuX,
      menuY,
      selectedText,
      handleCreateRegex,
      copySelectedText,
      regexIconForContextMenu,
      typeOfRegexPattern,
      regexPatternType,
      confirmRegexPatternType,
      getContentSize,
      getCrossLinksForField,
      openCrossLink,
    };
  },
};
</script>

<style lang="scss" scoped>
@import "@/styles/logs/json-preview.scss";

// No custom cross-link CSS needed — cross-links render as q-items inside existing q-btn-dropdown
</style>
