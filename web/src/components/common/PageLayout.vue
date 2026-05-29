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
    headerClass     — override the default header wrapper class
                      (default: 'tw:shrink-0 tw:px-3 tw:border-b tw:border-border-default')

  v-model:sidebarWidth — bidirectional bind for the sidebar width when resizable=true,
                         so the page can react to resize/collapse (e.g. compact mode).
-->
<template>
  <div class="tw:flex tw:flex-col tw:h-full">
    <!-- ── Optional header ──────────────────────────────────────── -->
    <div
      v-if="$slots.header"
      :class="headerClass ?? 'tw:shrink-0 tw:px-3 tw:border-b tw:border-border-default'"
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
      class="tw:flex-1 tw:min-h-0 tw:overflow-hidden"
    >
      <template #before>
        <div
          v-if="sidebarVisible"
          class="tw:w-full tw:h-full tw:pt-1 tw:pl-2 tw:pb-2"
        >
          <div
            class="tw:h-full tw:flex tw:flex-col tw:overflow-hidden tw:border tw:border-border-default tw:rounded-lg"
          >
            <slot name="sidebar" />
          </div>
        </div>
      </template>
      <template #separator>
        <!-- Allow page to override the separator (e.g. for custom data-test attrs) -->
        <slot name="separator">
          <OButton
            variant="sidebar-button"
            size="sidebar-button"
            :class="sidebarVisible ? 'page-layout-separator-btn splitter-icon-collapse' : 'page-layout-separator-btn splitter-icon-expand'"
            :title="sidebarVisible ? 'Collapse sidebar' : 'Expand sidebar'"
            @click="toggleSidebar"
          >
            <OIcon
              :name="sidebarVisible ? 'chevron-left' : 'chevron-right'"
              size="xs"
            />
          </OButton>
        </slot>
      </template>
      <template #after>
        <div class="tw:w-full tw:h-full tw:pt-1 tw:pl-1 tw:pb-2 tw:pr-2">
          <div
            class="tw:h-full tw:flex tw:flex-col tw:border tw:border-border-default tw:rounded-lg tw:overflow-hidden"
          >
            <slot />
          </div>
        </div>
      </template>
    </OSplitter>

    <!-- ── Body: fixed-width sidebar + main ─────────────────────── -->
    <div
      v-else-if="$slots.sidebar"
      class="tw:flex-1 tw:flex tw:min-h-0 tw:px-2 tw:pb-2 tw:pt-1 tw:gap-2"
    >
      <aside
        class="tw:shrink-0 tw:h-full tw:flex tw:flex-col tw:overflow-hidden tw:border tw:border-border-default tw:rounded-lg"
        :style="{ width: (sidebarWidth ?? 200) + 'px' }"
      >
        <slot name="sidebar" />
      </aside>
      <section
        class="tw:flex-1 tw:min-w-0 tw:h-full tw:border tw:border-border-default tw:rounded-lg tw:overflow-hidden"
      >
        <slot />
      </section>
    </div>

    <!-- ── Body: main only (no sidebar) ─────────────────────────── -->
    <template v-else>
      <!-- With bordered panel (default) -->
      <div
        v-if="mainPanel"
        class="tw:flex-1 tw:flex tw:flex-col tw:min-h-0 tw:px-2 tw:pb-2 tw:pt-1"
      >
        <div
          class="tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:border tw:border-border-default tw:rounded-lg tw:overflow-hidden"
        >
          <slot />
        </div>
      </div>
      <!-- Without bordered panel (full-bleed content) -->
      <div v-else class="tw:flex-1 tw:flex tw:flex-col tw:min-h-0">
        <slot />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";

const props = withDefaults(
  defineProps<{
    sidebarWidth?: number;
    resizable?: boolean;
    splitterLimits?: [number, number];
    mainPanel?: boolean;
    headerClass?: string;
  }>(),
  {
    sidebarWidth: 200,
    resizable: false,
    splitterLimits: () => [0, 400] as [number, number],
    mainPanel: true,
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

<style>
/* Separator button positioning — mirrors the pattern used in individual page SFCs.
   These are non-scoped so they apply to OButton's root element. */
.page-layout-separator-btn {
  position: absolute !important;
  top: 0.25rem !important;
  left: 0 !important;
}
</style>
