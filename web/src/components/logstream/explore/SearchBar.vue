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
    data-test="logstream-explore-search-bar-container"
    class="pb-px h-full overflow-hidden"
    id="searchBarComponent"
  >
    <div class="flex flex justify-end">
      <div class="my-1">
        <OButton
          class="mr-2"
          variant="ghost"
          size="sm"
          :disabled="
            queryData.queryResults.hasOwnProperty('hits') &&
            !queryData.queryResults.hits.length
          "
          :title="t('search.exportLogs')"
          @click="downloadLogs"
          icon-left="download"
        />
        <div
          class="float-left"
          v-show="queryData.streamType !== 'enrichment_tables'"
        >
          <date-time
            data-test="logs-search-bar-date-time-dropdown"
            auto-apply
            :default-type="searchObj.data.datetime.type"
            :default-absolute-time="{
              startTime: searchObj.data.datetime.startTime,
              endTime: searchObj.data.datetime.endTime,
            }"
            :default-relative-time="searchObj.data.datetime.relativeTimePeriod"
            @on:date-change="updateDateTime"
          />
        </div>
        <div class="pl-2 float-left mr-2">
          <OButton
            data-test="logs-search-bar-refresh-btn"
            data-cy="search-bar-refresh-button"
            variant="primary"
            size="sm-action"
            :title="t('search.runQuery')"
            @click="searchData"
            >{{ t("search.runQuery") }}</OButton
          >
        </div>
      </div>
    </div>
    <div class="flex h-[calc(100%-40px)]!">
      <div class="flex flex-col" style="border-top: 1px solid #dbdbdb; height: 100px">
        <b>Query Editor:</b>
        <code-query-editor
          editor-id="logsStreamQueryEditor"
          ref="queryEditorRef"
          v-model:query="query"
          @update:query="updateQueryValue"
          @run-query="searchData"
        ></code-query-editor>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import { defineComponent, ref, onMounted, onBeforeMount } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import DateTime from "@/components/DateTime.vue";
import OButton from '@/lib/core/Button/OButton.vue';
import useLogs from "@/composables/useLogs";
import type { IDateTime } from "@/ts/interfaces";

const defaultValue: any = () => {
  return {
    name: "",
    function: "",
    params: "row",
    transType: "0",
  };
};

export default defineComponent({
  name: "ComponentSearchSearchBar",
  props: {
    queryData: {
      type: Object,
      default: () => {
        return {};
      },
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
  },
  components: {
    DateTime,
    OButton,
    CodeQueryEditor: defineAsyncComponent(
      () => import("@/components/CodeQueryEditor.vue"),
    ),
  },
  emits: ["searchdata", "update-query", "change:date-time"],
  methods: {
    searchData() {
      if (!this.isLoading) {
        // this.searchObj.runQuery = true;
        this.$emit("searchdata");
      }
    },
  },
  setup(props, { emit }) {
    const router = useRouter();
    const { t } = useI18n();
    const store = useStore();
    const btnRefreshInterval = ref(null);

    const { searchObj } = useLogs();
    const queryEditorRef = ref(null);

    const functionOptions = ref(searchObj.data.transforms);

    const functionModel: string = ref(null);
    const fnEditorRef: any = ref(null);
    const confirmDialogVisible: boolean = ref(false);
    const query = ref("");

    let confirmCallback;
    let fnEditorobj: any = null;

    onBeforeMount(() => {
      query.value = props.queryData.query;
    });

    const updateQueryValue = (value: string) => {
      emit("update-query", value);
    };

    const updateDateTime = (value: IDateTime) => {
      emit("change:date-time", value);
    };

    const updateQuery = () => {
      // alert(searchObj.data.query);
      if (queryEditorRef.value?.setValue)
        queryEditorRef.value.setValue(props.queryData.query);
    };

    const jsonToCsv = (jsonData) => {
      const replacer = (key, value) => (value === null ? "" : value);
      const header = Object.keys(jsonData[0]);
      let csv = header.join(",") + "\r\n";

      for (let i = 0; i < jsonData.length; i++) {
        const row = header
          .map((fieldName) => JSON.stringify(jsonData[i][fieldName], replacer))
          .join(",");
        csv += row + "\r\n";
      }

      return csv;
    };

    const downloadLogs = () => {
      const filename = "logs-data.csv";
      const data = jsonToCsv(props.queryData.queryResults.hits);
      const file = new File([data], filename, {
        type: "text/csv",
      });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    };

    const resetEditorLayout = () => {
      setTimeout(() => {
        queryEditorRef.value.resetEditorLayout();
        fnEditorobj.layout();
      }, 100);
    };

    return {
      t,
      store,
      router,
      fnEditorRef,
      fnEditorobj,
      searchObj,
      queryEditorRef,
      btnRefreshInterval,
      confirmDialogVisible,
      confirmCallback,
      refreshTimes: searchObj.config.refreshTimes,
      updateQueryValue,
      updateDateTime,
      updateQuery,
      downloadLogs,
      resetEditorLayout,
      functionModel,
      functionOptions,
      query,
    };
  },
});
</script>

<style>
#logsStreamQueryEditor {
  height: calc(100% - 20px) !important;
}
</style>
