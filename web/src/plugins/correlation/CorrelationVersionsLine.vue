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
  <div
    v-if="versions.length > 1"
    class="px-page-edge text-text-secondary flex flex-wrap items-center gap-2 pt-3 text-xs"
    data-test="svcver-correlation-versions-line"
  >
    <span>{{
      t(
        "serviceVersions.correlation.versionsLine",
        { count: versions.length, service },
        versions.length,
      )
    }}</span>
    <template v-for="entry in versions" :key="entry.version">
      <i18n-t
        v-if="entry.pods !== null"
        keypath="serviceVersions.correlation.versionOnPods"
        tag="span"
        scope="global"
        :plural="entry.pods"
        class="flex items-center gap-1"
        :data-test="`svcver-correlation-versions-line-${entry.version}`"
        ><template #version><ServiceScopeChip facet="version" :value="entry.version" /></template
        ><template #count>{{ entry.pods }}</template></i18n-t
      >
      <span
        v-else
        class="flex items-center"
        :data-test="`svcver-correlation-versions-line-${entry.version}`"
        ><ServiceScopeChip facet="version" :value="entry.version"
      /></span>
    </template>
    <span
      v-if="filterOptions && filterOptions.length > 1"
      class="ms-auto flex items-center gap-2"
      data-test="svcver-correlation-version-filter"
    >
      <span class="font-semibold">{{ t("serviceVersions.correlation.versionFilter") }}</span>
      <OSelect
        v-model="version"
        :options="filterOptions"
        labelKey="label"
        valueKey="value"
        class="dimension-dropdown min-w-30"
      />
    </span>
  </div>
</template>
<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import ServiceScopeChip from "@/components/shared/ServiceScopeChip.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { VersionPods } from "./correlationVersions";

defineProps<{
  versions: VersionPods[];
  service: string;
  /** Shown only where the host has no filters row to carry the version select. */
  filterOptions?: { label: I18nText; value: string }[];
}>();
const version = defineModel<string>("version");
const { t } = useI18nTyped();
</script>
