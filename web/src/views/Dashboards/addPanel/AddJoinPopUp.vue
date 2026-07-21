<!-- Copyright 2026 OpenObserve Inc.

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
  <div data-test="dashboard-join-pop-up" class="w-156 flex flex-col max-h-[54vh] overflow-hidden">
    <div class="flex justify-between items-center mb-3.75" data-test="dashboard-join-pop-up-header">
      <div class="flex-1 gap-2">
        <div class="flex items-center gap-2 text-theme-accent">
          <LeftJoinSvg class="h-5.25" />
          <label>{{ t('dashboard.addJoinPopUp.join') }}</label>
        </div>
        <OSelect
          :model-value="mainStream"
          :options="[]"
          disabled
          :label="t('dashboard.addJoinPopUp.joiningStream')"
          data-test="dashboard-config-panel-join-from"
        />
      </div>

      <div class="flex items-center gap-2 pt-5.25 px-2.5 text-theme-accent">
        <LeftJoinLineSvg class="h-10 w-14.5" />
      </div>

      <div class="flex flex-col items-center">
        <label for="joinType">{{ t('dashboard.addJoinPopUp.joinType') }}</label>
        <div class="flex justify-center items-center gap-2">
          <div
            class="flex flex-col items-center cursor-pointer transition-opacity duration-200 text-theme-accent hover:opacity-80"
            @click="handleJoinTypeChange('left')"
            :aria-label="t('panel.leftJoin')"
            data-test="dashboard-join-type-left"
          >
            <LeftJoinTypeSvg :shouldFill="localJoinType === 'left'" />
            <div :class="getJoinTypeLabelClass('left')">{{ t('dashboard.addJoinPopUp.left') }}</div>
          </div>
          <div
            class="flex flex-col items-center cursor-pointer transition-opacity duration-200 text-theme-accent hover:opacity-80"
            @click="handleJoinTypeChange('inner')"
            :aria-label="t('panel.innerJoin')"
            data-test="dashboard-join-type-inner"
          >
            <InnerJoinTypeSvg :shouldFill="localJoinType === 'inner'" />
            <div :class="getJoinTypeLabelClass('inner')">{{ t('dashboard.addJoinPopUp.inner') }}</div>
          </div>
          <div
            class="flex flex-col items-center cursor-pointer transition-opacity duration-200 text-theme-accent hover:opacity-80"
            @click="handleJoinTypeChange('right')"
            :aria-label="t('panel.rightJoin')"
            data-test="dashboard-join-type-right"
          >
            <RightJoinTypeSvg :shouldFill="localJoinType === 'right'" />
            <div :class="getJoinTypeLabelClass('right')">{{ t('dashboard.addJoinPopUp.right') }}</div>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 pt-5.25 px-2.5 text-theme-accent">
        <RightJoinLineSvg class="h-10 w-14.5" />
      </div>

      <div class="flex-1 gap-2">
        <div class="flex items-center gap-2 text-theme-accent">
          <RightJoinSvg class="h-5.25" />
          <label>{{ t('dashboard.addJoinPopUp.on') }}</label>
        </div>

        <OSelect
          v-model="modelValueModel.stream"
          :options="streamOptions"
          :label="t('dashboard.addJoinPopUp.onStream')"
          searchable
          data-test="dashboard-config-panel-join-to"
        />
      </div>
    </div>

    <div class="flex items-center gap-4">
      <div class="border-t border-border-default flex-1"></div>
      <div
        class="py-2 text-center text-xs text-text-body"
        v-if="showJoinSummary"
      >
        {{ t('dashboard.addJoinPopUp.performing') }}
        <span
          class="inline-flex items-center rounded-default px-1.5 py-0.5 text-xs font-semibold bg-[color-mix(in_srgb,var(--color-accent)_15%,transparent)] text-accent"
        >{{ joinTypeLabel }} {{ t('dashboard.addJoinPopUp.join') }}</span> {{ t('dashboard.addJoinPopUp.between') }}
        <span class="font-semibold">{{ mainStream }}</span> {{ t('dashboard.addJoinPopUp.and') }}
        <span class="font-semibold">{{ modelValue.stream }}</span>
      </div>
      <div class="border-t border-border-default flex-1"></div>
    </div>

    <div class="mb-2.5 flex flex-col min-h-0 flex-1">
      <div class="mb-2.5 shrink-0">
        <h3 class="text-sm not-italic font-semibold leading-normal m-0">{{ t('dashboard.addJoinPopUp.joiningClause') }}</h3>
        <p class="text-xs not-italic font-normal leading-normal mt-1 mb-0 mx-0">
          {{ t('dashboard.addJoinPopUp.selectFieldsDescription') }}
        </p>
      </div>

      <div
        class="flex-1 min-h-0 overflow-y-auto"
        data-test="dashboard-join-clause-list"
      >
      <div
        v-for="(arg, argIndex) in modelValue.conditions"
        :key="argIndex + JSON.stringify(arg)"
        class="mb-2.5 p-2.5 border border-border-default rounded-default"
      >
        <div class="mb-2 font-medium">{{ t('dashboard.addJoinPopUp.clause', { number: argIndex + 1 }) }}</div>
        <div class="flex items-center gap-2.5">
          <div class="flex-1 min-w-0 overflow-hidden">
            <StreamFieldSelect
              :streams="getStreamsBasedJoinIndex()"
              v-model="modelValueModel.conditions[argIndex].leftField"
              :data-test="`dashboard-join-condition-left-field-${argIndex}`"
            />
          </div>

          <div class="flex-1 min-w-0 overflow-hidden">
            <OSelect
              :label-position="'inside'"
              v-model="modelValueModel.conditions[argIndex].operation"
              :options="operationSelectOptions"
              :label="t('dashboard.addJoinPopUp.selectOperation')"
              :data-test="`dashboard-join-condition-operation-${argIndex}`"
            />
          </div>

          <div class="flex-1 min-w-0 overflow-hidden">
            <StreamFieldSelect
              :streams="rightFieldStreams"
              v-model="modelValueModel.conditions[argIndex].rightField"
              :data-test="`dashboard-join-condition-right-field-${argIndex}`"
            />
          </div>

          <OButton
            variant="ghost"
            size="icon"
            :aria-label="t('panel.addClause')"
            :data-test="`dashboard-join-condition-add-${argIndex}`"
            @click="handleAddCondition(argIndex)"
            icon-left="add"
          >
            <template #icon-left><OIcon name="add" size="sm" /></template>
            <OTooltip :content="t('dashboard.addJoinPopUp.addAnotherClause')" />
          </OButton>

          <OButton
            variant="ghost"
            size="icon-circle"
            :data-test="`dashboard-join-condition-remove-${argIndex}`"
            :disabled="modelValue.conditions.length === 1"
            @click="handleRemoveCondition(argIndex)"
            :aria-label="t('panel.removeClause')"
            icon-left="close"
          >
            <template #icon-left><OIcon name="close" size="sm" /></template>
            <OTooltip :content="t('dashboard.addJoinPopUp.removeClause')" />
          </OButton>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
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
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
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

// Shape returned by useStreams' getStreams for a specific stream type.
interface StreamListEntry {
  name: string;
}

interface GetStreamsResponse {
  name: string;
  list: StreamListEntry[];
  schema: boolean;
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

const JOIN_OPERATIONS = ["=", "!=", ">", "<", ">=", "<="] as const;

const JOIN_LOGICAL_OPERATORS = {
  AND: "AND",
  OR: "OR",
} as const;

export default defineComponent({
  name: "AddJoinPopUp",

  components: {
    OButton,
    OSelect,
    OTooltip,
    StreamFieldSelect,
    LeftJoinSvg,
    LeftJoinTypeSvg,
    LeftJoinLineSvg,
    RightJoinSvg,
    RightJoinTypeSvg,
    RightJoinLineSvg,
    InnerJoinTypeSvg,
    OIcon,
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

    // Same reference as props.modelValue; mutation targets its nested fields only.
    const modelValueModel = computed(() => props.modelValue);

    const streamOptions = ref<StreamOption[]>([]);
    const operationOptions = [...JOIN_OPERATIONS];
    const operationSelectOptions = operationOptions.map((op) => ({
      label: op,
      value: op,
    }));

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
        ? "text-primary font-[600]"
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
        const response = (await getStreams(
          streamType,
          false,
        )) as GetStreamsResponse;

        streamOptions.value = response.list.map(
          (stream: StreamListEntry): StreamOption => ({
            label: stream.name,
            value: stream.name,
          }),
        );

        // Select first stream if no stream is selected or current stream is invalid
        if (streamOptions.value.length > 0) {
          if (!props.modelValue.stream) {
            // No stream selected, select first one
            modelValueModel.value.stream = streamOptions.value[0].value;
          } else {
            // Check if current stream is valid
            const isCurrentStreamValid = streamOptions.value.some(
              (option) => option.value === props.modelValue.stream,
            );

            if (!isCurrentStreamValid) {
              modelValueModel.value.stream = streamOptions.value[0].value;
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
     * Handles join type change
     */
    function handleJoinTypeChange(type: "inner" | "left" | "right"): void {
      try {
        modelValueModel.value.joinType = type;
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
        modelValueModel.value.conditions.splice(index + 1, 0, newCondition);
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

        modelValueModel.value.conditions.splice(index, 1);
      } catch (error) {
        console.error("Error removing condition:", error);
      }
    }

    const streamDataLoading = useLoading(fetchStreamList);

    onMounted(() => {
      loadStreamsListBasedOnType();
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
      modelValueModel,
      operationOptions,
      operationSelectOptions,
      streamOptions,
      showJoinSummary,
      joinTypeLabel,
      localJoinType,
      rightFieldStreams,
      getJoinTypeLabelClass,
      getStreamsBasedJoinIndex,
      handleJoinTypeChange,
      handleAddCondition,
      handleRemoveCondition,
    };
  },
});
</script>
