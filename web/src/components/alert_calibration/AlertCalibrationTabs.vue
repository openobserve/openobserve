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
  <OTabs :model-value="active" align="left" data-test="alert-calibration-tabs" @change="go">
    <OTab
      v-for="tab in tabs"
      :key="tab.name"
      :name="tab.name"
      :data-test="`alert-calibration-tab-${tab.name}`"
    >
      <OIcon :name="tab.icon" size="sm" class="shrink-0" />
      <span :class="tab.name === active ? '' : 'max-md:hidden'">{{ tab.label }}</span>
    </OTab>
  </OTabs>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import { useOrgId } from "@/composables/query";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();

/** Each tab's name is also its route name. */
const tabs = computed<{ name: string; label: I18nText; icon: IconName }[]>(() => [
  { name: "alertCalibration", label: t("alertCalibration.tabs.digests"), icon: "history" },
  {
    name: "alertCalibrationDashboard",
    label: t("alertCalibration.tabs.dashboard"),
    icon: "insights",
  },
]);

const active = computed(() =>
  route.name === "alertCalibrationDashboard" ? "alertCalibrationDashboard" : "alertCalibration",
);

const go = (name: unknown) => {
  if (typeof name === "string" && name !== route.name) {
    void router.push({ name, query: { org_identifier: orgId.value } });
  }
};
</script>
