<!-- Copyright 2023 OpenObserve Inc.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

     http:www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License. 
-->

<!-- eslint-disable vue/no-unused-components -->
<template>
  <div data-test="dashboard-join-pop-up" style="width: 624px">
    <div
      style="
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
      "
    >
      <div style="flex: 1; gap: 8px">
        <div style="display: flex; align-items: center; gap: 8px">
          <LeftJoinSvg />
          <label>Join</label>
        </div>
        <q-select
          dense
          filled
          v-model="mainStream"
          :options="[]"
          :disable="true"
          label="Joining Stream"
          style="width: 100%"
          data-test="dashboard-config-panel-join-from"
        />
      </div>
      <div
        style="display: flex; align-items: center; gap: 8px; padding-top: 21px"
      >
        <LeftJoinLineSvg />
      </div>

      <div>
        <label for="joinType">Join type</label>
        <div
          style="
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 8px;
          "
        >
          <div
            style="
              display: flex;
              flex-direction: column;
              align-items: center;
              cursor: pointer;
            "
            @click="modelValue.joinType = 'left'"
          >
            <LeftJoinTypeSvg :shouldFill="modelValue.joinType === 'left'" />
            <div
              :class="[modelValue.joinType === 'left' ? 'text-primary' : '']"
            >
              Left
            </div>
          </div>
          <div
            style="
              display: flex;
              flex-direction: column;
              align-items: center;
              cursor: pointer;
            "
            @click="modelValue.joinType = 'inner'"
          >
            <InnerJoinTypeSvg :shouldFill="modelValue.joinType === 'inner'" />
            <div
              :class="[modelValue.joinType === 'inner' ? 'text-primary' : '']"
            >
              Inner
            </div>
          </div>
          <div
            style="
              display: flex;
              flex-direction: column;
              align-items: center;
              cursor: pointer;
            "
            @click="modelValue.joinType = 'right'"
          >
            <RightJoinTypeSvg :shouldFill="modelValue.joinType === 'right'" />
            <div
              :class="[modelValue.joinType === 'right' ? 'text-primary' : '']"
            >
              Right
            </div>
          </div>
        </div>
      </div>

      <div
        style="display: flex; align-items: center; gap: 8px; padding-top: 21px"
      >
        <RightJoinLineSvg />
      </div>

      <div style="flex: 1">
        <div style="display: flex; align-items: center; gap: 8px">
          <RightJoinSvg />
          <label>On</label>
        </div>

        <q-select
          filled
          dense
          v-model="modelValue.stream"
          :options="filteredStreamOptions"
          emit-value
          map-options
          label="On Stream"
          style="width: 100%"
          data-test="dashboard-config-panel-join-to"
          use-input
          input-debounce="0"
          behavior="menu"
          hide-selected
          fill-input
          @filter="filterStreamOptions"
        />
      </div>
    </div>

    <div class="tw-flex tw-items-center tw-gap-4">
      <div class="tw-border-t tw-border-gray-200 tw-flex-1"></div>
      <div
        class="tw-py-2 tw-text-center tw-text-xs tw-text-gray-700"
        v-if="
          modelValue.stream &&
          modelValue.streamAlias &&
          modelValue.joinType &&
          mainStream
        "
      >
        Joining <span className="tw-font-semibold">{{ mainStream }}</span> with
        <span className="tw-font-semibold">{{ modelValue.stream }}</span> with
        <span className="tw-text-indigo-600"
          >{{
            modelValue?.joinType?.charAt(0)?.toUpperCase() +
            modelValue?.joinType?.slice(1)
          }}
          Join</span
        >
      </div>
      <div class="tw-border-t tw-border-gray-200 tw-flex-1"></div>
    </div>

    <div style="margin-bottom: 10px">
      <div style="margin-bottom: 10px">
        <h3
          style="
            font-size: 14px;
            font-style: normal;
            font-weight: 600;
            line-height: normal;
          "
        >
          Joining Clause
        </h3>
        <p
          style="
            font-size: 12px;
            font-style: normal;
            font-weight: 400;
            line-height: normal;
          "
        >
          Select the fields that need to be correlated within the joining
          streams
        </p>
      </div>

      <div
        v-for="(arg, argIndex) in modelValue.conditions"
        :key="argIndex + JSON.stringify(arg)"
        style="
          margin-bottom: 10px;
          padding: 10px;
          border: 1px solid #eee;
          border-radius: 4px;
        "
      >
        <div>Clause {{ argIndex + 1 }}</div>
        <div style="display: flex; align-items: center">
          <div style="flex: 1; margin-right: 10px">
            <StreamFieldSelect
              :streams="getStreamsBasedJoinIndex()"
              v-model="modelValue.conditions[argIndex].leftField"
              :data-test="`dashboard-join-condition-left-field-${argIndex}`"
            />
          </div>

          <div style="flex: 1; margin-right: 10px">
            <!-- operator selector -->
            <q-select
              behavior="menu"
              borderless
              v-model="modelValue.conditions[argIndex].operation"
              :options="operationOptions"
              dense
              filled
              label="Select Operation"
              :data-test="`dashboard-join-condition-operation-${argIndex}`"
            />
          </div>

          <div style="flex: 1; margin-right: 10px">
            <StreamFieldSelect
              :streams="[
                {
                  stream: modelValue.stream,
                  streamAlias: modelValue.streamAlias,
                },
              ]"
              v-model="modelValue.conditions[argIndex].rightField"
            />
          </div>

          <q-btn
            @click="addCondition(argIndex)"
            no-caps
            dense
            flat
            icon="add"
          />

          <q-btn
            :data-test="`dashboard-join-condition-remove-${argIndex}`"
            icon="close"
            dense
            flat
            round
            :disable="modelValue.conditions.length === 1"
            @click="removeCondition(argIndex)"
            class="tw-h-10 tw-w-10"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, watch, onMounted, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useLoading } from "@/composables/useLoading";
import useStreams from "@/composables/useStreams";
import useDashboardPanelData from "@/composables/useDashboardPanel";
import StreamFieldSelect from "@/components/dashboards/addPanel/StreamFieldSelect.vue";
import LeftJoinSvg from "@/components/icons/LeftJoinSvg.vue";
import LeftJoinTypeSvg from "@/components/icons/LeftJoinTypeSvg.vue";
import LeftJoinLineSvg from "@/components/icons/LeftJoinLineSvg.vue";
import RightJoinSvg from "@/components/icons/RightJoinSvg.vue";
import RightJoinTypeSvg from "@/components/icons/RightJoinTypeSvg.vue";
import RightJoinLineSvg from "@/components/icons/RightJoinLineSvg.vue";
import InnerJoinTypeSvg from "@/components/icons/InnerJoinTypeSvg.vue";
export default defineComponent({
  name: "AddJoinPopUp",

  components: {
    StreamFieldSelect,
    LeftJoinSvg,
    LeftJoinTypeSvg,
    LeftJoinLineSvg,
    RightJoinSvg,
    RightJoinTypeSvg,
    RightJoinLineSvg,
    InnerJoinTypeSvg,
  },

  props: {
    mainStream: {
      type: String,
      required: true,
    },
    joinIndex: {
      type: Number,
      required: true,
    },
    modelValue: {
      type: Object,
      default: () => {
        return {
          stream: "",
          joinType: "inner",
          streamAlias: "",
          conditions: [
            {
              leftField: {
                streamAlias: "",
                field: "",
              },
              rightField: {
                streamAlias: "",
                field: "",
              },
              logicalOperator: "and",
              operation: "=",
            },
          ],
        };
      },
    },
  },

  emits: ["close"],

  setup(props, { emit }) {
    const { t } = useI18n();
    const store = useStore();
    const { getStreams, getStream } = useStreams();

    const dashboardPanelDataPageKey: any = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const streamOptions = ref([]);
    const filteredStreamOptions = ref([]);
    const joinOptions = ["inner", "left", "right"];
    const operationOptions = ["=", "!=", ">", "<", ">=", "<="];

    // get the stream list by making an API call
    const getStreamList = async (stream_type: any) => {
      await getStreams(stream_type, false).then((res: any) => {
        streamOptions.value = res.list.map((stream: any) => {
          return {
            label: stream.name,
            value: stream.name,
          };
        });

        if (streamOptions.value.length > 0) {
          // check if current selected stream is in the list
          // if not select first stream
          const selectedStream = streamOptions.value.find((option: any) => {
            if (option.value === props.modelValue.stream) {
              return option;
            }
          });

          if (!selectedStream) {
            props.modelValue.stream = res.list[0].name;
          }
        }
      });
    };

    // get stream list
    const streamDataLoading = useLoading(async (stream_type: any) => {
      await getStreamList(stream_type);
    });

    // get the stream list based on the selected stream type
    const loadStreamsListBasedOnType = async () => {
      streamDataLoading.execute(
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
      );
    };

    // watch the stream type and load the stream list
    watch(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
      async () => {
        loadStreamsListBasedOnType();
      },
    );

    onMounted(() => {
      loadStreamsListBasedOnType();
      filteredStreamOptions.value = [...streamOptions?.value];
    });

    const removeCondition = (argIndex: number) => {
      props.modelValue.conditions.splice(argIndex, 1);
    };

    const addCondition = (index: number = 0) => {
      props.modelValue.conditions.splice(index + 1, 0, {
        leftField: {
          streamAlias: "",
          field: "",
        },
        rightField: {
          streamAlias: "",
          field: "",
        },
        logicalOperator: "and",
        operation: "=",
      });
    };

    const getStreamsBasedJoinIndex = () => {
      // return list of all streams upto current join index
      return [
        {
          stream:
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].fields.stream,
        },
        ...(dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.joins
          ?.slice(0, props.joinIndex)
          ?.map((join: any) => {
            return { stream: join.stream, streamAlias: join.streamAlias };
          }) ?? []),
      ];
    };

    const filterStreamOptions = (val: any, update: any) => {
      if (val === "") {
        update(() => {
          filteredStreamOptions.value = [...streamOptions?.value];
        });
        return;
      }

      update(() => {
        const needle = val.toLowerCase();
        filteredStreamOptions.value = streamOptions?.value?.filter(
          (stream: any) => stream?.label?.toLowerCase()?.includes(needle),
        );
      });
    };

    return {
      t,
      streamOptions,
      joinOptions,
      removeCondition,
      addCondition,
      operationOptions,
      getStreamsBasedJoinIndex,
      filteredStreamOptions,
      filterStreamOptions,
    };
  },
});
</script>
