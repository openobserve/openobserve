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
  <PageLayout>
    <!-- ── Header: Level 2 module tabs OR Level 3 detail breadcrumb ── -->
    <template #header>
      <AppPageHeader :icon="headerIcon">
        <!-- Title — section name (L2) or current item (L3 detail) -->
        <template #title>
          <span v-if="isDetailView" data-test="pipeline-detail-title">{{
            breadcrumbLabel
          }}</span>
          <template v-else>{{ headerTitle }}</template>
        </template>

        <!-- Level 3 — breadcrumb back to the Pipelines list -->
        <template #subtitle>
          <AppBreadcrumb
            v-if="isDetailView"
            :items="[
              {
                label: t('pipeline.header'),
                onClick: goToPipelines,
                dataTest: 'pipeline-breadcrumb-root',
              },
            ]"
          />
        </template>

        <!-- Level 2 — module tabs (inline, next to the title) -->
        <template #tabs>
          <OTabs
            v-if="!isDetailView"
            v-model="activeTab"
            data-test="pipeline-module-tabs"
          >
            <ORouteTab
              v-if="
                !store.state.zoConfig?.custom_hide_menus
                  ?.split(',')
                  .includes('pipelines')
              "
              data-test="stream-pipelines-tab"
              name="streamPipelines"
              :label="t('function.streamPipeline')"
              :to="{
                name: 'pipelines',
                query: { org_identifier: orgIdentifier },
              }"
            />
            <ORouteTab
              data-test="function-stream-tab"
              name="functions"
              :label="t('function.header')"
              :to="{
                name: 'functionList',
                query: { org_identifier: orgIdentifier },
              }"
            />
            <ORouteTab
              data-test="function-enrichment-table-tab"
              name="enrichmentTables"
              :label="t('function.enrichmentTables')"
              :to="{
                name: 'enrichmentTables',
                query: { org_identifier: orgIdentifier },
              }"
            />
            <ORouteTab
              v-if="config.isEnterprise == 'true'"
              data-test="eval-templates-tab"
              name="evalTemplates"
              :label="t('pipeline.evalTemplates')"
              :to="{
                name: 'evalTemplates',
                query: { org_identifier: orgIdentifier },
              }"
            />
          </OTabs>
        </template>

        <!-- Pipelines-tab actions -->
        <template #actions>
          <template v-if="showPipelineActions">
            <template v-if="!shouldCollapseActions">
              <OButton
                data-test="pipeline-list-history-btn"
                variant="outline"
                size="sm"
                icon-left="history"
                @click="goToPipelineHistory"
              >
                {{ t("pipeline.history") }}
              </OButton>
              <OButton
                v-if="config.isEnterprise == 'true'"
                data-test="pipeline-list-backfill-btn"
                variant="outline"
                size="sm"
                icon-left="refresh"
                @click="goToBackfillJobs"
              >
                {{ t("pipeline.backfill") }}
              </OButton>
              <OButton
                data-test="pipeline-list-import-pipeline-btn"
                variant="outline"
                size="sm"
                icon-left="upload-file"
                @click="goToImportPipeline"
              >
                {{ t("pipeline.import") }}
              </OButton>
            </template>
            <OButton
              data-test="pipeline-list-add-pipeline-btn"
              variant="primary"
              size="sm"
              @click="goToAddPipeline"
            >
              {{ t("pipeline.addPipeline") }}
            </OButton>
            <ODropdown v-if="shouldCollapseActions" align="end">
              <template #trigger>
                <OButton
                  variant="outline"
                  size="sm"
                  data-test="pipeline-list-overflow-menu-btn"
                  icon-left="menu"
                />
              </template>
              <ODropdownItem
                data-test="pipeline-list-menu-history-btn"
                @select="goToPipelineHistory"
              >
                {{ t("pipeline.history") }}
              </ODropdownItem>
              <ODropdownItem
                v-if="config.isEnterprise == 'true'"
                data-test="pipeline-list-menu-backfill-btn"
                @select="goToBackfillJobs"
              >
                {{ t("pipeline.backfill") }}
              </ODropdownItem>
              <ODropdownItem
                data-test="pipeline-list-menu-import-btn"
                @select="goToImportPipeline"
              >
                {{ t("pipeline.import") }}
              </ODropdownItem>
            </ODropdown>
          </template>
        </template>
      </AppPageHeader>
    </template>

    <!-- ── Router view (main content) ───────────────────────────── -->
    <RouterView v-slot="{ Component }">
      <component :is="Component" @sendToAiChat="sendToAiChat" />
    </RouterView>
  </PageLayout>
</template>

<script lang="ts">
import PageLayout from "@/components/common/PageLayout.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import AppBreadcrumb from "@/components/common/AppBreadcrumb.vue";
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import {
  defineComponent,
  ref,
  computed,
  onBeforeMount,
  onMounted,
  onUnmounted,
  watch,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";

export default defineComponent({
  name: "AppFunctions",
  components: {
    PageLayout,
    AppPageHeader,
    AppBreadcrumb,
    OTabs,
    ORouteTab,
    OButton,
    ODropdown,
    ODropdownItem,
  },
  emits: ["sendToAiChat"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();

    // Maps each route to the Level-2 module tab it belongs under. Pipeline
    // drill-down sub-pages all resolve to the Pipelines tab.
    const routeToFunctionsTab: Record<string, string> = {
      pipelines: "streamPipelines",
      pipelineEditor: "streamPipelines",
      createPipeline: "streamPipelines",
      importPipeline: "streamPipelines",
      pipelineHistory: "streamPipelines",
      pipelineBackfill: "streamPipelines",
      functionList: "functions",
      enrichmentTables: "enrichmentTables",
      evalTemplates: "evalTemplates",
    };

    const routeName = computed(() => router.currentRoute.value.name as string);

    const activeTab: any = ref(
      routeToFunctionsTab[routeName.value] ?? "streamPipelines",
    );
    watch(routeName, (name) => {
      if (routeToFunctionsTab[name]) activeTab.value = routeToFunctionsTab[name];
    });

    const orgIdentifier = computed(
      () => store.state.selectedOrganization.identifier,
    );

    // ── Level 3 detail bar ──────────────────────────────────────
    // Breadcrumb label for each pipeline drill-down route. Absence from this
    // map means we're on a Level-2 index page (show module tabs instead).
    const detailLabels: Record<string, () => string> = {
      pipelineEditor: () =>
        (router.currentRoute.value.query.name as string) || "Edit Pipeline",
      createPipeline: () => t("pipeline.addPipeline"),
      importPipeline: () => t("pipeline.import"),
      pipelineHistory: () => t("pipeline.history"),
      pipelineBackfill: () => t("pipeline.backfill"),
    };
    const isDetailView = computed(() => routeName.value in detailLabels);
    const breadcrumbLabel = computed(
      () => detailLabels[routeName.value]?.() ?? "",
    );

    // ── Header identity (icon + title) ─────────────────────────
    // The module is "Pipelines" (the Level-1 sidebar item) — its icon + title
    // stay constant; the Level-2 tabs indicate the active sub-section.
    const headerTitle = computed(() => t("pipeline.header"));
    const headerIcon = "lan";

    // Header actions live on the Pipelines index page only.
    const showPipelineActions = computed(() => routeName.value === "pipelines");

    // Responsive: collapse secondary actions into an overflow menu when narrow.
    const windowWidth = ref(window.innerWidth);
    const onWindowResize = () => {
      windowWidth.value = window.innerWidth;
    };
    const shouldCollapseActions = computed(() => windowWidth.value <= 1440);

    onMounted(() => {
      window.addEventListener("resize", onWindowResize);
    });
    onUnmounted(() => {
      window.removeEventListener("resize", onWindowResize);
    });

    // ── Navigation handlers ─────────────────────────────────────
    const orgQuery = () => ({ org_identifier: orgIdentifier.value });
    const goToPipelines = () =>
      router.push({ name: "pipelines", query: orgQuery() });
    const goToAddPipeline = () =>
      router.push({ name: "createPipeline", query: orgQuery() });
    const goToImportPipeline = () =>
      router.push({ name: "importPipeline", query: orgQuery() });
    const goToPipelineHistory = () =>
      router.push({ name: "pipelineHistory", query: orgQuery() });
    const goToBackfillJobs = () =>
      router.push({ name: "pipelineBackfill", query: orgQuery() });

    watch(
      () => router.currentRoute.value.name,
      (name) => {
        // Clicking "Pipelines" in the menu while already on the section lands
        // on the bare parent route — bounce back to the last child.
        if (name === "pipeline") router.back();
      },
    );

    onBeforeMount(() => {
      redirectRoute();
    });

    const redirectRoute = () => {
      if (router.currentRoute.value.name === "pipeline") {
        router.replace({ name: "pipelines", query: orgQuery() });
      }
    };

    const sendToAiChat = (value: any, append: boolean = false) => {
      emit("sendToAiChat", value, append);
    };

    return {
      t,
      store,
      config,
      orgIdentifier,
      activeTab,
      headerIcon,
      headerTitle,
      isDetailView,
      breadcrumbLabel,
      showPipelineActions,
      shouldCollapseActions,
      goToPipelines,
      goToAddPipeline,
      goToImportPipeline,
      goToPipelineHistory,
      goToBackfillJobs,
      sendToAiChat,
    };
  },
});
</script>
