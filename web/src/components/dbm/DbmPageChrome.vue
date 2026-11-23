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

<!-- One constant "Databases" header for every DBM list tab: the tab strip names the view (H8).
     The strip lives here, not in DbmShell, because it belongs inside each page's own header. -->
<template>
  <OPageLayout
    :title="t('dbm.header.title')"
    :subtitle="t('dbm.header.subtitle')"
    icon="database"
    :title-data-test="titleDataTest"
    tabs-below
    bleed
  >
    <template #header-tabs>
      <!-- The sibling badges come from the shell's one shared fan-out; the
           page's own count is substituted into what it passes here. -->
      <DbmSectionTabs v-bind="tabCounts" />
    </template>

    <slot />
  </OPageLayout>
</template>

<script setup lang="ts">
import DbmSectionTabs from "@/components/dbm/DbmSectionTabs.vue";
import type { DbmTabCountProps } from "@/composables/dbm/useDbmTabCounts";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import { useI18nTyped } from "@/types/i18n";

defineProps<{
  /** Per-tab data-test on the shared title, for the e2e selectors that key off it. */
  titleDataTest: string;
  /** What the tab strip paints — the shell's fan-out with this page's own count substituted. */
  tabCounts: DbmTabCountProps;
}>();

const { t } = useI18nTyped();
</script>
