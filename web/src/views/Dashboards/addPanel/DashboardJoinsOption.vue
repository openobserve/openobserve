<template>
  <div
    v-if="shouldShowJoins"
    class="w-full"
    data-test="dashboard-joins-container"
  >
    <div class="flex flex-row pl-3">
      <div
        class="text-sm whitespace-nowrap flex items-center"
        :class="labelWidthClass"
      >
        <span
          class="w-2 h-2 rounded-default mr-1.5 shrink-0 bg-badge-teal-ol-text"
          aria-hidden="true"
        ></span>
        {{ t("panel.joins") }}
      </div>
      <span class="flex items-center mx-0.5">:</span>
      <div class="pl-0.5 flex flex-row items-center flex-wrap gap-2 min-h-8" data-test="dashboard-filter-layout">
        <div
          v-for="(joinObj, index) in currentJoins"
          :key="index"
          class="flex flex-row mr-2 my-0.5"
        >
          <OButtonGroup
            class="axis-field border border-border-default border-s-2 border-s-badge-teal-ol-border bg-surface-panel"
            radius="sm"
            :divided="false"
          >
            <ODropdown>
              <template #trigger>
                <OButton
                  variant="ghost"
                  size="chip-12"
                  class="!pe-0"
                  :data-test="`dashboard-join-item-${index}`"
                  icon-right="arrow-drop-down"
                >
                  <div class="flex items-center gap-1.5">
                    <LeftJoinTypeSvg
                      v-if="joinObj?.joinType === 'left'"
                      :shouldFill="true"
                      class="h-5 w-5 shrink-0 text-text-secondary"
                    />
                    <InnerJoinTypeSvg
                      v-else-if="joinObj?.joinType === 'inner'"
                      :shouldFill="true"
                      class="h-5 w-5 shrink-0 text-text-secondary"
                    />
                    <RightJoinTypeSvg
                      v-else-if="joinObj?.joinType === 'right'"
                      :shouldFill="true"
                      class="h-5 w-5 shrink-0 text-text-secondary"
                    />
                    <span class="leading-none text-text-body">{{ joinObj?.stream }}</span>
                  </div>
                </OButton>
              </template>
              <div
                class="p-0"
                :data-test="`dashboard-join-menu-${index}`"
              >
                <AddJoinPopUp
                  v-model="currentJoins[index]"
                  :joinIndex="index"
                  :mainStream="mainStreamName"
                />
              </div>
            </ODropdown>
            <OButton
              variant="ghost"
              size="icon-chip"
              class="!w-4 -ms-1"
              :data-test="`dashboard-join-item-${index}-remove`"
              @click="handleRemoveJoin(index)"
              :aria-label="t('panel.removeJoin')"
            >
              <template #icon-left><OIcon name="close" size="xs" class="!size-2.5" /></template>
              <OTooltip :content="t('panel.removeJoin')" />
            </OButton>
          </OButtonGroup>
        </div>
        <OButton
          variant="outline"
          size="icon-chip"
          data-test="dashboard-add-join-btn"
          @click="handleAddJoin"
          :aria-label="t('panel.addJoin')"
          icon-left="add"
        >
          <OTooltip :content="t('panel.addJoin')" />
        </OButton>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, onMounted, computed } from "vue";
import OButtonGroup from "@/lib/core/Button/OButtonGroup.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18n } from "vue-i18n";
import { watchDebounced } from "@vueuse/core";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import AddJoinPopUp from "./AddJoinPopUp.vue";
import LeftJoinTypeSvg from "@/components/icons/LeftJoinTypeSvg.vue";
import InnerJoinTypeSvg from "@/components/icons/InnerJoinTypeSvg.vue";
import RightJoinTypeSvg from "@/components/icons/RightJoinTypeSvg.vue";

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

export interface Query {
  joins?: JoinConfig[];
  customQuery?: boolean;
  fields?: {
    stream?: string;
  };
}

export interface DashboardPanelData {
  data: {
    queries: Query[];
    queryType?: string;
  };
  layout: {
    currentQueryIndex: number;
  };
}

const JOIN_LOGICAL_OPERATORS = {
  AND: "AND",
  OR: "OR",
} as const;

const JOIN_TYPES = {
  INNER: "inner",
  LEFT: "left",
  RIGHT: "right",
} as const;

export default defineComponent({
  name: "DashboardJoinOption",

  components: {
    OButtonGroup,
    OButton,
    ODropdown,
    AddJoinPopUp,
    OTooltip,
    OIcon,
    LeftJoinTypeSvg,
    InnerJoinTypeSvg,
    RightJoinTypeSvg,
  },

  // labelWidthClass keeps the ":" separator aligned with the parent chart's
  // axis labels (e.g. geomap's wider "Longitude"). Defaults to the main
  // builder's width.
  props: {
    labelWidthClass: { type: String, default: "min-w-20" },
  },

  setup() {
    const dashboardPanelDataPageKey = inject<string>(
      "dashboardPanelDataPageKey",
      "dashboard",
    );

    const { dashboardPanelData } = useDashboardPanelData(
      dashboardPanelDataPageKey,
    );

    const { t } = useI18n();

    /**
     * Determines if joins section should be displayed
     * Hidden when custom query is enabled with SQL query type
     */
    const shouldShowJoins = computed(() => {
      const currentQuery = getCurrentQuery();
      if (!currentQuery) return false;

      return !(
        currentQuery.customQuery && dashboardPanelData.data.queryType === "sql"
      );
    });

    /**
     * Gets the current query joins array
     */
    const currentJoins = computed(() => {
      return getCurrentQuery()?.joins ?? [];
    });

    /**
     * Gets the main stream name for the current query
     */
    const mainStreamName = computed(() => {
      return getCurrentQuery()?.fields?.stream ?? "";
    });

    /**
     * Gets the current query object safely
     */
    function getCurrentQuery(): Query | undefined {
      try {
        const queries = dashboardPanelData?.data?.queries;
        const currentIndex = dashboardPanelData?.layout?.currentQueryIndex ?? 0;

        if (
          !Array.isArray(queries) ||
          currentIndex < 0 ||
          currentIndex >= queries.length
        ) {
          return undefined;
        }

        return queries[currentIndex];
      } catch (error) {
        console.error("Error getting current query:", error);
        return undefined;
      }
    }

    /**
     * Creates a default join configuration
     */
    function createDefaultJoinConfig(): JoinConfig {
      return {
        stream: "",
        streamAlias: "",
        joinType: JOIN_TYPES.INNER,
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
            logicalOperator: JOIN_LOGICAL_OPERATORS.AND,
            operation: "=",
          },
        ],
      };
    }

    /**
     * Initializes joins array for all queries if not present
     * Ensures backward compatibility with older dashboard versions
     */
    function initializeJoinsArray(): void {
      try {
        const queries = dashboardPanelData?.data?.queries;
        if (!Array.isArray(queries)) return;

        queries.forEach((query) => {
          if (!query.joins) {
            query.joins = [];
          }
        });
      } catch (error) {
        console.error("Error initializing joins array:", error);
      }
    }

    /**
     * Generates unique stream aliases for all joins
     * Uses pattern: stream_0, stream_1, stream_2, etc.
     */
    function updateStreamAliases(): void {
      try {
        const currentQuery = getCurrentQuery();
        if (!currentQuery?.joins) return;

        currentQuery.joins.forEach((join, index) => {
          if (join.stream && !join.streamAlias) {
            join.streamAlias = `stream_${index}`;
          }
        });
      } catch (error) {
        console.error("Error updating stream aliases:", error);
      }
    }

    /**
     * Adds a new join to the current query
     */
    function handleAddJoin(): void {
      try {
        // Ensure joins array exists
        initializeJoinsArray();

        const currentQuery = getCurrentQuery();
        if (!currentQuery) {
          console.error("Cannot add join: current query not found");
          return;
        }

        if (!currentQuery.joins) {
          currentQuery.joins = [];
        }

        const newJoin = createDefaultJoinConfig();
        currentQuery.joins.push(newJoin);
      } catch (error) {
        console.error("Error adding join:", error);
      }
    }

    /**
     * Removes a join from the current query
     * @param index Index of the join to remove
     */
    function handleRemoveJoin(index: number): void {
      try {
        const currentQuery = getCurrentQuery();
        if (!currentQuery?.joins) {
          console.error("Cannot remove join: joins array not found");
          return;
        }

        if (index < 0 || index >= currentQuery.joins.length) {
          console.error(`Cannot remove join: invalid index ${index}`);
          return;
        }

        currentQuery.joins.splice(index, 1);
      } catch (error) {
        console.error("Error removing join:", error);
      }
    }

    onMounted(() => {
      initializeJoinsArray();
    });

    /**
     * Watch joins array and update stream aliases
     * Uses debouncing to avoid excessive updates during rapid changes
     */
    watchDebounced(
      () => currentJoins.value,
      () => {
        updateStreamAliases();
      },
      { debounce: 300, deep: true },
    );

    return {
      t,
      dashboardPanelData,
      shouldShowJoins,
      currentJoins,
      mainStreamName,
      handleAddJoin,
      handleRemoveJoin,
    };
  },
});
</script>

