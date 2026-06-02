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

<!--
  PipelineSectionTabs — the L2 section switcher (Stream Pipelines / Functions /
  Enrichment Tables / Eval Templates) rendered as tabs next to a page title.
  Drop it into an AppPageHeader's #tabs slot on any pipeline section page; the
  active tab is derived from the current route and clicking a tab navigates.
  This mirrors the breadcrumb section dropdown as faster inline navigation.
-->
<template>
  <OToggleGroup
    :model-value="activeSectionKey"
    @update:model-value="navigateToSection"
    data-test="pipeline-section-tabs"
  >
    <OToggleGroupItem
      v-for="s in visibleSections"
      :key="s.key"
      :value="s.key"
      size="sm"
      :data-test="`pipeline-section-tab-${s.key}`"
    >
      <template #icon-left><OIcon :name="s.icon" size="sm" /></template>
      {{ s.label }}
    </OToggleGroupItem>
  </OToggleGroup>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, type RouteLocationRaw } from "vue-router";
import config from "@/aws-exports";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const { t } = useI18n();
const store = useStore();
const router = useRouter();

const orgIdentifier = computed(
  () => store.state.selectedOrganization?.identifier,
);

// Route name → section key. Detail/sub routes resolve to their parent section
// so the right tab stays highlighted on editor/history/add pages.
const routeToSection: Record<string, string> = {
  pipelines: "streamPipelines",
  pipelineEditor: "streamPipelines",
  createPipeline: "streamPipelines",
  importPipeline: "streamPipelines",
  pipelineHistory: "streamPipelines",
  pipelineBackfill: "streamPipelines",
  functionList: "functions",
  enrichmentTables: "enrichmentTables",
  evalTemplates: "evalTemplates",
  evalTemplatesAdd: "evalTemplates",
};

const activeSectionKey = computed(() => {
  const name = router.currentRoute?.value?.name as string | undefined;
  return (name ? routeToSection[name] : "") ?? "";
});

interface Section {
  key: string;
  label: string;
  icon: string;
  to: RouteLocationRaw;
  visible: boolean;
}

const sections = computed<Section[]>(() => {
  const q = { org_identifier: orgIdentifier.value };
  const hideStreamPipelines = store.state.zoConfig?.custom_hide_menus
    ?.split(",")
    .includes("pipelines");
  return [
    {
      key: "streamPipelines",
      label: t("function.streamPipeline"),
      icon: "lan",
      to: { name: "pipelines", query: q },
      visible: !hideStreamPipelines,
    },
    {
      key: "functions",
      label: t("function.header"),
      icon: "function",
      to: { name: "functionList", query: q },
      visible: true,
    },
    {
      key: "enrichmentTables",
      label: t("function.enrichmentTables"),
      icon: "dataset",
      to: { name: "enrichmentTables", query: q },
      visible: true,
    },
    {
      key: "evalTemplates",
      label: t("pipeline.evalTemplates"),
      icon: "fact-check",
      to: { name: "evalTemplates", query: q },
      visible: config.isEnterprise == "true",
    },
  ];
});

const visibleSections = computed(() =>
  sections.value.filter((s) => s.visible),
);

const navigateToSection = (key: string | number | (string | number)[]) => {
  const next = String(key);
  if (next === activeSectionKey.value) return;
  const section = sections.value.find((s) => s.key === next);
  if (section) router.push(section.to);
};
</script>
