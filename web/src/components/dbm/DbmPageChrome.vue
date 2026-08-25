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
  database icon, tabs on a second row, a bleeding body, the shared tab strip in
  `#header-tabs`, and the same six-prop DateTime in `#actions`. Only the title,
  the subtitle and two data-tests differed, so those are the props.

  Two things deliberately stay in the page. The tab strip's markup lives HERE
  rather than in `DbmShell` for the reason `dbmTabCounts.ts` documents — it
  belongs inside each page's own header — and the query-detail page is NOT one
  of these: it has a back target, no tab strip, a different icon and a scrolling
  body, which is four opt-outs for one caller and no dedup at all.
-->
<template>
  <OPageLayout
    :title="title"
    :subtitle="subtitle"
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

    <template #actions>
      <DateTime
        auto-apply
        menu-align="end"
        :default-type="range.type"
        :default-absolute-time="{ startTime: range.startTime, endTime: range.endTime }"
        :default-relative-time="range.relativeTimePeriod ?? undefined"
        :data-test-name="dateTimeDataTest"
        class="h-8"
        @on:date-change="emit('dateChange', $event)"
      />
      <slot name="actions-extra" />
    </template>

    <slot />
  </OPageLayout>
</template>

<script setup lang="ts">
import DateTime from "@/components/DateTime.vue";
import DbmSectionTabs from "@/components/dbm/DbmSectionTabs.vue";
import type { DbmDateChange, DbmRange } from "@/composables/dbm/useDbmScope";
import type { DbmTabCountProps } from "@/composables/dbm/useDbmTabCounts";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import type { I18nText } from "@/types/i18n";

defineProps<{
  title: I18nText;
  subtitle: I18nText;
  titleDataTest: string;
  dateTimeDataTest: string;
  /** What the tab strip paints — the shell's fan-out with this page's own count substituted. */
  tabCounts: DbmTabCountProps;
  /** The window the picker opens on. */
  range: DbmRange;
}>();

const emit = defineEmits<{ dateChange: [value: DbmDateChange] }>();
</script>
