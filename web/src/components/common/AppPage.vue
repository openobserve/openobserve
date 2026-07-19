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
  AppPage — the whole-page structure in ONE component. You plug in data (title,
  icon, actions, tabs, body); the component owns the skeleton and ALL the
  spacing, so a screen physically can't hand-roll a padded `<div>` and drift out
  of alignment.

  It composes:
    • the full-height flex column,
    • `AppPageHeader` (which self-insets to the page-edge grid),
    • an optional self-aligning sub-nav strip (put an `<OTabs>` in `#subnav` —
      it lands on the same grid line, no wrapper padding needed),
    • a body that is ALREADY wrapped in `OContent` (the one `--spacing-page-edge`
      inset), so the body content lines up with the header and tabs.

  A listing page whose body is a full-bleed `OTable` passes `bleed` (the table
  owns its own edge inset). A detail/form/tab page leaves `bleed` off and its
  content is inset automatically.

    <!-- listing -->
    <AppPage :title="t('channels.title')" icon="notifications" :subtitle="…" bleed>
      <template #actions><OButton …/></template>
      <OTable … />
    </AppPage>

    <!-- detail with tabs -->
    <AppPage :title="incident.name" :back="{ label, onClick }">
      <template #subnav><OTabs v-model="tab">…</OTabs></template>
      <MyTabContent />        <!-- auto-inset to the grid, aligned with the tabs -->
    </AppPage>

  For pages with a left rail/sidebar, use PageLayout (it owns the split) and wrap
  its main content in <OContent> / <AppPage> as needed.

  Props mirror AppPageHeader (title, subtitle, icon, back, breadcrumb,
  titleDataTest) plus body controls (bleed, bleedY, scroll).
  Slots: title · actions · header-tabs (inline module tabs in the header) ·
         subnav (full-width tab/toolbar strip under the header) · default (body).
-->
<template>
  <div class="flex flex-col h-full min-h-0">
    <AppPageHeader
      :title="title"
      :subtitle="subtitle"
      :icon="icon"
      :back="back"
      :breadcrumb="breadcrumb"
      :title-data-test="titleDataTest"
      class="shrink-0 border-b border-border-default"
    >
      <template v-if="!!slots.title" #title><slot name="title" /></template>
      <template v-if="!!slots.actions" #actions><slot name="actions" /></template>
      <template v-if="!!slots['header-tabs']" #tabs><slot name="header-tabs" /></template>
    </AppPageHeader>

    <!-- Sub-nav strip (tab strip / secondary toolbar). No horizontal padding:
         an OTabs strip self-insets to the page-edge grid, and the border is
         full-bleed — matching the header's divider. -->
    <div v-if="!!slots.subnav" class="shrink-0 border-b border-border-default">
      <slot name="subnav" />
    </div>

    <!-- Body: already inset to the page-edge grid via OContent, so content lines
         up with the header title and the sub-nav tabs. `bleed` opts a full-bleed
         table/chart out (it owns its own edge). -->
    <OContent
      :bleed="bleed"
      :bleed-y="!padY"
      :class="scroll ? 'flex-1 min-h-0 overflow-auto' : 'flex-1 min-h-0 flex flex-col overflow-hidden'"
    >
      <slot />
    </OContent>
  </div>
</template>

<script setup lang="ts">
import { useSlots } from "vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { BreadcrumbItem } from "@/components/common/AppBreadcrumb.vue";

interface BackTarget {
  label: string;
  to?: import("vue-router").RouteLocationRaw;
  onClick?: () => void;
  dataTest?: string;
}

withDefaults(
  defineProps<{
    title?: string;
    subtitle?: string;
    icon?: IconName;
    back?: BackTarget;
    breadcrumb?: BreadcrumbItem[];
    titleDataTest?: string;
    /** Full-bleed body (a table/chart/canvas that owns its own edge inset). */
    bleed?: boolean;
    /** Also apply the standard vertical inset to the body. */
    padY?: boolean;
    /** Body scrolls internally (default). Off → body is a fixed flex column. */
    scroll?: boolean;
  }>(),
  { bleed: false, padY: false, scroll: true },
);

const slots = useSlots();
</script>
