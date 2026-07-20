<!-- Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>. -->

<!--
  PageLayout — 3-slot scaffold used by all Template-A and Template-B pages.

  Slots:
    #header  — optional top header section (AppPageHeader or any content)
    #sidebar — optional left panel (folder rail, route-tabs nav, etc.)
    default  — main content area (table, router-view, charts, etc.)

  Props:
    sidebarWidth    — pixel width for the sidebar (default 200)
    resizable       — when true, uses OSplitter so the sidebar is drag-resizable
    splitterLimits  — [min, max] px limits for OSplitter (default [0, 400])
    mainPanel       — when false, main content fills space without an inner border panel
                      (use for full-bleed content like the dashboard view; default true)
    constrained     — when true (and no sidebar), the main content is centered in a
                      max-width reading column (ConstrainedPage) instead of full width.
                      Use for settings sections, single forms, org params, hubs, etc.
    contentSize     — reading-column width when constrained ('sm'|'md'|'lg'|'xl'; default 'lg')
    headerClass     — override the default header wrapper class
                      (default: 'shrink-0 px-3 border-b border-border-default')

  v-model:sidebarWidth — bidirectional bind for the sidebar width when resizable=true,
                         so the page can react to resize/collapse (e.g. compact mode).
-->
<template>
  <div class="flex flex-col h-full">
    <!-- ── Optional header ──────────────────────────────────────── -->
    <div
      v-if="$slots.header"
      :class="headerClass ?? 'shrink-0 px-3 border-b border-border-default'"
    >
      <slot name="header" />
    </div>

    <!-- ── Body: resizable sidebar + main (OSplitter) ───────────── -->
    <OSplitter
      v-if="$slots.sidebar && resizable"
      v-model="internalWidth"
      unit="px"
      :limits="splitterLimits"
      :horizontal="false"
      class="flex-1 min-h-0 overflow-hidden"
    >
      <template #before>
        <div
          v-if="sidebarVisible"
          class="w-full h-full flex flex-col overflow-hidden border-r border-border-subtle"
        >
          <slot name="sidebar" />
        </div>
      </template>
      <template #separator>
        <!-- Allow page to override the separator (e.g. for custom toggle placement) -->
        <slot name="separator">
          <div class="splitter-vertical splitter-enabled"></div>
        </slot>
      </template>
      <template #after>
        <div class="w-full h-full flex flex-col overflow-hidden">
          <slot />
        </div>
      </template>
    </OSplitter>

    <!-- ── Body: fixed-width sidebar + main ─────────────────────── -->
    <div
      v-else-if="$slots.sidebar"
      class="flex-1 flex min-h-0"
    >
      <aside
        class="shrink-0 h-full flex flex-col overflow-hidden border-r border-border-subtle"
        :style="{ width: (sidebarWidth ?? 200) + 'px' }"
      >
        <slot name="sidebar" />
      </aside>
      <section
        class="flex-1 min-w-0 h-full overflow-hidden"
      >
        <slot />
      </section>
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
    <!-- Main content is flush: the app chrome (MainLayout) already provides the
         single bordered "content card", so inner panels would just nest borders.
         Sections inside separate with border-soft dividers, not boxed cards. -->
    <template v-else>
      <div class="flex-1 flex flex-col min-h-0 overflow-hidden">
        <slot />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import ConstrainedPage from "@/components/common/ConstrainedPage.vue";

const props = withDefaults(
  defineProps<{
    sidebarWidth?: number;
    resizable?: boolean;
    splitterLimits?: [number, number];
    mainPanel?: boolean;
    constrained?: boolean;
    contentSize?: "sm" | "md" | "lg" | "xl";
    headerClass?: string;
  }>(),
  {
    sidebarWidth: 200,
    resizable: false,
    splitterLimits: () => [0, 400] as [number, number],
    mainPanel: true,
    constrained: false,
    contentSize: "lg",
    headerClass: undefined,
  },
);

const emit = defineEmits<{
  "update:sidebarWidth": [value: number];
}>();

const internalWidth = ref(props.sidebarWidth);
const lastWidth = ref(props.sidebarWidth);

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

const toggleSidebar = () => {
  if (sidebarVisible.value) {
    lastWidth.value = internalWidth.value;
    internalWidth.value = 0;
  } else {
    internalWidth.value = lastWidth.value || props.sidebarWidth;
  }
};
</script>

