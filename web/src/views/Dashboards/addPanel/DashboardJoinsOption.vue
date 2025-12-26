<template>
  <div v-if="shouldShowJoins" class="joins-container">
    <div class="joins-header">
      <div class="layout-name">{{ t("panel.joins") }}</div>
      <span class="layout-separator">:</span>
      <div
        class="joins-list"
        data-test="dashboard-filter-layout"
      >
        <div
          v-for="(joinObj, index) in currentJoins"
          :key="index"
          class="join-item"
        >
          <q-btn-group class="axis-field">
            <div>
              <q-btn
                no-caps
                dense
                color="primary"
                icon-right="arrow_drop_down"
                square
                :no-wrap="true"
                size="sm"
                :data-test="`dashboard-join-item-${index}`"
                class="q-pl-sm"
              >
                <div class="join-btn-content">
                  <LeftJoinTypeSvg
                    v-if="joinObj?.joinType === 'left'"
                    :shouldFill="true"
                    class="join-type-icon"
                  />
                  <InnerJoinTypeSvg
                    v-else-if="joinObj?.joinType === 'inner'"
                    :shouldFill="true"
                    class="join-type-icon"
                  />
                  <RightJoinTypeSvg
                    v-else-if="joinObj?.joinType === 'right'"
                    :shouldFill="true"
                    class="join-type-icon"
                  />
                  <span class="join-stream-label">{{ joinObj?.stream }}</span>
                </div>
                <q-menu
                  class="q-pa-md"
                  :data-test="`dashboard-join-menu-${index}`"
                >
                  <AddJoinPopUp
                    :class="themeClass"
                    v-model="currentJoins[index]"
                    :joinIndex="index"
                    :mainStream="mainStreamName"
                  />
                </q-menu>
              </q-btn>
              <q-btn
                class="remove-join-btn"
                size="xs"
                dense
                :data-test="`dashboard-join-item-${index}-remove`"
                icon="close"
                @click="handleRemoveJoin(index)"
                :aria-label="t('panel.removeJoin')"
              >
                <q-tooltip>{{ t('panel.removeJoin') }}</q-tooltip>
              </q-btn>
            </div>
          </q-btn-group>
        </div>
        <q-btn
          icon="add"
          color="primary"
          size="xs"
          round
          class="add-btn"
          data-test="dashboard-add-join-btn"
          @click="handleAddJoin"
          :aria-label="t('panel.addJoin')"
        >
          <q-tooltip>{{ t('panel.addJoin') }}</q-tooltip>
        </q-btn>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, inject, onMounted, computed, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { watchDebounced } from "@vueuse/core";
import useDashboardPanelData from "../../../composables/useDashboardPanel";
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

const JOIN_OPERATIONS = ["=", "!=", ">", "<", ">=", "<="] as const;

export default defineComponent({
  name: "DashboardJoinOption",

  components: {
    AddJoinPopUp,
    LeftJoinTypeSvg,
    InnerJoinTypeSvg,
    RightJoinTypeSvg,
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
    const store = useStore();

    /**
     * Determines if joins section should be displayed
     * Hidden when custom query is enabled with SQL query type
     */
    const shouldShowJoins = computed(() => {
      const currentQuery = getCurrentQuery();
      if (!currentQuery) return false;

      return !(
        currentQuery.customQuery &&
        dashboardPanelData.data.queryType === "sql"
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
     * Returns theme class based on current theme
     */
    const themeClass = computed(() => {
      return store.state.theme === "dark" ? "dark-mode" : "bg-white";
    });

    /**
     * Gets the current query object safely
     */
    function getCurrentQuery(): Query | undefined {
      try {
        const queries = dashboardPanelData?.data?.queries;
        const currentIndex = dashboardPanelData?.layout?.currentQueryIndex ?? 0;

        if (!Array.isArray(queries) || currentIndex < 0 || currentIndex >= queries.length) {
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
      { debounce: 300, deep: true }
    );

    return {
      t,
      store,
      dashboardPanelData,
      shouldShowJoins,
      currentJoins,
      mainStreamName,
      themeClass,
      handleAddJoin,
      handleRemoveJoin,
    };
  },
});
</script>

<style lang="scss" scoped>
.joins-container {
  width: 100%;
}

.joins-header {
  display: flex;
  flex-direction: row;
  padding-left: 16px;
}

.layout-name {
  font-size: 14px;
  white-space: nowrap;
  min-width: 130px;
  display: flex;
  align-items: center;
}

.layout-separator {
  display: flex;
  align-items: center;
  margin-left: 2px;
  margin-right: 2px;
}

.joins-list {
  margin: 5px;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: 8px;
}

.join-item {
  display: flex;
  flex-direction: row;
  margin-right: 8px;
  margin-top: 4px;
  margin-bottom: 4px;
}

.remove-join-btn {
  padding-top: 6px;
  height: 100%;
}

.add-btn {
  margin-top: 4px;
  height: 24px !important;
  padding: 0 !important;
}

.axis-field {
  display: flex;
  align-items: center;
}

.join-btn-content {
  display: flex;
  align-items: center;
  gap: 6px;
}

.join-type-icon {
  height: 20px;
  width: 20px;
  flex-shrink: 0;
  filter: brightness(0) invert(1);
}

.join-stream-label {
  line-height: 1;
}
</style>
