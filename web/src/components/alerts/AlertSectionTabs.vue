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
  AlertSectionTabs — the section switcher across the four alerting siblings
  (All Alerts / Destinations / Templates / Library), rendered in an
  OPageLayout's #header-tabs slot on each of them. Same order as the rail's
  Reliability flyout.

  The routes stay FLAT top-level siblings (see shared/router.ts) — this is
  presentation, not nesting. Modelled on PipelineSectionTabs, which already
  ships this pattern for Stream Pipelines / Functions.
-->
<template>
  <OTabs
    :model-value="activeSectionKey"
    align="left"
    data-test="alert-section-tabs"
    @change="navigateToSection"
  >
    <OTab
      v-for="section in sections"
      :key="section.key"
      :name="section.key"
      :data-test="`alert-section-tab-${section.key}`"
    >
      <OIcon :name="section.icon" size="sm" class="shrink-0" />
      <span>{{ section.label }}</span>
    </OTab>
  </OTabs>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { useRouter, type RouteLocationRaw } from "vue-router";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier);

interface Section {
  /** Also the sibling route name — the two are deliberately the same string. */
  key: string;
  label: I18nText;
  icon: IconName;
  to: RouteLocationRaw;
}

const sections = computed<Section[]>(() => {
  const query = { org_identifier: orgIdentifier.value };
  return [
    // "All Alerts", not "Alerts": the page title above this strip already says
    // "Alerts", so a tab repeating it names nothing. The rail's Alerts
    // subsection uses the same string for the same reason.
    {
      key: "alertList",
      label: t("alerts.allAlerts"),
      icon: "shield-alert-outline",
      to: { name: "alertList", query },
    },
    {
      key: "alertDestinations",
      label: t("alert_destinations.sectionTab"),
      icon: "location-on",
      to: { name: "alertDestinations", query },
    },
    {
      key: "alertTemplates",
      label: t("alert_templates.header"),
      icon: "description",
      to: { name: "alertTemplates", query },
    },
    // Last: the catalog is where you go once to fetch an alert, not where you
    // work. The rail's Reliability flyout lists these four in this same order.
    {
      key: "alertLibrary",
      label: t("alert_library.sectionTab"),
      icon: "menu-book",
      to: { name: "alertLibrary", query },
    },
  ];
});

// Empty on any other route, so a page that renders this strip outside the four
// siblings highlights nothing rather than lying about where you are.
const activeSectionKey = computed(() => {
  const name = router.currentRoute?.value?.name as string | undefined;
  return sections.value.some((section) => section.key === name) ? (name as string) : "";
});

const navigateToSection = (key: string | number) => {
  if (key === activeSectionKey.value) return;
  const section = sections.value.find((candidate) => candidate.key === key);
  if (section) void router.push(section.to);
};
</script>
