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

<template>
  <div
    class="flex justify-start items-center q-px-sm header_bg border border-bottom border-top"
    :style="{ height: '30px' }"
    data-test="trace-details-sidebar-header"
  >
    <div
      :title="span.operation_name"
      :style="{ width: 'calc(100% - 24px)' }"
      class="q-pb-none ellipsis flex justify-between"
      data-test="trace-details-sidebar-header-operation-name"
    >
      {{ span.operation_name }}
    </div>

    <q-btn
      dense
      icon="close"
      class="align-right no-border q-pa-xs"
      size="xs"
      @click="closeSidebar"
      data-test="trace-details-sidebar-header-close-btn"
    ></q-btn>
  </div>
  <div
    class="q-pb-sm q-pt-xs flex flex-wrap justify-between trace-details-toolbar-container"
    data-test="trace-details-sidebar-header-toolbar"
  >
    <div class="flex flex-wrap">
      <div
        class="q-px-sm ellipsis non-selectable"
        :title="span.service_name"
        style="border-right: 1px solid #cccccc; font-size: 14px"
        data-test="trace-details-sidebar-header-toolbar-service"
      >
        <span class="text-grey-7">Service: </span>
        <span data-test="trace-details-sidebar-header-toolbar-service-name">{{
          span.service_name
        }}</span>
      </div>
      <div
        class="q-px-sm ellipsis non-selectable"
        :title="getDuration"
        style="border-right: 1px solid #cccccc; font-size: 14px"
        data-test="trace-details-sidebar-header-toolbar-duration"
      >
        <span class="text-grey-7">Duration: </span>
        <span>{{ getDuration }}</span>
      </div>

      <div
        class="q-px-sm ellipsis non-selectable"
        :title="getStartTime"
        style="font-size: 14px"
        data-test="trace-details-sidebar-header-toolbar-start-time"
      >
        <span class="text-grey-7">Start Time: </span>
        <span>{{ getStartTime }}</span>
      </div>
    </div>

    <div class="flex">
      <div class="text-right flex items-center justify-end q-mr-sm">
        <div
          class="flex items-center justify-end"
          data-test="trace-details-sidebar-header-toolbar-span-id"
        >
          <span class="text-grey-7 q-mr-xs">Span ID: </span
          ><span class="">{{ span.span_id }}</span>
        </div>
        <q-icon
          class="q-ml-xs text-grey-8 cursor-pointer trace-copy-icon"
          size="12px"
          name="content_copy"
          title="Copy"
          @click="copySpanId"
          data-test="trace-details-sidebar-header-toolbar-span-id-copy-icon"
        />
      </div>

      <q-btn
        class="q-mx-xs view-span-logs-btn"
        size="10px"
        icon="search"
        dense
        padding="xs sm"
        no-caps
        :title="t('traces.viewLogs')"
        @click.stop="viewSpanLogs"
        data-test="trace-details-sidebar-header-toolbar-view-logs-btn"
      >
        View Logs</q-btn
      >
    </div>
  </div>
  <q-tabs
    v-model="activeTab"
    dense
    inline-label
    class="text-bold q-mx-sm span_details_tabs"
    data-test="trace-details-sidebar-tabs"
  >
    <q-tab
      name="tags"
      :label="t('common.tags')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-tags"
    />
    <q-tab
      name="process"
      :label="t('common.process')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-process"
    />
    <q-tab
      name="events"
      :label="t('common.events')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-events"
    />
    <q-tab
      name="exceptions"
      :label="t('common.exceptions')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-exceptions"
    />
    <q-tab
      name="links"
      :label="t('common.links')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-links"
    />
    <q-tab
      name="attributes"
      :label="t('common.attributes')"
      style="text-transform: capitalize"
      data-test="trace-details-sidebar-tabs-attributes"
    />
  </q-tabs>
  <q-separator style="width: 100%" />
  <q-tab-panels v-model="activeTab" class="span_details_tab-panels">
    <q-tab-panel name="tags">
      <q-table
        ref="qTable"
        data-test="schema-log-stream-field-mapping-table"
        :rows="getTagRows"
        :columns="tagColumns"
        :row-key="(row) => 'tr_' + row.name"
        :pagination="pagination"
        class="q-table o2-quasar-table o2-row-md o2-schema-table tw-w-full tw-border tw-border-solid tw-border-[var(--o2-border-color)]"
        id="schemaFieldList"
        dense
      >
        <template v-slot:body-cell="props">
          <q-td class="text-left">
            {{ props.row[props.col.name] }}
          </q-td>
        </template>
      </q-table>
    </q-tab-panel>
    <q-tab-panel name="process">
      <q-table
        ref="qTable"
        data-test="trace-details-sidebar-process-table"
        :rows="getProcessRows"
        :columns="processColumns"
        :row-key="(row) => 'tr_' + row.name"
        :pagination="pagination"
        class="q-table o2-quasar-table o2-row-md o2-schema-table tw-w-full tw-border tw-border-solid tw-border-[var(--o2-border-color)]"
        dense
      >
        <template v-slot:body-cell="props">
          <q-td class="text-left">
            {{ props.row[props.col.name] }}
          </q-td>
        </template>
      </q-table>
    </q-tab-panel>
    <q-tab-panel name="attributes">
      <pre
        class="attr-text"
        v-html="highlightedAttributes(spanDetails.attrs)"
        data-test="trace-details-sidebar-attributes-table"
      ></pre>
    </q-tab-panel>
    <q-tab-panel name="events">
      <q-table
        v-if="spanDetails.events.length"
        ref="qTable"
        data-test="trace-details-sidebar-events-table"
        :rows="spanDetails.events"
        :columns="eventColumns"
        row-key="name"
        :pagination="pagination"
        class="q-table o2-quasar-table o2-row-md o2-schema-table tw-w-full tw-border tw-border-solid tw-border-[var(--o2-border-color)]"
        dense
        style="max-height: 400px"
      >
        <template v-slot:body="props">
          <q-tr
            :data-test="`trace-event-details-${
              props.row[store.state.zoConfig.timestamp_column]
            }`"
            :key="props.key"
            @click="expandEvent(props.rowIndex)"
            style="cursor: pointer"
            class="pointer"
          >
            <q-td
              v-for="(column, columnIndex) in eventColumns"
              :key="props.rowIndex + '-' + column.name"
              class="field_list text-left"
              style="cursor: pointer"
              :style="
                columnIndex > 0
                  ? { whiteSpace: 'normal', wordBreak: 'break-word' }
                  : {}
              "
            >
              <div class="flex row items-center no-wrap">
                <q-btn
                  v-if="column.name === '@timestamp'"
                  :icon="
                    expandedEvents[props.rowIndex.toString()]
                      ? 'expand_more'
                      : 'chevron_right'
                  "
                  dense
                  size="xs"
                  flat
                  class="q-mr-xs"
                  @click.stop="expandEvent(props.rowIndex)"
                ></q-btn>
                <span
                  v-if="column.name !== '@timestamp'"
                  v-html="highlightSearch(column.prop(props.row))"
                ></span>
                <span v-else> {{ column.prop(props.row) }}</span>
              </div>
            </q-td>
          </q-tr>
          <q-tr v-if="expandedEvents[props.rowIndex.toString()]">
            <q-td colspan="2">
              <pre
                class="log_json_content"
                v-html="highlightedAttributes(props.row)"
              ></pre>
            </q-td>
          </q-tr>
        </template>
      </q-table>
      <div
        class="full-width text-center q-pt-lg text-bold"
        v-else
        data-test="trace-details-sidebar-no-events"
      >
        No events present for this span
      </div>
    </q-tab-panel>
    <q-tab-panel name="exceptions">
      <q-table
        v-if="getExceptionEvents.length"
        ref="qTable"
        data-test="trace-details-sidebar-exceptions-table"
        :rows="getExceptionEvents"
        :columns="exceptionEventColumns"
        row-key="name"
        :pagination="pagination"
        class="q-table o2-quasar-table o2-row-md o2-schema-table tw-w-full tw-border tw-border-solid tw-border-[var(--o2-border-color)]"
        dense
        style="max-height: 400px"
      >
        <template v-slot:body="props">
          <q-tr
            :data-test="`trace-event-detail-${
              props.row[store.state.zoConfig.timestamp_column]
            }`"
            :key="props.key"
            @click="expandEvent(props.rowIndex)"
            style="cursor: pointer"
            class="pointer"
          >
            <q-td
              v-for="column in exceptionEventColumns"
              :key="props.rowIndex + '-' + column.name"
              class="field_list text-left"
              style="cursor: pointer"
            >
              <div class="flex row items-center no-wrap">
                <q-btn
                  v-if="column.name === '@timestamp'"
                  :icon="
                    expandedEvents[props.rowIndex.toString()]
                      ? 'expand_more'
                      : 'chevron_right'
                  "
                  dense
                  size="xs"
                  flat
                  class="q-mr-xs"
                  @click.stop="expandEvent(props.rowIndex)"
                  :data-test="`trace-details-sidebar-exceptions-table-expand-btn-${props.rowIndex}`"
                ></q-btn>
                <span
                  v-if="column.name !== '@timestamp'"
                  v-html="highlightSearch(column.prop(props.row))"
                ></span>
                <span v-else> {{ column.prop(props.row) }}</span>
              </div>
            </q-td>
          </q-tr>
          <q-tr
            v-if="expandedEvents[props.rowIndex.toString()]"
            :data-test="`trace-details-sidebar-exceptions-table-expanded-row-${props.rowIndex}`"
          >
            <q-td colspan="2" style="font-size: 12px; font-family: monospace">
              <div class="q-pl-sm">
                <div>
                  <span>Type: </span>
                  <span>"{{ props.row["exception.type"] }}"</span>
                </div>

                <div class="q-mt-xs">
                  <span>Message: </span>
                  <span>"{{ props.row["exception.message"] }}"</span>
                </div>

                <div class="q-mt-xs">
                  <span>Escaped: </span>
                  <span>"{{ props.row["exception.escaped"] }}"</span>
                </div>

                <div class="q-mt-xs">
                  <span>Stacktrace: </span>
                  <div
                    class="q-px-sm q-mt-xs"
                    style="border: 1px solid #c1c1c1; border-radius: 4px"
                  >
                    <pre
                      style="font-size: 12px; text-wrap: wrap"
                      class="q-mt-xs"
                      >{{ formatStackTrace(props.row["exception.stacktrace"]) }}</pre
                    >
                  </div>
                </div>
              </div>
            </q-td>
          </q-tr>
        </template>
      </q-table>
      <div
        class="full-width text-center q-pt-lg text-bold"
        v-else
        data-test="trace-details-sidebar-no-exceptions"
      >
        No exceptions present for this span
      </div>
    </q-tab-panel>

    <q-tab-panel name="links">
      <div v-if="spanLinks.length">
        <q-virtual-scroll
          type="table"
          ref="searchTableRef"
          style="max-height: 20rem"
          :items="spanLinks"
          class="tw-border tw-border-solid tw-border-[var(--o2-border-color)]"
          data-test="trace-details-sidebar-links-table"
        >
          <template v-slot:before>
            <thead class="thead-sticky text-left tw-bg-[var(--o2-hover-accent)] o2-quasar-table">
              <tr>
                <th
                  v-for="(col, index) in linkColumns"
                  :key="'result_' + index"
                  class="table-header"
                  :data-test="`trace-events-table-th-${col.label}`"
                >
                  {{ col.label }}
                </th>
              </tr>
            </thead>
          </template>

          <template v-slot="{ item: row, index }">
            <tr
              :data-test="`trace-event-detail-link-${index}`"
              :key="'expand_' + index"
              @click="openReferenceTrace('span', row)"
              style="cursor: pointer"
              class="pointer"
            >
              <td
                v-for="column in linkColumns"
                :key="index + '-' + column.name"
                class="field_list"
                style="cursor: pointer"
              >
                <div class="flex row items-center no-wrap">
                  {{ column.prop(row) }}
                </div>
              </td>
            </tr>
          </template>
        </q-virtual-scroll>
      </div>
      <div
        v-else
        class="full-width text-center q-pt-lg text-bold"
        data-test="trace-details-sidebar-no-links"
      >
        No links present for this span
      </div>
    </q-tab-panel>
  </q-tab-panels>
</template>

<script lang="ts">
import { cloneDeep } from "lodash-es";
import { date, useQuasar, type QTableProps, copyToClipboard } from "quasar";
import { defineComponent, onBeforeMount, ref, watch, type Ref } from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { computed } from "vue";
import { formatTimeWithSuffix, convertTimeFromNsToMs } from "@/utils/zincutils";
import useTraces from "@/composables/useTraces";
import { useRouter } from "vue-router";
import { onMounted } from "vue";

export default defineComponent({
  name: "TraceDetailsSidebar",
  props: {
    span: {
      type: Object,
      default: () => null,
    },
    baseTracePosition: {
      type: Object,
      default: () => null,
    },
    searchQuery: {
      type: String,
      default: "",
    },
  },
  emits: ["close", "view-logs", "select-span", "open-trace"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const activeTab = ref("tags");
    const tags: Ref<{ [key: string]: string }> = ref({});
    const processes: Ref<{ [key: string]: string }> = ref({});
    const closeSidebar = () => {
      emit("close");
    };
    const spanDetails: any = ref({
      attrs: {},
      events: [],
    });
    const pagination: any = ref({
      rowsPerPage: 0,
    });
    const q = useQuasar();
    const { buildQueryDetails, navigateToLogs } = useTraces();
    const router = useRouter();
    const highlightSearch = (
      value: any,
      preserveString: any = false,
    ): string => {
      if (!props.searchQuery) {
        // Return the object/JSON value as is if there's no search query
        return typeof value === "object" && value !== null
          ? JSON.stringify(value, null, 2)
          : value;
      }

      if (typeof value === "string") {
        // Highlight text in string values
        const regex = new RegExp(`(${props.searchQuery})`, "gi");
        if (preserveString) {
          return `"${value.replace(regex, (match) => `<span class="highlight ${store.state.theme === "dark" ? "tw-text-gray-900" : ""}">${match}</span>`)}"`;
        } else {
          return value.replace(
            regex,
            (match) =>
              `<span class="highlight ${store.state.theme === "dark" ? "tw-text-gray-900" : ""}">${match}</span>`,
          );
        }
      } else if (Array.isArray(value)) {
        return `[${value.map((item) => highlightSearch(item)).join(", ")}]`;
      } else if (typeof value === "object" && value !== null) {
        const highlightedEntries = Object.entries(value).map(([key, val]) => {
          // Do not highlight the keys; only process the values
          const highlightedVal = highlightSearch(val, true);
          return `"${key}": ${highlightedVal}`;
        });
        return `{\n  ${highlightedEntries.join(",\n  ")}\n}`;
      } else {
        return JSON.stringify(value);
      }
    };

    const highlightedAttributes = computed(() => {
      return (value: any) => highlightSearch(value, true);
    });

    watch(
      () => props.span,
      () => {
        tags.value = {};
        processes.value = {};
        spanDetails.value = getFormattedSpanDetails();
      },
      {
        deep: true,
      },
    );

    const tagColumns = [
      {
        name: "field",
        label: "Field",
        field: "field",
        align: "left" as const,
        headerClasses: "!tw-text-left",
      },
      {
        name: "value",
        label: "Value",
        field: "value",
        align: "left" as const,
        headerClasses: "!tw-text-left",
      },
    ];

    const getTagRows = computed(() => {
      return Object.entries(tags.value).map(([key, value]) => ({
        field: key,
        value: value,
      }));
    });

    const processColumns = [
      {
        name: "field",
        label: "Field",
        field: "field",
        align: "left" as const,
        headerClasses: "!tw-text-left",
      },
      {
        name: "value",
        label: "Value",
        field: "value",
        align: "left" as const,
        headerClasses: "!tw-text-left",
      },
    ];

    const getProcessRows = computed(() => {
      return Object.entries(processes.value).map(([key, value]) => ({
        field: key,
        value: value,
      }));
    });

    const getDuration = computed(() =>
      formatTimeWithSuffix(props.span.duration),
    );

    onBeforeMount(() => {
      spanDetails.value = getFormattedSpanDetails();
    });

    const store = useStore();
    const expandedEvents: any = ref({});
    const eventColumns = ref([
      {
        name: "@timestamp",
        field: "@timestamp",
        prop: (row: any) =>
          date.formatDate(
            Math.floor(row[store.state.zoConfig.timestamp_column] / 1000000),
            "MMM DD, YYYY HH:mm:ss.SSS Z",
          ),
        label: "Timestamp",
        align: "left" as const,
        sortable: true,
      },
      {
        name: "source",
        field: "source",
        prop: (row: any) => JSON.stringify(row),
        label: "source",
        align: "left" as const,
        sortable: true,
      },
    ]);

    const exceptionEventColumns = ref([
      {
        name: "@timestamp",
        field: "@timestamp",
        prop: (row: any) =>
          date.formatDate(
            Math.floor(row[store.state.zoConfig.timestamp_column] / 1000000),
            "MMM DD, YYYY HH:mm:ss.SSS Z",
          ),
        label: "Timestamp",
        align: "left" as const,
        sortable: true,
      },
      {
        name: "type",
        field: "exception.type",
        prop: (row: any) => row["exception.type"],
        label: "Type",
        align: "left" as const,
        sortable: true,
      },
    ]);

    const linkColumns = ref([
      {
        name: "traceId",
        prop: (row: any) => (row.context ? row?.context?.traceId : ""),
        label: "TraceId",
        align: "left",
        sortable: true,
      },
      {
        name: "spanId",
        prop: (row: any) => (row.context ? row?.context?.spanId : ""),
        label: "spanId",
        align: "left",
        sortable: true,
      },
    ]);

    const getExceptionEvents = computed(() => {
      return spanDetails.value.events.filter(
        (event: any) => event.name === "exception",
      );
    });

    const expandEvent = (index: number) => {
      if (expandedEvents.value[index.toString()])
        delete expandedEvents.value[index.toString()];
      else expandedEvents.value[index.toString()] = true;
    };

    const getSpanKind = (id: number) => {
      const spanKindMapping: { [key: number]: string } = {
        1: "Server",
        2: "Client",
        3: "Producer",
        4: "Consumer",
        5: "Internal",
      };
      return spanKindMapping[id] || id;
    };

    const getFormattedSpanDetails = () => {
      const spanDetails: { attrs: any; events: any[] } = {
        attrs: {},
        events: [],
      };

      spanDetails.attrs = cloneDeep(props.span);

      if (spanDetails.attrs.events) delete spanDetails.attrs.events;

      spanDetails.attrs.duration = spanDetails.attrs.duration + "us";
      spanDetails.attrs[store.state.zoConfig.timestamp_column] =
        date.formatDate(
          Math.floor(
            spanDetails.attrs[store.state.zoConfig.timestamp_column] / 1000,
          ),
          "MMM DD, YYYY HH:mm:ss.SSS Z",
        );
      spanDetails.attrs.span_kind = getSpanKind(spanDetails.attrs.span_kind);

      try {
        spanDetails.events = JSON.parse(props.span.events || "[]").map(
          (event: any) => event,
        );
      } catch (_e: any) {
        spanDetails.events = [];
      }

      return spanDetails;
    };

    const span_details = new Set([
      "span_id",
      "trace_id",
      "operation_name",
      store.state.zoConfig.timestamp_column,
      "start_time",
      "end_time",
      "duration",
      "busy_ns",
      "idle_ns",
      "events",
    ]);

    watch(
      () => props.span,
      () => {
        tags.value = {};
        processes.value = {};
        Object.keys(props.span).forEach((key: string) => {
          if (!span_details.has(key)) {
            tags.value[key] = props.span[key];
          }
        });

        processes.value["service_name"] = props.span["service_name"];
        processes.value["service_service_instance"] =
          props.span["service_service_instance"];
        processes.value["service_service_version"] =
          props.span["service_service_version"];
      },
      {
        deep: true,
        immediate: true,
      },
    );
    function formatStackTrace(trace: any) {
      // Split the trace into lines
      const lines = trace.split("\n");

      // Process each line
      const formattedLines = lines.map((line: string) => {
        // Apply formatting rules
        // For example, indent lines that contain file paths
        if (line.trim().startsWith("/")) {
          return "" + line; // Indent the line
        }
        return line;
      });

      // Reassemble the formatted trace
      return formattedLines.join("\n");
    }

    const viewSpanLogs = () => {
      const queryDetails = buildQueryDetails(props.span);
      navigateToLogs(queryDetails);
    };

    const getStartTime = computed(() => {
      return (
        convertTimeFromNsToMs(props.span.start_time) -
        (props.baseTracePosition?.startTimeMs || 0) +
        "ms"
      );
    });

    const copySpanId = () => {
      copyToClipboard(props.span?.span_id || "");

      q?.notify?.({
        type: "positive",
        message: "Span ID copied to clipboard",
        timeout: 2000,
      });
    };

    const openReferenceTrace = (type: string, link: any) => {
      if (link && link.context) {
        const query = {
          stream: router.currentRoute.value.query.stream,
          trace_id: link.context.traceId,
          span_id: link.context.spanId,
          from:
            convertTimeFromNsToMs(props.span.start_time) * 1000 - 3600000000,
          to: convertTimeFromNsToMs(props.span.end_time) * 1000 + 3600000000,
          org_identifier: store.state.selectedOrganization.identifier,
        };

        if (query.trace_id === props.span.trace_id) {
          emit("select-span", link.context.spanId);
          return;
        }

        router.push({
          name: "traceDetails",
          query,
        });

        emit("open-trace");
      }
    };

    const spanLinks = computed(() => {
      try {
        const parsedLinks = typeof props.span.links === "string"
          ? JSON.parse(props.span.links)
          : props.span.links;

        // If there are no real links, return sample data for testing
        if (!parsedLinks || parsedLinks.length === 0) {
          return [
            {
              context: {
                traceId: "abc123def456ghi789jkl012mno345pq",
                spanId: "span1234567890ab",
              },
            },
            {
              context: {
                traceId: "xyz789uvw456rst123opq890lmn567cd",
                spanId: "span0987654321xy",
              },
            },
            {
              context: {
                traceId: "pqr456stu789vwx012yza345bcd678ef",
                spanId: "spanabcdef123456",
              },
            },
          ];
        }

        return parsedLinks;
      } catch (e) {
        console.log("Error parsing span links:", e);
        // Return sample data even on error for testing
        return [
          {
            context: {
              traceId: "sample-trace-id-1",
              spanId: "sample-span-id-1",
            },
          },
          {
            context: {
              traceId: "sample-trace-id-2",
              spanId: "sample-span-id-2",
            },
          },
        ];
      }
    });

    return {
      t,
      activeTab,
      closeSidebar,
      eventColumns,
      expandedEvents,
      expandEvent,
      pagination,
      spanDetails,
      store,
      tags,
      processes,
      formatStackTrace,
      getExceptionEvents,
      exceptionEventColumns,
      getDuration,
      viewSpanLogs,
      getStartTime,
      copySpanId,
      openReferenceTrace,
      spanLinks,
      linkColumns,
      highlightSearch,
      highlightedAttributes,
      getTagRows,
      tagColumns,
      processColumns,
      getProcessRows,
    };
  },
});
</script>

<style scoped lang="scss">
.span_details_tab-panels {
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(0.625rem);
    border-radius: 0.5rem;
    border: 0.125rem solid rgba(255, 255, 255, 0.3);
    overflow: hidden;
  }

  th,
  td {
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    border-right: 1px solid rgba(255, 255, 255, 0.15);
    text-align: left;
    padding: 8px 12px !important;
    font-size: 13px;
  }

  th:last-child,
  td:last-child {
    border-right: none;
  }

  tr:last-child td {
    border-bottom: none;
  }

  tbody tr:first-child td:first-child {
    border-top-left-radius: 0.5rem;
  }

  tbody tr:first-child td:last-child {
    border-top-right-radius: 0.5rem;
  }

  tbody tr:last-child td:first-child {
    border-bottom-left-radius: 0.5rem;
  }

  tbody tr:last-child td:last-child {
    border-bottom-right-radius: 0.5rem;
  }
}

.span_details_tab-panels table.q-table {
  background: rgba(240, 240, 245, 0.8);
  backdrop-filter: blur(0.625rem);
  border: 0.125rem solid rgba(100, 100, 120, 0.5);
}
.attr-text {
  font-size: 12px;
  font-family: monospace;
}
.table-header {
  // text-transform: capitalize;

  .table-head-chip {
    padding: 0px;

    .q-chip__content {
      margin-right: 0.5rem;
      font-size: 0.75rem;
      color: $dark;
    }

    .q-chip__icon--remove {
      height: 1rem;
      width: 1rem;
      opacity: 1;
      margin: 0;

      &:hover {
        opacity: 0.7;
      }
    }

    .q-table th.sortable {
      cursor: pointer;
      text-transform: capitalize;
      font-weight: bold;
    }
  }

  &.isClosable {
    padding-right: 26px;
    position: relative;

    .q-table-col-close {
      transform: translateX(26px);
      position: absolute;
      margin-top: 2px;
      color: grey;
      transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.5, 1);
    }
  }

  .q-table th.sortable {
    cursor: pointer;
    text-transform: capitalize;
    font-weight: bold;
  }

  .log_json_content {
    white-space: pre-wrap;
  }
}
.q-table__top {
  padding-left: 0;
  padding-top: 0;
}

.q-table thead tr,
.q-table tbody td,
.q-table th,
.q-table td {
  height: 25px;
  padding: 0px 5px;
  font-size: 0.75rem;
}

.q-table__bottom {
  width: 100%;
}

.q-table__bottom {
  min-height: 40px;
  padding-top: 0;
  padding-bottom: 0;
}

.q-td {
  overflow: hidden;
  min-width: 100px;

  .expanded {
    margin: 0;
    white-space: pre-wrap;
    word-wrap: break-word;
    word-break: break-all;
  }
}

.thead-sticky tr > *,
.tfoot-sticky tr > * {
  position: sticky;
  opacity: 1;
  z-index: 1;
}

.thead-sticky tr:last-child > * {
  top: 0;
}

.tfoot-sticky tr:first-child > * {
  bottom: 0;
}

.field_list {
  padding: 0px;
  margin-bottom: 0.125rem;
  position: relative;
  overflow: visible;
  cursor: default;
}
.span_details_tab-panels {
  height: calc(100% - 104px);
  overflow-y: auto;
  overflow-x: hidden;
}

.header_bg {
  border-top: 1px solid $border-color;
  background-color: color-mix(in srgb, currentColor 5%, transparent);
}
</style>

<style lang="scss">
.span_details_tabs {
  .q-tab__indicator {
    display: none;
  }
  .q-tab--active {
    border-bottom: 1px solid var(--q-primary);
  }
}

.span_details_tab-panels {
  .q-tab-panel {
    padding: 8px 8px 8px 8px;
  }
}

.view-span-logs-btn {
  .q-btn__content {
    display: flex;
    align-items: center;
    font-size: 11px;

    .q-icon {
      margin-right: 2px !important;
      font-size: 14px;
      margin-bottom: 1px;
    }
  }
}
.highlight {
  background-color: yellow; /* Adjust background color as desired */
}
</style>

<style lang="scss">
// Dark theme support for glassmorphic tables
.body--dark {
  .span_details_tab-panels {
    table {
      // background: rgba(255, 255, 255, 0.05);
      // border: 0.125rem solid rgba(255, 255, 255, 0.3);
    }

    th,
    td {
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      border-right: 1px solid rgba(255, 255, 255, 0.15);
    }
  }
}

// Light theme support for glassmorphic tables
.body--light {
  .span_details_tab-panels {
    table {
      // background: rgba(240, 240, 245, 0.8);
      // border: 0.125rem solid rgba(100, 100, 120, 0.5);
    }

    th,
    td {
      border-bottom: 1px solid rgba(100, 100, 120, 0.2);
      border-right: 1px solid rgba(100, 100, 120, 0.3);
    }
  }
}
</style>
