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
  <div>
    <div class="flex gap-1">
      <!-- Query Type: SQL / PromQL -->
      <OToggleGroup
        v-if="showQueryType"
        variant="primary"
        :model-value="selectedButtonQueryType"
        @update:model-value="onUpdateQueryMode($event as string)"
      >
        <OToggleGroupItem
          value="sql"
          size="sm"
          data-test="dashboard-sql-query-type"
        >
          <template #icon-left><OIcon name="database" size="xs" class="shrink-0" /></template>
          {{ t("panel.SQL") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          v-if="dashboardPanelData.data.queries[dashboardPanelData.layout.currentQueryIndex].fields.stream_type == 'metrics'"
          value="promql"
          size="sm"
          data-test="dashboard-promql-query-type"
        >
          <template #icon-left><OIcon name="show-chart" size="xs" class="shrink-0" /></template>
          {{ t("panel.promQL") }}
        </OToggleGroupItem>
      </OToggleGroup>

      <!-- Builder Mode: Builder / Custom -->
      <OToggleGroup
        variant="primary"
        :model-value="selectedButtonType"
        @update:model-value="onUpdateBuilderMode($event as string)"
      >
        <OToggleGroupItem
          v-if="dashboardPanelData.data.type != 'custom_chart'"
          value="builder"
          size="sm"
          data-test="dashboard-builder-query-type"
        >
          <template #icon-left><OIcon name="build" size="xs" class="shrink-0" /></template>
          {{ t("panel.builder") }}
        </OToggleGroupItem>
        <OToggleGroupItem
          value="custom"
          size="sm"
          data-test="dashboard-custom-query-type"
        >
          <template #icon-left><OIcon name="code" size="xs" class="shrink-0" /></template>
          {{ t("panel.custom") }}
        </OToggleGroupItem>
      </OToggleGroup>
    </div>
    <ConfirmDialog
      :title="t('dashboard.queryTypeSelector.changeQueryMode')"
      :message="confirmDialogMessage"
      @update:ok="changeToggle()"
      @update:cancel="confirmQueryModeChangeDialog = false"
      v-model="confirmQueryModeChangeDialog"
    />
  </div>
</template>

<script lang="ts">
import {
  defineComponent,
  ref,
  watch,
  onMounted,
  nextTick,
  inject,
  computed,
} from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import useDashboardPanelData from "../../../composables/dashboard/useDashboardPanel";
import useDefaultPanelFields from "@/composables/dashboard/useDefaultPanelFields";
import ConfirmDialog from "../../ConfirmDialog.vue";
import { useStore } from "vuex";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

export default defineComponent({
  name: "QueryTypeSelector",
  component: { ConfirmDialog },
  props: {
    showQueryType: {
      type: Boolean,
      default: true,
    },
  },
  emits: [],
  setup() {
    const router = useRouter();
    const { t } = useI18n();
    const store = useStore();
    const dashboardPanelDataPageKey = inject(
      "dashboardPanelDataPageKey",
      "dashboard",
    );
    const {
      dashboardPanelData,
      removeXYFilters,
      updateXYFieldsForCustomQueryMode,
    } = useDashboardPanelData(dashboardPanelDataPageKey);
    const { applyDefaultPanelFields } = useDefaultPanelFields(
      dashboardPanelDataPageKey,
    );
    // Pages that re-seed default builder fields on the in-page Builder toggle.
    // (Entering a builder surface parses on mount, not via this handler.)
    const SEED_ON_TOGGLE_PAGES = ["dashboard", "metrics", "build", "logs"];
    const confirmQueryModeChangeDialog = ref(false);
    const confirmDialogMessage = ref(
      t("dashboard.queryTypeSelector.changeQueryModeConfirm"),
    );

    const selectedButtonQueryType = ref("sql");
    // this is the value of the current button
    const selectedButtonType = ref("builder");

    // this holds the temporary value of the button while user confirms the choice on popup
    const popupSelectedButtonType = ref("auto");

    const ignoreSelectedButtonTypeUpdate = ref(false);

    const initializeSelectedButtonType = async () => {
      // set a variable to ignore updates for selectedButtonType

      ignoreSelectedButtonTypeUpdate.value = true;
      selectedButtonQueryType.value = dashboardPanelData.data.queryType;
      selectedButtonType.value = dashboardPanelData.data.queries[
        dashboardPanelData.layout.currentQueryIndex
      ]?.customQuery
        ? "custom"
        : "builder";

      if (dashboardPanelData.data.type == "custom_chart") {
        // For custom_chart, check the actual query type and customQuery flag
        selectedButtonType.value = "custom";
        ignoreSelectedButtonTypeUpdate.value = false;
        return;
      }

      // if the query type is not present, set the value to "sql"
      if (
        !dashboardPanelData.data.queryType ||
        dashboardPanelData.data.queryType == ""
      ) {
        dashboardPanelData.data.queryType = "sql";
      }

      await nextTick();

      // set a variable to allow watcher updates for selectedButtonType
      ignoreSelectedButtonTypeUpdate.value = false;
    };

    onMounted(async () => {
      initializeSelectedButtonType();
    });

    // onActivated(async () => {
    //     initializeSelectedButtonType()
    // })

    // when the data is loaded, initialize the selectedButtonType
    watch(
      () => [
        dashboardPanelData.data.queryType,
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].customQuery,
      ],
      () => {
        initializeSelectedButtonType();
      },
    );

    // re-sync the toggle when switching between query tabs
    watch(
      () => dashboardPanelData.layout.currentQueryIndex,
      () => {
        initializeSelectedButtonType();
      },
    );

    const isPromQLMode = computed(
      () => selectedButtonQueryType.value === "promql",
    );

    const isBuilderMode = computed(
      () => selectedButtonType.value === "builder",
    );

    const isCustomMode = computed(() => selectedButtonType.value === "custom");

    const onUpdateQueryMode = (selectedQueryType: any) => {
      // Should we show popup of query being cleared

      popupSelectedButtonType.value = selectedQueryType;
      changeToggle();
      dashboardPanelData.layout.showQueryBar = true;
      // if (selectedQueryType != selectedButtonQueryType.value) {
      //   // some exceptions
      //   // If user is switching from auto to custom, promql to auto, promql to custom-sql,
      //   // promql-builder to promql, or promql-builder to auto no need for the popup,
      //   // else show the popup
      //   if (
      //     (isSQLMode.value &&
      //       isBuilderMode.value &&
      //       selectedQueryType == "custom") ||
      //     (isPromQLMode.value &&
      //       isBuilderMode.value &&
      //       selectedQueryType == "custom")
      //   ) {
      //     // act like you confirmed without opening the popup

      //   } else {
      //     popupSelectedButtonType.value = selectedQueryType;
      //     dashboardPanelData.data.queries[0].query != ""
      //       ? (confirmQueryModeChangeDialog.value = true)
      //       : changeToggle();
      //   }
      // }
    };

    const onUpdateBuilderMode = (selectedQueryType: any) => {
      if (selectedQueryType != selectedButtonType.value) {
        // some exceptions
        // If user is switching from auto to custom, promql to auto, promql to custom-sql,
        // promql-builder to promql, or promql-builder to auto no need for the popup,
        // else show the popup
        if (isBuilderMode.value && selectedQueryType == "custom") {
          // act like you confirmed without opening the popup
          popupSelectedButtonType.value = selectedQueryType;
          changeToggle();
          dashboardPanelData.layout.showQueryBar = true;
        } else {
          popupSelectedButtonType.value = selectedQueryType;

          // Set appropriate message based on the transition
          if (
            isPromQLMode.value &&
            isCustomMode.value &&
            selectedQueryType === "builder"
          ) {
            // Switching from PromQL custom to builder
            confirmDialogMessage.value = t(
              "dashboard.queryTypeSelector.switchToBuilderConfirm",
            );
          } else {
            // Default message for other transitions
            confirmDialogMessage.value = t(
              "dashboard.queryTypeSelector.changeQueryModeConfirm",
            );
          }

          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].query != ""
            ? (confirmQueryModeChangeDialog.value = true)
            : changeToggle();
        }
      }
    };

    const changeToggle = async () => {
      const isQueryTypeChange =
        popupSelectedButtonType.value === "promql" ||
        popupSelectedButtonType.value === "sql";

      if (isQueryTypeChange) {
        selectedButtonQueryType.value = popupSelectedButtonType.value;
      } else {
        selectedButtonType.value = popupSelectedButtonType.value;
      }

      await nextTick(); // let the watchers execute first
      removeXYFilters();
      updateXYFieldsForCustomQueryMode();

      // Clear queries for all tabs when switching query types (SQL <-> PromQL)
      // since the syntax is incompatible between modes
      if (
        isQueryTypeChange &&
        dashboardPanelData.data.type !== "custom_chart"
      ) {
        dashboardPanelData.data.queries.forEach((q: any) => {
          q.query = "";
        });
      }


      // removeXYFilters() above wiped the builder fields; re-seed defaults when
      // the resulting mode is a builder.
      const seedQueryIdx = dashboardPanelData.layout.currentQueryIndex;
      const seedQuery = dashboardPanelData.data.queries[seedQueryIdx];
      const resultingBuilderMode = !seedQuery?.customQuery;
      const shouldSeedDefaults =
        resultingBuilderMode &&
        SEED_ON_TOGGLE_PAGES.includes(dashboardPanelDataPageKey);
      if (shouldSeedDefaults) {
        await applyDefaultPanelFields();
      }

      // empty the errors
      dashboardPanelData.meta.errors.queryErrors = [];

      // if (selectedButtonType.value == "promql") {
      //   dashboardPanelData.layout.currentQueryIndex = 0;
      //   dashboardPanelData.data.queries = dashboardPanelData.data.queries.slice(
      //     0,
      //     1
      //   );
      // }
      dashboardPanelData.layout.showQueryBar = true;
    };

    watch(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ].fields.stream_type,
      () => {
        // Switch from PromQL to SQL when changing from metrics to logs/other stream types
        if (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].fields.stream_type != "metrics" &&
          selectedButtonQueryType.value === "promql"
        ) {
          selectedButtonQueryType.value = "sql";
          selectedButtonType.value = "builder";
          dashboardPanelData.data.queryType = "sql";
          // Clear the query since we're switching query types
          if (dashboardPanelData.data.type !== "custom_chart") {
            dashboardPanelData.data.queries[
              dashboardPanelData.layout.currentQueryIndex
            ].query = "";
          }
        }
      },
    );

    /**
     * Picking the `metrics` stream type selects PromQL.
     *
     * SQL over a metrics stream is legal but it is not what anyone reaching for a
     * metric wants — they want PromQL, and having to notice and flip a toggle to
     * get it is a step with no decision in it. The panel then seeds itself with
     * the metric's default function (see `useDefaultPanelFields`).
     *
     * Only on a panel with no query: an existing SQL-over-metrics panel opened
     * for editing keeps its query type. SQL stays one click away.
     */
    watch(
      () =>
        dashboardPanelData.data.queries[
          dashboardPanelData.layout.currentQueryIndex
        ]?.fields?.stream_type,
      async (streamType) => {
        if (streamType !== "metrics") return;
        if (dashboardPanelData.data.queryType === "promql") return;
        if (dashboardPanelData.data.type === "custom_chart") return;

        const query =
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ];
        if (!query) return;

        // A SAVED panel is never converted, full stop. Its id is assigned when
        // it is loaded for editing (new panels carry `id: ""`), and — unlike the
        // stream guard below — it survives a stream-TYPE change, which clears
        // `fields.stream` before this watcher runs. Without this, flipping the
        // stream type to `metrics` on a saved SQL panel went through
        // `changeToggle()` and silently wiped every query, axis and filter.
        if (dashboardPanelData.data.id) return;

        // A stream is already chosen ⇒ this is not a fresh selection: either an
        // existing panel is being loaded for editing (whose query type is the
        // user's, not ours to change), or they have already built something.
        // Changing the stream TYPE clears the stream, so the new-panel flow
        // reaches here with it empty.
        if (query.fields?.stream) return;

        // A hand-written query is never overridden. NOT `query.query` alone: the
        // editor auto-generates a SQL query (`SELECT … FROM ""`) before a stream
        // is even picked, so a non-empty query is not evidence the user wrote one
        // — `customQuery` is.
        if (query.customQuery && query.query) return;

        // Everything above inspects the CURRENT slot, but `changeToggle` is
        // panel-wide: it flips `data.queryType` and clears EVERY query, because
        // SQL and PromQL are not interchangeable. So the other slots get a say —
        // a SQL panel can reasonably gain a second query on a metrics stream.
        // "Has work" = a query string AND a stream to run it against: a slot the
        // user has not pointed at anything yet still carries the editor's
        // placeholder SQL (`SELECT histogram(_timestamp) … FROM ""`), and treating
        // that as work would block the auto-select on the brand-new panels it
        // exists for.
        const siblingsHaveWork = dashboardPanelData.data.queries.some(
          (q: any, index: number) =>
            index !== dashboardPanelData.layout.currentQueryIndex &&
            !!q?.query?.trim() &&
            !!q?.fields?.stream,
        );
        if (siblingsHaveWork) return;

        // WAIT for the DOM. The PromQL item in the toggle group is `v-if`-ed on
        // `stream_type == "metrics"`, so at this instant it does not exist yet —
        // setting the group's value to "promql" now makes it reject an unknown
        // value and snap back to "sql", which the watcher below then writes into
        // the panel. One tick later the item is rendered and the value sticks.
        await nextTick();
        if (
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ]?.fields?.stream_type !== "metrics"
        ) {
          return;
        }

        // Go through `changeToggle`, exactly as a click on the PromQL button
        // would. Assigning `data.queryType` directly looked equivalent and was
        // not: it skipped `removeXYFilters()`, so the X/Y fields a new panel
        // ships with (`x_axis_1` / `y_axis_1` — visible in the placeholder SQL
        // `SELECT histogram(_timestamp) … FROM ""`) survived into PromQL mode and
        // the panel failed validation on Apply with "X-Axis is not supported for
        // PromQL". This one call clears X/Y and the filters, drops the
        // now-incompatible SQL query, and re-seeds the builder defaults.
        query.customQuery = false;
        popupSelectedButtonType.value = "promql";
        await changeToggle();
      },
    );

    watch(selectedButtonQueryType, () => {
      window.dispatchEvent(new Event("resize"));
      if (!ignoreSelectedButtonTypeUpdate.value) {
        if (selectedButtonQueryType.value) {
          dashboardPanelData.data.queryType = selectedButtonQueryType.value;
        } else {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery = false;
          dashboardPanelData.data.queryType = "sql";
        }

        // Preserve the query when switching query types
        // Query should remain intact when switching between SQL and PromQL
      }
    });

    watch(selectedButtonType, () => {
      window.dispatchEvent(new Event("resize"));
      if (!ignoreSelectedButtonTypeUpdate.value) {
        if (selectedButtonType.value) {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery = selectedButtonType.value === "custom";
        } else {
          dashboardPanelData.data.queries[
            dashboardPanelData.layout.currentQueryIndex
          ].customQuery = false;
          dashboardPanelData.data.queryType = "sql";
        }

        // Don't clear the query when switching between builder and custom modes in PromQL
        // Only clear when switching query types (SQL/PromQL) and not for custom_chart
        // Query should be preserved when switching from builder to custom or vice versa
      }
    });

    return {
      t,
      router,
      dashboardPanelData,
      onUpdateBuilderMode,
      onUpdateQueryMode,
      changeToggle,
      confirmQueryModeChangeDialog,
      confirmDialogMessage,
      selectedButtonType,
      store,
      selectedButtonQueryType,
    };
  },
  components: { ConfirmDialog, OToggleGroup, OToggleGroupItem, OIcon },
});
</script>

