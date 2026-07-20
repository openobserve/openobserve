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
  OPageLayout — THE single page-structure component. Every routed view is an
  OPageLayout: it owns the full-height column, the header, an optional left rail,
  an optional sub-nav strip, and the body's inset. You plug in data (title,
  actions, tabs, sidebar, body); there is no place to hand-roll a padded <div>,
  so no screen can drift off the grid.

  Header — from props (the normal case):
    :title :subtitle :icon :back :titleDataTest
    #actions      — right-aligned header actions (O2 buttons)
    #header-tabs  — inline module tabs in the header row (Level-2 nav)
    #title        — custom title node (when a string title isn't enough)
    #header       — ESCAPE HATCH: a fully custom header the props can't express.
                    Prefer the props; reach for this only when you must.

  Sub-nav — a full-width tab/toolbar strip under the header:
    #subnav       — put an <OTabs> or a filter bar here. It self-aligns to the
                    page-edge grid and gets a full-bleed bottom divider.

  Left rail — optional:
    #sidebar      — FolderList / SectionRail. `sidebarWidth` (px) for a fixed
                    rail, or `resizable` for a drag-resizable OSplitter.

  Body — the default slot. Inset to the ONE `--spacing-page-edge` grid line by
  default (so it lines up with the header, tabs and rails). Escape hatches:
    bleed         — full-bleed body: a table/chart/canvas/router-view that owns
                    its own edge inset (an OTable self-insets its first column).
    constrained   — center the body in a max-width reading column (forms/settings);
                    `contentSize` = 'sm'|'md'|'lg'|'xl'.
    padY          — also apply the standard vertical inset.
    scroll        — the WHOLE body scrolls (overflow-auto). Default OFF: the body
                    is a fixed `flex flex-col` column so inner content (a table,
                    a dashboard) scrolls internally at full height. Turn on only
                    for a page whose entire body should scroll (a long form).

  v-model:sidebarWidth — bidirectional bind for the rail width (resizable mode).
-->
<template>
  <div class="flex flex-col h-full">
    <!-- ── Header (props → OPageHeader, or #header escape hatch) ── -->
    <!-- Just a shrink-0 slot: OPageHeader draws its OWN border-b (so the header
         is a consistent 60px). Don't add a border here — it would double the
         divider and add 1px. -->
    <div
      v-if="hasHeader"
      :class="headerClass ?? 'shrink-0'"
    >
      <slot name="header">
        <OPageHeader
          :title="title"
          :subtitle="subtitle"
          :icon="icon"
          :back="back"
          :title-data-test="titleDataTest"
          :tabs-below="tabsBelow"
        >
          <template v-if="!!slots.title" #title><slot name="title" /></template>
          <template v-if="!!slots['title-prefix']" #title-prefix><slot name="title-prefix" /></template>
          <template v-if="!!slots['title-trail']" #title-trail><slot name="title-trail" /></template>
          <template v-if="!!slots.subtitle" #subtitle><slot name="subtitle" /></template>
          <template v-if="!!slots.actions" #actions><slot name="actions" /></template>
          <template v-if="!!slots['header-tabs']" #tabs><slot name="header-tabs" /></template>
        </OPageHeader>
      </slot>
    </div>

    <!-- ── Sub-nav strip (tab/toolbar) under the header ──────────── -->
    <div v-if="!!slots.subnav" class="shrink-0 border-b border-border-default">
      <slot name="subnav" />
    </div>

    <!-- ── Body: resizable sidebar + main (OSplitter) ───────────── -->
    <OSplitter
      v-if="!!slots.sidebar && resizable"
      v-model="internalWidth"
      unit="px"
      :limits="splitterLimits"
      :horizontal="false"
      class="flex-1 min-h-0 overflow-hidden"
    >
      <template #before>
        <div
          v-if="sidebarVisible"
          class="w-full h-full flex flex-col overflow-hidden border-r border-border-default"
        >
          <slot name="sidebar" />
        </div>
      </template>
      <template #separator>
        <slot name="separator">
          <div
            class="w-1 h-full bg-transparent transition-colors duration-300 hover:bg-[var(--color-orange-500)]"
          ></div>
        </slot>
      </template>
      <template #after>
        <OContent
          :bleed="bleed"
          :y="padY"
          class="w-full h-full flex flex-col overflow-hidden"
        >
          <slot />
        </OContent>
      </template>
    </OSplitter>

    <!-- ── Body: fixed-width sidebar + main ─────────────────────── -->
    <div
      v-else-if="!!slots.sidebar"
      class="flex-1 flex min-h-0"
    >
      <aside
        class="shrink-0 h-full flex flex-col overflow-hidden border-r border-border-default"
        :style="{ width: (sidebarWidth ?? 200) + 'px' }"
      >
        <slot name="sidebar" />
      </aside>
      <OContent
        as="section"
        :bleed="bleed"
        :y="padY"
        class="flex-1 min-w-0 h-full overflow-hidden"
      >
        <slot />
      </OContent>
    </div>

    <!-- ── Body: constrained reading column (no sidebar) ────────── -->
    <ConstrainedPage
      v-else-if="constrained"
      :size="contentSize"
      class="flex-1 min-h-0"
    >
      <slot />
    </ConstrainedPage>

    <!-- ── Body: main only (no sidebar) ─────────────────────────── -->
    <OContent
      v-else
      :bleed="bleed"
      :y="padY"
      :class="scroll ? 'flex-1 min-h-0 overflow-auto' : 'flex-1 min-h-0 flex flex-col overflow-hidden'"
    >
      <slot />
    </OContent>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, useSlots } from "vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import ConstrainedPage from "@/components/common/ConstrainedPage.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

interface BackTarget {
  label: string;
  to?: import("vue-router").RouteLocationRaw;
  onClick?: () => void;
  dataTest?: string;
}

const props = withDefaults(
  defineProps<{
    // Header (from props)
    title?: string;
    subtitle?: string;
    icon?: IconName;
    back?: BackTarget;
    titleDataTest?: string;
    /** Render #header-tabs on a second row below the title (Level-2 module nav). */
    tabsBelow?: boolean;
    // Body
    bleed?: boolean;
    padY?: boolean;
    /** Whole-body scroll (overflow-auto). Default off → fixed flex column so
     *  inner content (table/dashboard) scrolls internally at full height. */
    scroll?: boolean;
    // Sidebar
    sidebarWidth?: number;
    resizable?: boolean;
    splitterLimits?: [number, number];
    // Reading-column mode
    constrained?: boolean;
    contentSize?: "sm" | "md" | "lg" | "xl";
    // Header wrapper override (rare)
    headerClass?: string;
  }>(),
  {
    tabsBelow: false,
    bleed: false,
    padY: false,
    scroll: false,
    sidebarWidth: 200,
    resizable: false,
    splitterLimits: () => [0, 400] as [number, number],
    constrained: false,
    contentSize: "lg",
    headerClass: undefined,
  },
);

const emit = defineEmits<{
  "update:sidebarWidth": [value: number];
}>();

const slots = useSlots();

const hasHeader = computed(
  () =>
    !!props.title ||
    !!props.subtitle ||
    !!props.icon ||
    !!props.back ||
    !!slots.header ||
    !!slots.title ||
    !!slots.subtitle ||
    !!slots.actions ||
    !!slots["header-tabs"],
);

const internalWidth = ref(props.sidebarWidth);

const sidebarVisible = computed(() => internalWidth.value > 0);

// Sync from parent when using v-model:sidebarWidth
watch(
  () => props.sidebarWidth,
  (val) => {
    if (val !== undefined && val !== internalWidth.value) {
      internalWidth.value = val;
    }
  },
);

// Emit to parent on every width change (enables v-model:sidebarWidth)
watch(internalWidth, (val) => {
  emit("update:sidebarWidth", val);
});
</script>
