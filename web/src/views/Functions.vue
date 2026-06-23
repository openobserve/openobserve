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
  <!-- Pipelines is a frequently-used workspace, so it has NO landing hub (that
       would add a click every visit). It lands straight on the default section
       and uses the same breadcrumb section-switcher for fast lateral nav:
         Stream Pipelines ▾            (› Edit Pipeline on a detail page)
       Page actions (and the detail-view teleport target) live in the bar. -->
  <div class="tw:h-full tw:min-h-0 tw:flex tw:flex-col">
    <!-- This row hosts page actions: the pipelines-list buttons or the detail
         teleport target. Section pages (functions/enrichment/eval) render
         nothing here — their content components have their own headers. -->
    <AppPageHeader
      v-if="showPipelineActions || isDetailView"
      :title="showPipelineActions ? t('menu.pipeline') : breadcrumbLabel"
      :subtitle="showPipelineActions ? t('pipeline.subtitle') : ''"
      :icon="showPipelineActions ? 'lan' : undefined"
      :back="detailBack"
      :tabs-below="showPipelineActions"
      class="tw:px-4 tw:border-b tw:border-border-default"
    >
      <!-- Section switcher tabs (Stream Pipelines / Functions / …) next to the
           title on the list page; hidden on detail sub-pages (editor/history).
           Always pass the slot so hasTabs tracks showPipelineActions reactively
           via the slot function call instead of relying on slot presence tracking. -->
      <template #tabs>
        <PipelineSectionTabs v-if="showPipelineActions" />
      </template>
      <!-- Pipeline name input rendered inline with the title on the create page -->
      <template v-if="routeName === 'createPipeline'" #title-trail>
        <div class="tw:w-64 tw:shrink-0">
          <OInput
            ref="pipelineNameInputRef"
            v-model="pipelineObj.currentSelectedPipeline.name"
            :placeholder="t('pipeline.pipelineName')"
            hide-bottom-space
            :error="pipelineObj.pipelineNameError"
            :error-message="pipelineObj.pipelineNameErrorMessage"
            data-test="pipeline-editor-name-input"
          />
        </div>
      </template>
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
        <!-- Detail sub-pages (editor/history/backfill) teleport their actions
             here, so the bar owns the single header and pages never render a 2nd. -->
        <div
          v-else-if="isDetailView"
          id="o2-page-actions"
          class="tw:flex tw:items-center tw:gap-2"
          data-test="pipeline-detail-actions"
        />
      </template>
    </AppPageHeader>

    <div class="tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:overflow-hidden">
      <RouterView v-slot="{ Component }">
        <component :is="Component" class="tw:h-full" @sendToAiChat="sendToAiChat" />
      </RouterView>
    </div>
  </div>
</template>

<script lang="ts">
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import PipelineSectionTabs from "@/components/pipeline/PipelineSectionTabs.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import { pipelineObj } from "@/plugins/pipelines/useDnD";
import {
  defineComponent,
  ref,
  computed,
  onBeforeMount,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
  watch,
} from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import config from "@/aws-exports";

export default defineComponent({
  name: "AppFunctions",
  components: {
    AppPageHeader,
    PipelineSectionTabs,
    OButton,
    ODropdown,
    ODropdownItem,
    OInput,
  },
  emits: ["sendToAiChat"],
  setup(props, { emit }) {
    const store = useStore();
    const { t } = useI18n();
    const router = useRouter();

    // Maps each route to the Level-2 section it belongs under. Pipeline
    // drill-down sub-pages all resolve to the Pipelines section.
    const routeToFunctionsTab: Record<string, string> = {
      pipelines: "streamPipelines",
      pipelineEditor: "streamPipelines",
      createPipeline: "streamPipelines",
      importPipeline: "streamPipelines",
      pipelineHistory: "streamPipelines",
      pipelineBackfill: "streamPipelines",
      functionList: "functions",
      enrichmentTables: "enrichmentTables",
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

    // ── Level 3 detail crumb ────────────────────────────────────────────────
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

    // On a detail sub-page (editor/create/history/backfill) the leading icon
    // becomes a Back button to the pipelines list, mirroring the CRUD sub-page
    // pattern used elsewhere. Undefined on the list page (icon stays).
    const detailBack = computed(() =>
      isDetailView.value
        ? {
            label: t("function.streamPipeline"),
            to: {
              name: "pipelines",
              query: { org_identifier: orgIdentifier.value },
            },
          }
        : undefined,
    );

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

    // ── Navigation handlers ─────────────────────────────────────────────────
    const orgQuery = () => ({ org_identifier: orgIdentifier.value });
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
        // Clicking "Pipeline" in the menu while already on the section lands
        // on the bare parent route — bounce back to the default section.
        if (name === "pipeline") redirectRoute();
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

    const pipelineNameInputRef = ref<any>(null);

    // Auto-focus the pipeline name input when a validation error is triggered
    watch(
      () => pipelineObj.pipelineNameError,
      (hasError) => {
        if (hasError && pipelineNameInputRef.value) {
          pipelineNameInputRef.value.focus();
        }
      },
    );

    return {
      t,
      store,
      config,
      orgIdentifier,
      activeTab,
      isDetailView,
      breadcrumbLabel,
      detailBack,
      showPipelineActions,
      shouldCollapseActions,
      goToAddPipeline,
      goToImportPipeline,
      goToPipelineHistory,
      goToBackfillJobs,
      sendToAiChat,
      routeName,
      pipelineObj,
      pipelineNameInputRef,
    };
  },
});
</script>
