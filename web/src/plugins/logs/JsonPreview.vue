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
        v-if="showViewTraceBtn && filteredTracesStreamOptions.length"
        class="o2-input flex items-center logs-trace-selector"
      >
        <q-select
          data-test="log-search-index-list-select-stream"
          v-model="searchObj.meta.selectedTraceStream"
          :label="
            searchObj.meta.selectedTraceStream ? '' : t('search.selectIndex')
          "
          :options="filteredTracesStreamOptions"
          data-cy="stream-selection"
          input-debounce="0"
          behavior="menu"
          filled
          size="xs"
          borderless
          dense
          fill-input
          :title="searchObj.meta.selectedTraceStream"
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
          :label="t('common.copyToClipboard')"
          dense
          size="sm"
          no-caps
          class="q-px-sm"
          icon="content_copy"
          @click="copyLogToClipboard"
        />
      </div>
    </div>
    <div v-show="activeTab === 'unflattened' " class="q-pl-md">
      <query-editor
        v-model:query="nestedJson"
        ref="queryEditorRef"
        :editor-id="`logs-json-preview-unflattened-json-editor-${previewId}`"
        class="monaco-editor"
        :class="mode"
        language="json"
      />
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
                  @click.stop="addSearchTerm(`${key}='${value[key]}'`)"
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
                  @click.stop="addSearchTerm(`${key}!='${value[key]}'`)"
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
                  >{{ t("common.addFieldToTable") }}</q-item-label
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
    </div>
  </div>
</template>

<script lang="ts">
import { ref, onBeforeMount, computed, nextTick } from "vue";
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
  },
  components: {
    NotEqualIcon,
    EqualIcon,
  },
  emits: ["copy", "addSearchTerm", "addFieldToTable", "view-trace"],
  setup(props: any, { emit }: any) {
    const { t } = useI18n();
    const store = useStore();

    const streamSearchValue = ref<string>("");

    const { getStreams , getStream} = useStreams();

    const filteredTracesStreamOptions = ref([]);

    const tracesStreams = ref([]);

    const queryEditorRef = ref<any>();

    const previewId = ref("");
    const schemaToBeSearch = ref({});

    const nestedJson = ref("");
    const storeOriginalDataVar = ref(false);

    const tabs = [
      {
        value: "flattened",
        label: t("search.flattened"),
      },
      {
        value: "unflattened",
        label: t("search.unflattened"),
      },
    ];

    const copyLogToClipboard = () => {
      emit("copy", props.value);
    };
    const addSearchTerm = (value: string) => {
      emit("addSearchTerm", value);
    };
    const addFieldToTable = (value: string) => {
      emit("addFieldToTable", value);
    };
    const { searchObj } = useLogs();
    let multiStreamFields: any = ref([]);

    onBeforeMount(() => {
      searchObj.data.stream.selectedStreamFields.forEach((item: any) => {
        if (
          item.streams.length == searchObj.data.stream.selectedStream.length
        ) {
          multiStreamFields.value.push(item.name);
        }
      });
      if (showViewTraceBtn.value) getTracesStreams();
      previewId.value = getUUID();
    });

    onMounted(async () => {
      await updateStoreOriginalData();
      if(checkIsOriginalData() && !storeOriginalDataVar.value){
        nestedJson.value = getNestedJson();
      }
      
    });

    watch(
      () => props.value,
      // if(store.state.zoConfig.unflatten_data_enabled )
    
      async () =>  {
       
        await updateStoreOriginalData();
        if(checkIsOriginalData()  && !storeOriginalDataVar.value){
        nestedJson.value = getNestedJson();
      }
      else{
        const {traceparent,traceId} = generateTraceContext();
        searchService
        .search(
          {
            org_identifier: searchObj.organizationIdetifier,
            query: {
              "query":{
                "start_time":props.value._timestamp - 10 * 60 * 1000,
                "sql":`SELECT _original FROM "${searchObj.data.stream.selectedStream}" where _timestamp = ${props.value._timestamp} and _o2_id = ${props.value._o2_id}`,
    
              "end_time": props.value._timestamp + 10 * 60 * 1000,
              'sql_mode':"full",
              "size":1,
              "from":0,
              "quick_mode":false,
              }

            },
            page_type: searchObj.data.stream.streamType,
            traceparent,
          },
          "UI",
        ).then((res: any) => {

          nestedJson.value = res?.data?.hits[0]._original;
        }).catch((err: any) => {
          console.log("err", err);
        })
      }
      },
    );

    
//     watch(
//   () => [searchObj.data.stream.selectedStream, searchObj.data.stream.streamType],
//   async () => {
//   }
// );

    const getTracesStreams = async () => {
      await getStreams("traces", false)
        .then((res: any) => {

          tracesStreams.value = res.list.map((option: any) => option.name);
          filteredTracesStreamOptions.value = JSON.parse(
            JSON.stringify(tracesStreams.value),
          );

          if (!searchObj.meta.selectedTraceStream.length)
            searchObj.meta.selectedTraceStream = tracesStreams.value[0];
        })
        .catch(() => Promise.reject())
        .finally(() => {});
    };



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

    const showViewTraceBtn = computed(() => {
      return (
        !store.state.hiddenMenus.has("traces") && // Check if traces menu is hidden
        props.value[
          store.state.organizationData?.organizationSettings
            ?.trace_id_field_name
        ] // Check if trace_id_field_name is available in the log fields
      );
    });

    const getNestedJson = () => {
  const result = {};
  try {
    Object.keys(props.value).forEach((key) => {
      let keys = key.split("_");
      // Handle keys that start with underscores
      let keyWithPrefix = "";
      for (let i = 0; i < keys.length; i++) {
        if (keys[i] === "") {
          keyWithPrefix += "_";
        } else {
          if (keyWithPrefix.length) {
            keyWithPrefix += keys[i];
            keys[i] = keyWithPrefix;
            keyWithPrefix = "";
          }
        }
      }
      keys = keys.filter((k) => k !== "");
      type NestedObject = {
        [key: string]: NestedObject | any;
      };
      // Reduce the keys to create nested objects
      keys.reduce((acc: NestedObject, k: string, index: number) => {
        if (index === keys.length - 1) {
          // Last key in the sequence
          if (k in acc) {
            // If key already exists, move existing value to `outerText`
            if (typeof acc[k] === 'string') {
              acc[k] = {
                outerText: acc[k],
              };
            }
            acc[k] = {
              ...acc[k],
              [k]: props.value[key],
            };
          } else {
            acc[k] = props.value[key];
          }
        } else {
          // Intermediate keys
          if (!(k in acc)) {
            acc[k] = {};
          } else if (typeof acc[k] === 'string') {
            // If an existing key is a string, move it to `outerText`
            acc[k] = {
              outerText: acc[k],
            };
          }
        }
        return acc[k];
      }, result);
    });
  } catch (e) {
    console.log("Error in getNestedJson", e);
  }
  return JSON.stringify(result);
};


const checkIsOriginalData = () => {
  if(storeOriginalDataVar.value || store.state.zoConfig.unflatten_data_enabled) {
    return true;
  }
  return false;
}

    const handleTabChange = async () => {
      if (activeTab.value === "unflattened") {
        await nextTick();
        queryEditorRef.value.formatDocument();
      }
    };
    async function updateStoreOriginalData() {
          try {
            // Call getStream with the appropriate parameters
            const streamData = await getStream(searchObj.data.stream.selectedStream, searchObj.data.stream.streamType, false);

            schemaToBeSearch.value = streamData?.schema;
          // Extract the store_original_data from the settings
            const storeOriginalData = streamData?.settings?.store_original_data;

            // Assign it to the desired variable (e.g., in a reactive property or state)
            storeOriginalDataVar.value = storeOriginalData;
          } catch (error) {
            console.error('Error fetching stream data:', error);
          }
}
  const filteredTabs = computed(() => {
        return tabs.filter(tab => {
          // Only include the 'Unflattened' tab if checkIsOriginalData() returns true
          if (!checkIsOriginalData() && (tab.value === 'unflattened' || tab.value === 'flattened')) {
          return false;
        }
          return true;
        });
      });

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
      showViewTraceBtn,
      nestedJson,
      handleTabChange,
      storeOriginalDataVar,
      queryEditorRef,
      previewId,
      schemaToBeSearch,
      updateStoreOriginalData,
      checkIsOriginalData,
      filteredTabs,
    };
  },
};
</script>

<style lang="scss" scoped>
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
</style>
