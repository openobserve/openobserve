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
  <div data-test="dashboard-join-pop-up" class="join-popup-container">
    <div class="join-header">
      <div class="join-section">
        <div class="join-section-header">
          <LeftJoinSvg class="tw:h-[21px]" />
          <label>Join</label>
        </div>
        <q-select
          dense
          filled
          v-model="mainStream"
          :options="[]"
          :disable="true"
          label="Joining Stream"
          class="o2-custom-select-dashboard"
          data-test="dashboard-config-panel-join-from"
        />
      </div>

      <div class="join-connector">
        <LeftJoinLineSvg class="tw:h-[40px] tw:w-[58px]" />
      </div>

      <div class="join-type-section">
        <label for="joinType">Join type</label>
        <div class="join-type-selector">
          <div
            class="join-type-option"
            @click="handleJoinTypeChange('left')"
            :aria-label="t('panel.leftJoin')"
            data-test="dashboard-join-type-left"
          >
            <LeftJoinTypeSvg :shouldFill="localJoinType === 'left'" />
            <div :class="getJoinTypeLabelClass('left')">Left</div>
          </div>
          <div
            class="join-type-option"
            @click="handleJoinTypeChange('inner')"
            :aria-label="t('panel.innerJoin')"
            data-test="dashboard-join-type-inner"
          >
            <InnerJoinTypeSvg :shouldFill="localJoinType === 'inner'" />
            <div :class="getJoinTypeLabelClass('inner')">Inner</div>
          </div>
          <div
            class="join-type-option"
            @click="handleJoinTypeChange('right')"
            :aria-label="t('panel.rightJoin')"
            data-test="dashboard-join-type-right"
          >
            <RightJoinTypeSvg :shouldFill="localJoinType === 'right'" />
            <div :class="getJoinTypeLabelClass('right')">Right</div>
          </div>
        </div>
      </div>

      <div class="join-connector">
        <RightJoinLineSvg class="tw:h-[40px] tw:w-[58px]" />
      </div>

      <div class="join-section">
        <div class="join-section-header">
          <RightJoinSvg class="tw:h-[21px]" />
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
          class="o2-custom-select-dashboard"
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

    <div class="tw:flex tw:items-center tw:gap-4">
      <div class="tw:border-t tw:border-gray-200 tw:flex-1"></div>
      <div
        :class="[
          'tw:py-2 tw:text-center tw:text-xs',
          store.state.theme === 'dark' ? 'tw:text-white' : 'tw:text-gray-700',
        ]"
        v-if="showJoinSummary"
      >
        Performing
        <span class="text-primary">{{ joinTypeLabel }} Join</span> between
        <span class="tw:font-semibold">{{ mainStream }}</span> and
        <span class="tw:font-semibold">{{ modelValue.stream }}</span>
      </div>
      <div class="tw:border-t tw:border-gray-200 tw:flex-1"></div>
    </div>

    <div class="clause-section">
      <div class="clause-header">
        <h3 class="clause-title">Joining Clause</h3>
        <p class="clause-description">
          Select the fields that need to be correlated within the joining
          streams
        </p>
      </div>

      <div
        v-for="(arg, argIndex) in modelValue.conditions"
        :key="argIndex + JSON.stringify(arg)"
        class="condition-item"
      >
        <div class="condition-label">Clause {{ argIndex + 1 }}</div>
        <div class="condition-fields">
          <div class="field-container">
            <StreamFieldSelect
              :streams="getStreamsBasedJoinIndex()"
              v-model="modelValue.conditions[argIndex].leftField"
              :data-test="`dashboard-join-condition-left-field-${argIndex}`"
            />
          </div>

          <div class="field-container">
            <q-select
              behavior="menu"
              borderless
              v-model="modelValue.conditions[argIndex].operation"
              :options="operationOptions"
              dense
              filled
              class="o2-custom-select-dashboard"
              label="Select Operation"
              :data-test="`dashboard-join-condition-operation-${argIndex}`"
            />
          </div>

          <div class="field-container">
            <StreamFieldSelect
              :streams="rightFieldStreams"
              v-model="modelValue.conditions[argIndex].rightField"
              :data-test="`dashboard-join-condition-right-field-${argIndex}`"
            />
          </div>

          <q-btn
            @click="handleAddCondition(argIndex)"
            no-caps
            dense
            flat
            icon="add"
            :aria-label="t('panel.addClause')"
            :data-test="`dashboard-join-condition-add-${argIndex}`"
          >
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
            >
              Add another clause
            </q-tooltip>
          </q-btn>

          <q-btn
            :data-test="`dashboard-join-condition-remove-${argIndex}`"
            icon="close"
            dense
            flat
            round
            :disable="modelValue.conditions.length === 1"
            @click="handleRemoveCondition(argIndex)"
            class="tw:h-10 tw:w-10"
            :aria-label="t('panel.removeClause')"
          >
            <q-tooltip
              class="bg-grey-8"
              anchor="top middle"
              self="bottom middle"
            >
              Remove clause
            </q-tooltip>
          </q-btn>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  watch,
  onMounted,
  inject,
  ref,
  computed,
  PropType,
} from "vue";
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

export interface StreamOption {
  label: string;
  value: string;
}

export interface JoinFieldReference {
  streamAlias: string;
  field: string;
}

export interface JoinCondition {
  leftField: JoinFieldReference;
  rightField: JoinFieldReference;
  logicalOperator: "AND" | "OR";
  operation: "=" | "!=" | ">" | "<" | ">=" | "<=";
}

export interface JoinConfig {
  stream: string;
  streamAlias: string;
  joinType: "inner" | "left" | "right";
  conditions: JoinCondition[];
}

export interface StreamReference {
  stream: string;
  streamAlias?: string;
}

const JOIN_TYPES = {
  INNER: "inner",
  LEFT: "left",
  RIGHT: "right",
} as const;

const JOIN_OPERATIONS = ["=", "!=", ">", "<", ">=", "<="] as const;

const JOIN_LOGICAL_OPERATORS = {
  AND: "AND",
  OR: "OR",
} as const;

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
      type: Object as PropType<JoinConfig>,
      required: true,
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

  emits: ["update:modelValue"],

  setup(props) {
    const { t } = useI18n();
    const store = useStore();
    const { getStreams } = useStreams();

    const dashboardPanelDataPageKey = inject<string>(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const streamOptions = ref<StreamOption[]>([]);
    const filteredStreamOptions = ref<StreamOption[]>([]);
    const operationOptions = [...JOIN_OPERATIONS];

    /**
     * Determines if join summary should be shown
     */
    const showJoinSummary = computed(() => {
      return !!(
        props.modelValue.stream &&
        props.modelValue.streamAlias &&
        props.modelValue.joinType &&
        props.mainStream
      );
    });

    /**
     * Gets the formatted join type label
     */
    const joinTypeLabel = computed(() => {
      const joinType = props.modelValue.joinType;
      return joinType
        ? joinType.charAt(0).toUpperCase() + joinType.slice(1)
        : "";
    });

    /**
     * Gets local join type for UI binding
     */
    const localJoinType = computed(() => props.modelValue.joinType);

    /**
     * Gets right field streams for condition right side
     */
    const rightFieldStreams = computed((): StreamReference[] => {
      return [
        {
          stream: props.modelValue.stream,
          streamAlias: props.modelValue.streamAlias,
        },
      ];
    });

    /**
     * Gets the current query stream type
     */
    const currentStreamType = computed(() => {
      try {
        return dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.stream_type;
      } catch (error) {
        console.error("Error getting current stream type:", error);
        return undefined;
      }
    });

    /**
     * Creates a default join condition
     */
    function createDefaultCondition(): JoinCondition {
      return {
        leftField: {
          streamAlias: "",
          field: "",
        },
        rightField: {
          streamAlias: "",
          field: "",
        },
        logicalOperator: JOIN_LOGICAL_OPERATORS.AND,
        operation: "=",
      };
    }

    /**
     * Gets CSS class for join type label
     */
    function getJoinTypeLabelClass(type: string): string {
      return props.modelValue.joinType === type
        ? "text-primary tw:font-[600]"
        : "";
    }

    /**
     * Gets list of streams available for left field based on join index
     * Returns main stream plus all previously joined streams
     */
    function getStreamsBasedJoinIndex(): StreamReference[] {
      try {
        const currentQuery =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ];

        if (!currentQuery) return [];

        const mainStream: StreamReference = {
          stream: currentQuery.fields?.stream || "",
        };

        const previousJoins =
          currentQuery.joins?.slice(0, props.joinIndex)?.map(
            (join: any): StreamReference => ({
              stream: join.stream,
              streamAlias: join.streamAlias,
            }),
          ) ?? [];

        return [mainStream, ...previousJoins];
      } catch (error) {
        console.error("Error getting streams based on join index:", error);
        return [];
      }
    }

    /**
     * Fetches stream list from API
     */
    async function fetchStreamList(streamType: string): Promise<void> {
      try {
        const response = await getStreams(streamType, false);

        streamOptions.value = response.list.map(
          (stream: any): StreamOption => ({
            label: stream.name,
            value: stream.name,
          }),
        );

        // Select first stream if no stream is selected or current stream is invalid
        if (streamOptions.value.length > 0) {
          if (!props.modelValue.stream) {
            // No stream selected, select first one
            props.modelValue.stream = streamOptions.value[0].value;
          } else {
            // Check if current stream is valid
            const isCurrentStreamValid = streamOptions.value.some(
              (option) => option.value === props.modelValue.stream,
            );

            if (!isCurrentStreamValid) {
              props.modelValue.stream = streamOptions.value[0].value;
            }
          }
        }
      } catch (error) {
        console.error("Error fetching stream list:", error);
        streamOptions.value = [];
      }
    }

    /**
     * Loads stream list based on current query's stream type
     */
    async function loadStreamsListBasedOnType(): Promise<void> {
      const streamType = currentStreamType.value;
      if (streamType) {
        await streamDataLoading.execute(streamType);
      }
    }

    /**
     * Filters stream options based on search input
     */
    function filterStreamOptions(
      val: string,
      update: (fn: () => void) => void,
    ): void {
      if (val === "") {
        update(() => {
          filteredStreamOptions.value = [...streamOptions.value];
        });
        return;
      }

      update(() => {
        const needle = val.toLowerCase();
        filteredStreamOptions.value = streamOptions.value.filter((stream) =>
          stream.label.toLowerCase().includes(needle),
        );
      });
    }

    /**
     * Handles join type change
     */
    function handleJoinTypeChange(type: "inner" | "left" | "right"): void {
      try {
        props.modelValue.joinType = type;
      } catch (error) {
        console.error("Error changing join type:", error);
      }
    }

    /**
     * Adds a new condition at specified index
     */
    function handleAddCondition(index: number): void {
      try {
        const newCondition = createDefaultCondition();
        props.modelValue.conditions.splice(index + 1, 0, newCondition);
      } catch (error) {
        console.error("Error adding condition:", error);
      }
    }

    /**
     * Removes condition at specified index
     */
    function handleRemoveCondition(index: number): void {
      try {
        if (props.modelValue.conditions.length <= 1) {
          console.warn("Cannot remove the last condition");
          return;
        }

        if (index < 0 || index >= props.modelValue.conditions.length) {
          console.error(`Invalid condition index: ${index}`);
          return;
        }

        props.modelValue.conditions.splice(index, 1);
      } catch (error) {
        console.error("Error removing condition:", error);
      }
    }

    const streamDataLoading = useLoading(fetchStreamList);

    onMounted(() => {
      loadStreamsListBasedOnType();
      filteredStreamOptions.value = [...streamOptions.value];
    });

    /**
     * Watch stream type changes and reload stream list
     */
    watch(currentStreamType, async () => {
      await loadStreamsListBasedOnType();
    });

    return {
      t,
      store,
      operationOptions,
      filteredStreamOptions,
      showJoinSummary,
      joinTypeLabel,
      localJoinType,
      rightFieldStreams,
      getJoinTypeLabelClass,
      getStreamsBasedJoinIndex,
      filterStreamOptions,
      handleJoinTypeChange,
      handleAddCondition,
      handleRemoveCondition,
    };
  },
});
</script>

<style lang="scss" scoped>
.join-popup-container {
  width: 624px;
}

.join-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.join-section {
  flex: 1;
  gap: 8px;
}

.join-section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--q-primary);
}

.join-connector {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 21px;
  padding-right: 10px;
  padding-left: 10px;
  color: var(--q-primary);
}

.join-type-section {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.join-type-selector {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.join-type-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  transition: opacity 0.2s;
  color: var(--q-primary);

  &:hover {
    opacity: 0.8;
  }
}

.full-width {
  width: 100%;
}

.clause-section {
  margin-bottom: 10px;
}

.clause-header {
  margin-bottom: 10px;
}

.clause-title {
  font-size: 14px;
  font-style: normal;
  font-weight: 600;
  line-height: normal;
  margin: 0;
}

.clause-description {
  font-size: 12px;
  font-style: normal;
  font-weight: 400;
  line-height: normal;
  margin: 4px 0 0 0;
}

.condition-item {
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid #eee;
  border-radius: 4px;
}

.condition-label {
  margin-bottom: 8px;
  font-weight: 500;
}

.condition-fields {
  display: flex;
  align-items: center;
  gap: 10px;
}

.field-container {
  flex: 1;
}
</style>
