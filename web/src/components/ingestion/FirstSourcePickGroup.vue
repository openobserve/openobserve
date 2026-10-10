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

<script setup lang="ts">
import type { RouteLocationRaw } from "vue-router";
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

export interface FirstSourcePickTab {
  name: string;
  to: RouteLocationRaw;
  label: I18nText;
  icon?: string;
  title?: I18nText;
}

defineProps<{
  /** Names the rail in the ids `ingestion-<rail>-pick-group`, `-pick-tab-<name>` and `-rest-group`. */
  rail: string;
  tab: FirstSourcePickTab;
  /** Heading over the rest of the rail. */
  restLabel: I18nText;
}>();

const { t } = useI18nTyped();
</script>

<template>
  <div
    class="text-text-secondary px-2 pt-2 pb-1 text-xs font-semibold"
    :data-test="`ingestion-${rail}-pick-group`"
  >
    {{ t("ingestion.firstSource.yourPick") }}
  </div>
  <ORouteTab
    :name="tab.name"
    :title="tab.title || tab.name"
    :to="tab.to"
    :icon="tab.icon"
    :label="tab.label"
    :data-test="`ingestion-${rail}-pick-tab-${tab.name}`"
  />
  <div
    class="text-text-secondary px-2 pt-3 pb-1 text-xs font-semibold"
    :data-test="`ingestion-${rail}-rest-group`"
  >
    {{ restLabel }}
  </div>
</template>
