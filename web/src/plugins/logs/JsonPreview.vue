<template>
  <div class="q-py-xs flex justify-start q-px-md log-detail-actions">
    <q-btn
      :label="t('common.copyToClipboard')"
      dense
      size="sm"
      no-caps
      class="q-px-sm copy-log-btn q-mr-sm"
      icon="content_copy"
      @click="copyLogToClipboard"
    />

    <div class="o2-input flex items-center logs-trace-selector">
      <q-select
        data-test="log-search-index-list-select-stream"
        v-model="searchObj.meta.selectedTraceStream"
        :label="
          searchObj.meta.selectedTraceStream ? '' : t('search.selectIndex')
        "
        :options="filteredStreamOptions"
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
        data-test="trace-view-logs-btn"
        v-close-popup="true"
        class="text-bold traces-view-logs-btn q-px-sm view-trace-btn"
        :label="t('search.viewTrace')"
        text-color="light-text"
        padding="sm sm"
        size="xs"
        no-caps
        dense
        :icon="outlinedAccountTree"
        @click="redirectToTraces"
      />
    </div>
  </div>
  <div class="q-pl-md">
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
      >
        <q-list>
          <q-item
            clickable
            v-close-popup
            v-if="searchObj.data.stream.selectedStreamFields.some(
                                (item: any) =>
                                  item.name === key
                                    ? item.isSchemaField
                                    : ''
                              )
                              && multiStreamFields.includes(key)
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
            v-if="searchObj.data.stream.selectedStreamFields.some(
                                (item: any) =>
                                  item.name === key
                                    ? item.isSchemaField
                                    : ''
                              )
                              && multiStreamFields.includes(key)
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

      <span class="q-pl-xs">
        <span
          :class="store.state.theme === 'dark' ? 'text-red-5' : 'text-red-10'"
          >{{ key }}:</span
        ><span class="q-pl-xs"
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
</template>

<script lang="ts">
import { defineComponent, ref, onBeforeMount } from "vue";
import { getImageURL } from "@/utils/zincutils";
import { useStore } from "vuex";
import EqualIcon from "@/components/icons/EqualIcon.vue";
import NotEqualIcon from "@/components/icons/NotEqualIcon.vue";
import { useI18n } from "vue-i18n";
import useLogs from "../../composables/useLogs";
import { outlinedAccountTree } from "@quasar/extras/material-icons-outlined";
import { useRouter } from "vue-router";
import useStreams from "@/composables/useStreams";

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
  },
  components: { NotEqualIcon, EqualIcon },
  emits: ["copy", "addSearchTerm", "addFieldToTable"],
  setup(props: any, { emit }: any) {
    const { t } = useI18n();
    const store = useStore();

    const streamSearchValue = ref<string>("");

    const { getStreams } = useStreams();

    const filteredStreamOptions = ref([]);

    const tracesStreams = ref([]);

    const router = useRouter();
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
      getTracesStreams();
    });

    const getTracesStreams = async () => {
      await getStreams("traces", false)
        .then((res: any) => {
          tracesStreams.value = res.list.map((option: any) => option.name);
          filteredStreamOptions.value = JSON.parse(
            JSON.stringify(tracesStreams.value)
          );

          console.log("tracesStreams", tracesStreams.value);

          if (!searchObj.meta.selectedTraceStream.length)
            searchObj.meta.selectedTraceStream = tracesStreams.value[0];
        })
        .catch(() => Promise.reject())
        .finally(() => {});
    };

    const filterStreamFn = (val: any = "") => {
      filteredStreamOptions.value = tracesStreams.value.filter(
        (stream: any) => {
          return stream.toLowerCase().indexOf(val.toLowerCase()) > -1;
        }
      );
    };

    const redirectToTraces = () => {
      emit("view-trace");
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
      filteredStreamOptions,
      filterStreamFn,
      streamSearchValue,
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
        color: #343434;
      }
    }
  }
}
</style>
