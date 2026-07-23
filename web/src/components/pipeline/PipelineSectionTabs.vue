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
  Enrichment Tables) rendered as tabs next to a page title.
  Drop it into an OPageHeader's #tabs slot on any pipeline section page; the
  active tab is derived from the current route and clicking a tab navigates.
  This mirrors the breadcrumb section dropdown as faster inline navigation.
-->
<template>
  <!-- Section tabs — standard non-dense OTabs. The active underline sits on the
       header's bottom divider automatically (OTabs draws its indicator flush at
       the bottom). The active tab is derived from the route; clicking navigates. -->
  <OTabs
    :model-value="activeSectionKey"
    align="left"
    data-test="pipeline-section-tabs"
    @change="navigateToSection"
  >
    <OTab
      v-for="s in visibleSections"
      :key="s.key"
      :name="s.key"
      :data-test="`pipeline-section-tab-${s.key}`"
    >
      <OIcon :name="s.icon" size="sm" class="shrink-0" />
      <span>{{ s.label }}</span>
      <span
        v-if="s.count != null"
        class="text-2xs rounded-full px-1.5 py-1 leading-none font-bold"
        :class="
          s.key === activeSectionKey
            ? 'bg-primary-100 text-primary-700'
            : 'bg-surface-subtle text-text-secondary'
        "
        >{{ s.count }}</span
      >
    </OTab>
  </OTabs>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import { useRouter, type RouteLocationRaw } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";

const { t } = useI18n();
const store = useStore();
const router = useRouter();

const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier);

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
  /** Optional count pill shown after the label (omitted = no badge). */
  count?: number;
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
  ];
});

const visibleSections = computed(() => sections.value.filter((s) => s.visible));

const navigateToSection = (key: string | number) => {
  if (key === activeSectionKey.value) return;
  const section = sections.value.find((s) => s.key === key);
  if (section) router.push(section.to);
};
</script>
