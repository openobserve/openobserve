<template>
  <div>
    <div class="q-pb-xs flex justify-start q-px-md copy-log-btn">
      <app-tabs
        class="logs-json-preview-tabs q-mr-sm"
        style="border: 1px solid #8a8a8a; border-radius: 4px; overflow: hidden"
        data-test="logs-json-preview-tabs"
        :tabs="filteredTabs"
        v-model:active-tab="activeTab"
        @update:active-tab="handleTabChange"
      />

      <q-btn
        :label="t('common.copyToClipboard')"
        dense
        size="sm"
        no-caps
        class="q-px-sm copy-log-btn q-mr-sm"
        icon="content_copy"
        @click="copyLogToClipboard"
      />
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
        <q-btn
          data-test="trace-view-logs-btn"
          v-close-popup="true"
          class="text-bold traces-view-logs-btn q-px-sm view-trace-btn"
          :label="t('search.viewTrace')"
          padding="sm sm"
          size="xs"
          no-caps
          dense
          :icon="outlinedAccountTree"
          @click="redirectToTraces"
        />
      </div>
    </div>
    <div v-show="activeTab === 'unflattened'" class="q-pl-md">
      <q-spinner-hourglass v-if="loading" size="lg" color="primary" />
      <div v-if="!loading">
      <query-editor
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
        <q-btn-dropdown
          data-test="log-details-include-exclude-field-btn"
          size="0.5rem"
          flat
          outlined
          filled
          dense
          class="q-ml-sm pointer"
          :name="'img:' + getImageURL('images/common/add_icon.svg')"
          aria-label="Add icon"
        >
          <q-list>
            <q-item
              clickable
              v-close-popup
              v-if="
                searchObj.data.stream.selectedStreamFields.some((item: any) =>
                  item.name === key ? item.isSchemaField : '',
                ) && multiStreamFields.includes(key)
              "
            >
              <q-item-section>
                <q-item-label
                  data-test="log-details-include-field-btn"
                  @click.stop="addSearchTerm(key, value[key], 'include')"
                  v-close-popup
                  ><q-btn
                    title="Add to search query"
                    size="6px"
                    round
                    class="q-mr-sm pointer"
                  >
                    <q-icon color="currentColor">
                      <EqualIcon></EqualIcon>
                    </q-icon> </q-btn
                  >{{ t("common.includeSearchTerm") }}</q-item-label
                >
              </q-item-section>
            </q-item>

            <q-item
              clickable
              v-close-popup
              v-if="
                searchObj.data.stream.selectedStreamFields.some((item: any) =>
                  item.name === key ? item.isSchemaField : '',
                ) && multiStreamFields.includes(key)
              "
            >
              <q-item-section>
                <q-item-label
                  data-test="log-details-exclude-field-btn"
                  @click.stop="addSearchTerm(key, value[key], 'exclude')"
                  v-close-popup
                  ><q-btn
                    title="Add to search query"
                    size="6px"
                    round
                    class="q-mr-sm pointer"
                  >
                    <q-icon color="currentColor">
                      <NotEqualIcon></NotEqualIcon>
                    </q-icon> </q-btn
                  >{{ t("common.excludeSearchTerm") }}</q-item-label
                >
              </q-item-section>
            </q-item>
            <q-item clickable v-close-popup>
              <q-item-section>
                <q-item-label
                  data-test="log-details-add-field-btn"
                  @click.stop="addFieldToTable(key)"
                  v-close-popup
                  ><q-btn
                    title="Add field to table"
                    icon="visibility"
                    size="6px"
                    round
                    class="q-mr-sm pointer"
                  ></q-btn
                  >{{addOrRemoveLabel(key)}}</q-item-label
                >
              </q-item-section>
            </q-item>
            <q-item clickable v-close-popup>
              <q-item-section>
                <q-item-label
                  data-test="redirect-to-regex-pattern-btn"
                  @click.stop="createRegexPatternFromLogs(key,value[key])"
                  v-close-popup
                  ><q-btn
                    title="Add field to table"
                    size="6px"
                    round
                    class="q-mr-sm pointer"
                  >
                  <q-img height="14px" width="14px" :src="regexIcon" />
                  </q-btn
                  >{{t('regex_patterns.create_regex_pattern_field')}}</q-item-label
                >
              </q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>

        <span class="q-pl-xs" :data-test="`log-expand-detail-key-${key}`">
          <span
            :class="store.state.theme === 'dark' ? 'text-red-5' : 'text-red-10'"
            :data-test="`log-expand-detail-key-${key}-text`"
            >{{ key }}:</span
          ><span class="q-pl-xs" :data-test="`log-expand-detail-value-${key}`"
            ><template v-if="index < Object.keys(value).length - 1"
              >{{ value[key] }},</template
            >
            <template v-else>
              {{ value[key] }}
            </template>
          </span>
        </span>
      </div>
      }
      <div
        v-if="showMenu"
        class="context-menu shadow-lg rounded-sm"
        :style="{ position: 'fixed', top: `${menuY}px`, left: `${menuX}px`, zIndex: 9999 }"
        :class="store.state.theme === 'dark' ? 'context-menu-dark' : 'context-menu-light'"
      >
        <div class="context-menu-item" @click="copySelectedText">
          <q-icon name="content_copy" size="xs" class="q-mr-sm" />
          Copy
        </div>
        <div class="context-menu-item" @click="handleCreateRegex">
          <q-img 
            :src="regexIconForContextMenu" 
            class="q-mr-sm" 
            style="width: 14px; height: 14px;"
          />
          Create regex pattern
        </div>
      </div>

    </div>
    <q-dialog v-if="config.isEnterprise == 'true'" v-model="typeOfRegexPattern">
      <q-card style="width: 700px; max-width: 80vw">
        <q-card-section>
          <div class="text-h6">What is the type of regex pattern you want to create?</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <div>
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
          </div>
        </q-card-section>

        <q-card-actions align="right">
          <q-btn
            data-test="search-scheduler-max-records-cancel-btn"
            unelevated
            no-caps
            class="q-mr-sm text-bold"
            :label="t('confirmDialog.cancel')"
            v-close-popup
          />
          <q-btn
            data-test="search-scheduler-max-records-submit-btn"
            unelevated
            no-caps
            :label="t('confirmDialog.ok')"
            color="secondary"
            class="text-bold"
            @click="confirmRegexPatternType"
            v-close-popup
          />
        </q-card-actions>
      </q-card>
    </q-dialog>

  </div>
  
</template>

<script lang="ts">
import { ref, onBeforeMount, computed, nextTick, onMounted, watch, onUnmounted } from "vue";
import { getImageURL, getUUID } from "@/utils/zincutils";
import { useStore } from "vuex";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { useI18n } from "vue-i18n";
import useLogs from "../../composables/useLogs";
import { outlinedAccountTree } from "@quasar/extras/material-icons-outlined";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";
import AppTabs from "@/components/common/AppTabs.vue";
import searchService from "@/services/search";
import { generateTraceContext } from "@/utils/zincutils";
import { defineAsyncComponent } from "vue";
import { is, useQuasar } from "quasar";
import { load } from "rudder-sdk-js";
import config from "@/aws-exports";

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
  },
  components: {
    NotEqualIcon,
    EqualIcon,
    AppTabs,
    QueryEditor: defineAsyncComponent(
      () => import("@/components/QueryEditor.vue"),
    ),
  },
  emits: ["copy", "addSearchTerm", "addFieldToTable", "view-trace"],
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
    const regexPatternType = ref('');

    const previewId = ref("");
    const schemaToBeSearch = ref({});

    const $q = useQuasar();
    const unflattendData: any = ref("");
    const loading = ref(false);

    const showMenu = ref(false);
    const menuX = ref(0);
    const menuY = ref(0);
    const selectedText = ref('');

    const tabs = [
      {
        value: "flattened",
        label: t("search.flattened"),
      },
      {
        value: "unflattened",
        label: t("search.original"),
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
    const { searchObj, searchAggData } = useLogs();
    let multiStreamFields: any = ref([]);

    const showViewTraceBtn = ref(false);

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
      showViewTraceBtn.value =
        !store.state.hiddenMenus.has("traces") && // Check if traces menu is hidden
        props.value[
          store.state.organizationData?.organizationSettings
            ?.trace_id_field_name
        ];

      if (showViewTraceBtn.value && !filteredTracesStreamOptions.value.length)
        getTracesStreams();
    };

    onBeforeMount(() => {
      searchObj.data.stream.selectedStreamFields.forEach((item: any) => {
        if (
          item.streams?.length == searchObj.data.stream.selectedStream.length
        ) {
          multiStreamFields.value.push(item.name);
        }
      });
      setViewTraceBtn();

      previewId.value = getUUID();
    });


    onMounted(() => {
      // Handler for closing menu on outside click
      //because when user clicks on the log content with right click, the context menu is shown and when user clicks outside the log content, the context menu is closed
      const handleOutsideClick = (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('.q-btn')) {
          showMenu.value = false;
        }
      };
      //this is used to show the context menu when user right clicks on the log content
      // Handler for context menu using event delegation
      const handleContextMenu = (e: MouseEvent) => {
        // Only handle right clicks on the log content area
        const target = e.target as HTMLElement;
        if (target.closest('.log_json_content')) {
          e.preventDefault();
          e.stopPropagation();

          const selection = window.getSelection()?.toString().trim() || '';
          selectedText.value = selection;

          // Get window width
          const windowWidth = window.innerWidth;
          // Context menu width (from CSS) plus some padding
          const menuWidth = 220;
          // Calculate if menu would overflow
          const wouldOverflow = e.clientX + menuWidth > windowWidth;

          // Position menu to the left if it would overflow, otherwise to the right
          menuX.value = wouldOverflow ? e.clientX - menuWidth - 5 : e.clientX + 15;
          menuY.value = e.clientY + 15;

          showMenu.value = true;
        }
      };

      // Add event listeners
      if(config.isEnterprise == 'true'){
        window.addEventListener('click', handleOutsideClick);
        window.addEventListener('contextmenu', handleContextMenu);
      }

      // Cleanup
      //this is used to remove the event listeners when the component is unmounted 
      //it is used to avoid memory leaks
      onUnmounted(() => {
        if(config.isEnterprise == 'true'){
          window.removeEventListener('click', handleOutsideClick);
          window.removeEventListener('contextmenu', handleContextMenu);
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
        if (searchObj.data.originalDataCache?.has(cacheKey)) {
          unflattendData.value = searchObj.data.originalDataCache.get(cacheKey);
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
                  start_time: props.value._timestamp - 10 * 60 * 1000,
                  sql: `SELECT _original FROM "${props.streamName ?  props.streamName : searchObj.data.stream.selectedStream }" where _o2_id = ${props.value._o2_id} and _timestamp = ${props.value._timestamp}`,
                  end_time: props.value._timestamp + 10 * 60 * 1000,
                  sql_mode: "full",
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
          const formattedData = JSON.stringify(JSON.parse(res.data.hits[0]._original), null, 2);
          unflattendData.value = formattedData;
          //store the data in cache of searchObj
          searchObj.data.originalDataCache.set(cacheKey, formattedData);
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

      watch(activeTab, async () => {
        if (activeTab.value === "unflattened") {
          unflattendData.value = "";
          await getOriginalData();
        }
      });

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

    const handleTabChange = async () => {
      if (activeTab.value === "unflattened") {
        await nextTick();
        if(!loading.value) {
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
      if(searchObj.data.stream.selectedFields.includes(key)) {
        return t("common.removeFieldFromTable");
      }
      return t("common.addFieldToTable");
    };
      const regexIcon = computed(()=>{
        return getImageURL(store.state.theme == 'dark' ? 'images/regex_pattern/regex_icon_dark.svg' : 'images/regex_pattern/regex_icon_light.svg')
      })
      const regexIconForContextMenu = computed(()=>{
        return getImageURL(store.state.theme == 'dark' ? 'images/regex_pattern/regex_icon_dark.svg' : 'images/regex_pattern/regex_icon_light.svg')
      })

    const createRegexPatternFromLogs = (key: string, value: string) => {
      store.state.organizationData.regexPatternFromLogs.key = key;
      store.state.organizationData.regexPatternFromLogs.value = value;
      store.state.organizationData.regexPatternFromLogs.stream = searchObj.data.stream.selectedStream[0];
      router.push({
        path: '/settings/regex_patterns',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          from: 'logs'
        },
      })

    }

    const handleCreateRegex = () => {
      console.log('Create regex for:', selectedText.value || 'No selection');
      showMenu.value = false;
      typeOfRegexPattern.value = true;
    };

    const confirmRegexPatternType = () => {
      typeOfRegexPattern.value = false;
      store.state.organizationData.customRegexPatternFromLogs.key = regexPatternType.value;
      store.state.organizationData.customRegexPatternFromLogs.value = selectedText.value;
      store.state.organizationData.customRegexPatternFromLogs.stream = searchObj.data.stream.selectedStream[0];
      store.state.organizationData.customRegexPatternFromLogs.type = regexPatternType.value;
      $q.notify({
        message: 'Redirecting to regex pattern page',
        spinner: true,
        timeout: 1000
      }
      )
      setTimeout(() => {
      router.push({
        path: '/settings/regex_patterns',
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          from: 'logs'
        },
      })
    }, 1000);
    }



    const copySelectedText = () => {
      if (selectedText.value) {
        navigator.clipboard.writeText(selectedText.value).then(() => {
          showMenu.value = false;
          $q.notify({
            message: 'Text copied to clipboard',
            color: 'positive',
            position: 'bottom',
            timeout: 1500
          });
        }).catch(() => {
          $q.notify({
            message: 'Failed to copy text',
            color: 'negative',
            position: 'bottom',
            timeout: 1500
          });
        });
      }
    };

    return {
      t,
      copyLogToClipboard,
      getImageURL,
      addSearchTerm,
      addFieldToTable,
      outlinedAccountTree,
      store,
      searchObj,
      multiStreamFields,
      redirectToTraces,
      filteredTracesStreamOptions,
      filterStreamFn,
      streamSearchValue,
      activeTab,
      showViewTraceBtn,
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
      addOrRemoveLabel,
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
      config
    };
  },
};
</script>

<style lang="scss" scoped>
.monaco-editor {
  --vscode-focusBorder: #515151 !important;
}
.log_json_content {
  white-space: pre-wrap;
  font-family: monospace;
  font-size: 12px;
}
.monaco-editor {
  width: calc(100% - 16px) !important;
  height: calc(100vh - 250px) !important;

  &.expanded {
    height: 300px !important;
    max-width: 1024px !important;
  }
}
</style>

<style lang="scss">
.logs-trace-selector {
  .q-select {
    .q-field__control {
      min-height: 30px !important;
      height: 30px !important;
      padding: 0px 8px !important;
      width: 220px !important;

      .q-field,
      .q-field__native {
        span {
          display: inline-block;
          width: 180px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          text-align: left;
          font-weight: 400;
        }
      }

      .q-field__append {
        height: 27px !important;
      }
    }
  }

  .q-btn {
    height: 30px !important;
    padding: 2px 8px !important;
    margin-left: -1px;

    .q-btn__content {
      span {
        font-size: 11px;
        font-weight: 400;
      }
    }
  }
}

.logs-json-preview-tabs {
  height: fit-content;
  .rum-tab {
    width: fit-content !important;
    padding: 2px 12px !important;
    border: none !important;
    font-size: 12px !important;

    &.active {
      background: #5960b2;
      color: #ffffff !important;
    }
  }
}

.context-menu {
  min-width: 200px;
  padding: 4px 0;
  font-size: 13px;

  .context-menu-item {
    padding: 6px 12px;
    display: flex;
    align-items: center;
    cursor: pointer;
    transition: background-color 0.2s;
  }
}


.context-menu-dark {
  background-color: #1a1a1a;
  border: 1px solid #4a5568;
  .context-menu-item {
    color: #e2e8f0;
    &:hover {
      background-color: #4a5568;
    }
  }
}
.context-menu-light {
  background-color: #ffffff;
  border: 1px solid #e2e8f0;
  .context-menu-item {
    &:hover {
      background-color: #f3f4f6;
    }
  }
}
</style>
