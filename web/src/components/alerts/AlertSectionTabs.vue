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
  AlertSectionTabs — the section switcher across the alerting siblings
  (Firing / All Alerts / Destinations / Templates / Library), rendered in an
  OPageLayout's #header-tabs slot on each of them.

  The routes stay FLAT top-level siblings (see shared/router.ts) — this is
  presentation, not nesting. Modelled on PipelineSectionTabs, which already
  ships this pattern for Stream Pipelines / Functions.
-->
<template>
  <!-- The tabs only navigate, so a license-locked alert page still reaches the free destinations and templates. -->
  <FeatureLockExempt class="contents">
    <OTabs
      :model-value="activeSectionKey"
      align="left"
      reorderable
      data-test="alert-section-tabs"
      @change="navigateToSection"
      @reorder="onReorder"
    >
      <OTab
        v-for="section in orderedSections"
        :key="section.key"
        :name="section.key"
        :data-test="`alert-section-tab-${section.key}`"
      >
        <OIcon :name="section.icon" size="sm" class="shrink-0" />
        <span :class="section.key === activeSectionKey ? '' : 'max-md:hidden'">{{
          section.label
        }}</span>
        <OTag
          v-if="section.key === 'alertFiring' && firingCount !== null"
          :variant="firingCount > 0 ? 'error-soft' : 'default-soft'"
          size="sm"
          data-test="alert-section-tab-alertFiring-badge"
          :label="raw(String(firingCount))"
        />
        <OIcon
          v-if="section.licenseLocked"
          name="lock"
          size="xs"
          class="lock-chip shrink-0"
          :data-test="`alert-section-tab-${section.key}-lock`"
          aria-hidden="true"
        />
      </OTab>
    </OTabs>
  </FeatureLockExempt>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useStore } from "vuex";
import { useRouter, type RouteLocationRaw } from "vue-router";
import { useQuery } from "@tanstack/vue-query";

import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import FeatureLockExempt from "@/components/common/FeatureLockExempt.vue";
import { firingAlertsQuery } from "@/services/alerts.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { countStates } from "@/utils/alerts/firingAlerts";
import { featureState } from "@/utils/featureGate";

const TAB_ORDER_KEY = "o2_alert_section_tab_order";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier);

const loadTabOrder = (): string[] => {
  try {
    const saved = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
};

const tabOrder = ref<string[]>(loadTabOrder());

interface Section {
  /** Also the sibling route name — the two are deliberately the same string. */
  key: string;
  label: I18nText;
  icon: IconName;
  to: RouteLocationRaw;
  licenseLocked?: boolean;
}

const sections = computed<Section[]>(() => {
  const query = { org_identifier: orgIdentifier.value };
  // Raw split (no trim) to match how the rest of the app reads the flag.
  const hideLibrary = (store.state.zoConfig?.custom_hide_menus ?? "")
    .split(",")
    .includes("alertLibrary");
  const alerts = featureState(store.state.zoConfig?.features, "alerts");
  const alertsHidden = alerts === "hidden";
  const licenseLocked = alerts === "locked";
  return [
    // "All Alerts", not "Alerts": the page title above this strip already says
    // "Alerts", so a tab repeating it names nothing. The rail's Alerts
    // subsection uses the same string for the same reason.
    ...(alertsHidden
      ? []
      : [
          {
            key: "alertFiring",
            label: t("alerts.firing.title"),
            icon: "notifications-active" as IconName,
            to: { name: "alertFiring", query },
            licenseLocked,
          },
          {
            key: "alertList",
            label: t("alerts.allAlerts"),
            icon: "shield-alert-outline" as IconName,
            to: { name: "alertList", query },
            licenseLocked,
          },
        ]),
    {
      key: "alertDestinations",
      label: t("alert_destinations.header"),
      icon: "location-on",
      to: { name: "alertDestinations", query },
      licenseLocked,
    },
    {
      key: "alertTemplates",
      label: t("alert_templates.header"),
      icon: "description",
      to: { name: "alertTemplates", query },
      licenseLocked,
    },
    // Last: the catalog is where you go once to fetch an alert, not where you work.
    ...(hideLibrary || alertsHidden
      ? []
      : [
          {
            key: "alertLibrary",
            label: t("alert_library.header"),
            icon: "menu-book" as IconName,
            to: { name: "alertLibrary", query },
            licenseLocked,
          },
        ]),
  ];
});

// A saved key with no section is dropped, and a section the save never knew is appended.
const orderedSections = computed<Section[]>(() => {
  const saved = tabOrder.value
    .map((key) => sections.value.find((section) => section.key === key))
    .filter((section): section is Section => !!section);
  return [...saved, ...sections.value.filter((section) => !saved.includes(section))];
});

const onReorder = (move: { from: string | number; to: string | number; before: boolean }) => {
  const [from, to] = [String(move.from), String(move.to)];
  const order = orderedSections.value.map((section) => section.key);
  if (!order.includes(from) || !order.includes(to) || from === to) return;
  order.splice(order.indexOf(from), 1);
  order.splice(order.indexOf(to) + (move.before ? 0 : 1), 0, from);
  // A section hidden today keeps its saved slot, so unhiding it does not lose the user's order.
  const unplaced = [...order];
  const merged = tabOrder.value.map((key) => (order.includes(key) ? unplaced.shift()! : key));
  merged.push(...unplaced);
  tabOrder.value = merged;
  try {
    localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(merged));
  } catch {
    // Storage unavailable: the order holds for this session only.
  }
};

const firingList = useQuery(() =>
  Object.assign(firingAlertsQuery(orgIdentifier.value), {
    enabled:
      !!orgIdentifier.value && featureState(store.state.zoConfig?.features, "alerts") === "enabled",
  }),
);
// Blank run state would read as a confident zero, so the badge hides instead.
const firingCount = computed(() => {
  const page = firingList.data.value;
  return page && !page.status_unavailable ? countStates(page.list).firing : null;
});

// Empty on any other route, so a page that renders this strip outside the
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
