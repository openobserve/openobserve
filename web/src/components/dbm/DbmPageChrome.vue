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
  DbmPageChrome — the header every DBM list tab wears.

  All seven list pages opened with the same twenty lines: an OPageLayout with the
  database icon, tabs on a second row, a bleeding body and the shared tab strip
  in `#header-tabs`. Title and subtitle are one constant "Databases" header for
  the whole section — the tab strip already names the view. Only the title's
  data-test differs per page, for the e2e selectors that key off it.

  Two things deliberately stay in the page. The tab strip's markup lives HERE
  rather than in `DbmShell` for the reason `dbmTabCounts.ts` documents — it
  belongs inside each page's own header — and the query-detail page is NOT one
  of these: it has a back target, no tab strip, a different icon and a scrolling
  body, which is four opt-outs for one caller and no dedup at all.
-->
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
