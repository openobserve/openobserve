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

<!-- eslint-disable vue/v-on-event-hyphenation -->
<!-- eslint-disable vue/attribute-hyphenation -->
<template>
  <div class="rounded-default relative-position">
    <!-- Resolving the _rumdata schema to decide whether browser Web Vitals exist -->
    <div
      v-if="!schemaResolved"
      data-test="web-vitals-dashboard-schema-loading"
      class="flex h-[calc(100vh-15.625rem)] w-full items-center justify-center pb-4 text-center"
    >
      <div>
        <OSpinner size="md" class="mx-auto block" />
        <div class="w-full text-center">Loading Dashboard</div>
      </div>
    </div>

    <!--
      Mobile-only stream: the browser Web Vital columns don't exist, so the
      dashboard queries would fail. Show a friendly explanation instead of
      firing six doomed queries.
    -->
    <OEmptyState
      v-else-if="showBrowserOnlyEmpty"
      data-test="web-vitals-dashboard-browser-only-empty"
      size="block"
      illustration="browser-check"
      :hide-action="true"
    >
      <template #title>{{ t("rum.webVitalsBrowserOnlyTitle") }}</template>
      <template #description>{{ t("rum.webVitalsBrowserOnlyDescription") }}</template>
    </OEmptyState>

    <!-- Browser RUM data present (or schema inconclusive): render the dashboard -->
    <template v-else>
      <div class="performance-dashboard" :class="isLoading.length ? 'invisible' : 'visible'">
        <div
          data-test="learn-web-vitals-link"
          class="rounded-default bg-badge-indigo-soft-bg mt-2 ml-3 flex w-fit items-center px-2 py-1 text-sm font-bold"
        >
          <OIcon name="info" size="sm" class="mr-1" />
          {{ t("rum.learnWebVitalsLabel") }}
          <a
            href="https://web.dev/articles/vitals"
            title="https://web.dev/articles/vitals"
            class="text-badge-indigo-soft-text ml-1"
            target="_blank"
          >
            {{ t("rum.clickHereLabel") }}
          </a>
        </div>
        <RenderDashboardCharts
          ref="webVitalsChartsRef"
          :viewOnly="true"
          :frame="false"
          :dashboardData="currentDashboardData.data"
          :currentTimeObj="dateTime"
          searchType="RUM"
          @variablesManagerReady="onVariablesManagerReady"
          @updated:data-zoom="onDataZoom"
        />
      </div>
      <div
        v-show="isLoading.length"
        class="absolute top-0 flex h-[calc(100vh-15.625rem)] w-full items-center justify-center pb-4 text-center"
      >
        <div>
          <OSpinner size="md" class="mx-auto block" />
          <div class="w-full text-center">Loading Dashboard</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts">
// @ts-nocheck
import {
  defineComponent,
  ref,
  computed,
  watch,
  onActivated,
  nextTick,
  onMounted,
  type Ref,
} from "vue";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { getDashboard } from "@/utils/commons.ts";
import usePerformance from "@/composables/rum/usePerformance";
import useStreams from "@/composables/useStreams";
import {
  parseDuration,
  generateDurationLabel,
  getDurationObjectFromParams,
  getQueryParamsForDuration,
} from "@/utils/date";
import { reactive } from "vue";
import { useRoute } from "vue-router";
import RenderDashboardCharts from "@/views/Dashboards/RenderDashboardCharts.vue";
import overviewDashboard from "@/utils/rum/web_vitals.json";
import { convertDashboardSchemaVersion } from "../../../utils/dashboard/convertDashboardSchemaVersion";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";

export default defineComponent({
  name: "WebVitalsDashboard",
  components: {
    RenderDashboardCharts,
    OSpinner,
    OIcon,
    OEmptyState,
  },
  props: {
    dateTime: {
      type: Object,
      default: () => ({}),
    },
  },
  emits: ["variablesManagerReady", "update:dateTime"],
  setup(props, { emit }) {
    const { t } = useI18n();
    const route = useRoute();
    const router = useRouter();
    const store = useStore();
    const { performanceState } = usePerformance();
    const { getStream } = useStreams();
    const currentDashboardData = reactive({
      data: {},
    });

    // Columns the Web Vitals dashboard (web_vitals.json) selects from _rumdata.
    // These land in the schema only once the Browser RUM SDK has ingested data;
    // a mobile-only stream has none of them, so naming them fails the whole
    // panel query. Gate on their presence rather than firing queries that
    // cannot run and surfacing raw SQL errors to the user.
    const WEB_VITAL_FIELDS = [
      "view_largest_contentful_paint",
      "view_interaction_to_next_paint",
      "view_cumulative_layout_shift",
      "view_first_contentful_paint",
      "view_first_byte",
      "view_loading_time",
    ];

    // Set once we've either read the shared schema or attempted our own fetch —
    // guards against rendering the dashboard before we know which SDK fed it.
    const schemaResolved = ref(false);

    // The _rumdata schema map (fieldName -> field) shared via usePerformance,
    // populated by the parent RUM view or our own defensive fetch below.
    const rumSchema = computed(() => performanceState.data.streams?.["_rumdata"]?.schema);

    // A non-empty schema is "known"; an empty/absent one is inconclusive.
    const rumSchemaKnown = computed(
      () => !!rumSchema.value && Object.keys(rumSchema.value).length > 0,
    );

    const hasBrowserWebVitals = computed(() =>
      WEB_VITAL_FIELDS.some((field) => !!rumSchema.value?.[field]),
    );

    // Only claim "mobile-only" when we have a real schema that lacks every
    // Web Vital field. If the schema is inconclusive (fetch failed), fall back
    // to rendering the dashboard so a browser user is never shown the empty
    // state on a transient error.
    const showBrowserOnlyEmpty = computed(
      () => schemaResolved.value && rumSchemaKnown.value && !hasBrowserWebVitals.value,
    );

    // Ensure the _rumdata schema is available. The parent RUM view normally
    // loads it into the shared state, but fetch it ourselves if it isn't there
    // yet so this tab is correct regardless of parent timing. getStream is
    // cached, so this is cheap when the schema is already resolved.
    const ensureRumSchema = async () => {
      try {
        if (rumSchemaKnown.value) return;

        const stream = await getStream("_rumdata", "logs", true);
        const schemaMap: Record<string, any> = {};
        (stream?.schema ?? []).forEach((field: any) => {
          schemaMap[field.name] = field;
        });
        performanceState.data.streams["_rumdata"] = {
          schema: schemaMap,
          name: "_rumdata",
        };
      } catch {
        // Leave the schema inconclusive — showBrowserOnlyEmpty stays false, so
        // the dashboard renders as before rather than hiding the feature.
      } finally {
        schemaResolved.value = true;
      }
    };
    const showDashboardSettingsDialog = ref(false);
    const viewOnly = ref(true);
    const eventLog = ref([]);

    const refDateTime: any = ref(null);
    const refreshInterval = ref(0);
    const selectedDate = ref();
    const webVitalsChartsRef = ref(null);
    const isLoading: Ref<boolean[]> = ref([]);

    // Variables manager event handler - pass through to parent
    const onVariablesManagerReady = (manager: any) => {
      emit("variablesManagerReady", manager);
    };

    // Handle data zoom from chart interactions
    const onDataZoom = (event: any) => {
      // Update the dateTime prop to trigger parent to update time range
      emit("update:dateTime", event);
    };

    onMounted(async () => {
      // Fire-and-forget: ensureRumSchema handles its own errors and flips
      // schemaResolved in its finally, so the gate resolves independently.
      ensureRumSchema();
      await loadDashboard();
      updateLayout();
    });

    onActivated(() => {
      updateLayout();
    });

    const updateLayout = async () => {
      await nextTick();
      await nextTick();
      await nextTick();
      await nextTick();
      // emit window resize event to trigger the layout
      window.dispatchEvent(new Event("resize"));
    };

    const loadDashboard = async () => {
      // schema migration
      currentDashboardData.data = convertDashboardSchemaVersion(overviewDashboard);

      // if variables data is null, set it to empty list

      if (
        !(currentDashboardData.data?.variables && currentDashboardData.data?.variables?.list.length)
      ) {
        variablesData.isVariablesLoading = false;
        variablesData.values = [];
      }
    };

    const addSettingsData = () => {
      showDashboardSettingsDialog.value = true;
    };

    // back button to render dashboard List page
    const goBackToDashboardList = () => {
      return router.push({
        path: "/dashboards",
        query: {
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
        },
      });
    };

    //add panel
    const addPanelData = () => {
      return router.push({
        path: "/dashboards/add_panel",
        query: {
          dashboard: route.query.dashboard,
          folder: route.query.folder ?? "default",
        },
      });
    };

    // ------- work with query params ----------
    onActivated(async () => {
      const params = route.query;

      if (params.refresh) {
        refreshInterval.value = parseDuration(params.refresh);
      }

      if (params.period || (params.to && params.from)) {
        selectedDate.value = getDurationObjectFromParams(params);
      }

      // resize charts if needed
      await nextTick();
      window.dispatchEvent(new Event("resize"));
    });

    // whenever the refreshInterval is changed, update the query params
    watch([refreshInterval, selectedDate], () => {
      router.replace({
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
          dashboard: route.query.dashboard,
          folder: route.query.folder,
          refresh: generateDurationLabel(refreshInterval.value),
          ...getQueryParamsForDuration(selectedDate.value),
        },
      });
    });

    return {
      currentDashboardData,
      goBackToDashboardList,
      addPanelData,
      t,
      getDashboard,
      store,
      refDateTime,
      filterQuery: ref(""),
      filterData(rows: string | any[], terms: string) {
        const filtered = [];
        terms = terms.toLowerCase();
        for (let i = 0; i < rows.length; i++) {
          if (rows[i]["name"].toLowerCase().includes(terms)) {
            filtered.push(rows[i]);
          }
        }
        return filtered;
      },
      refreshInterval,
      selectedDate,
      viewOnly,
      eventLog,
      onVariablesManagerReady,
      onDataZoom,
      addSettingsData,
      showDashboardSettingsDialog,
      loadDashboard,
      webVitalsChartsRef,
      isLoading,
      updateLayout,
      router,
      schemaResolved,
      showBrowserOnlyEmpty,
    };
  },
});
</script>
