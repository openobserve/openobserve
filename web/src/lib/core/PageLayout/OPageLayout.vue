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
  OPageLayout: the one page-structure component (L1–L3). Every routed view is an OPageLayout:
  the stacked OPageHeader (H1–H8), its tab row, a page banner (K3), an optional left rail and the
  body inset by the one 16 px gutter.

  Header: :title :back :context :about :titleDataTest, #title #status #actions
  #actions-overflow #header-tabs, or the rare #header escape hatch.
  #banner: one OBanner stating a lasting condition of the page, directly under the header.
  #subnav: a full-width strip under the header.
  #sidebar: FolderList / SectionRail; `sidebarWidth` (px) or `resizable`.
  Body: inset to --spacing-page-edge; `bleed` when the body owns its edge (OTable, chart,
  router-view), `constrained` for a reading column, `scroll` when the whole body scrolls.
-->
<template>
  <!-- Named container: the header's status compacts on the page's width, which the AI panel narrows without changing the viewport.
       Clipped on y so the body's entry slide never overflows MainLayout's scroll box and flashes its scrollbar. -->
  <div
    class="@container/page flex h-full flex-col overflow-y-clip"
    :data-o2-page-frame="showsOwnBody ? undefined : ''"
  >
    <div v-if="hasHeader" data-o2-page-shell :class="headerClass ?? 'shrink-0'">
      <slot name="header">
        <OPageHeader
          :title="title"
          :back="back"
          :context="context"
          :about="about"
          :title-data-test="titleDataTest"
        >
          <template v-if="!!slots.title" #title><slot name="title" /></template>
          <template v-if="!!slots.status" #status><slot name="status" /></template>
          <template v-if="!!slots.actions" #actions><slot name="actions" /></template>
          <template v-if="!!slots['actions-overflow']" #actions-overflow
            ><slot name="actions-overflow"
          /></template>
          <template v-if="!!slots['header-tabs']" #tabs><slot name="header-tabs" /></template>
        </OPageHeader>
      </slot>
    </div>

    <div v-if="!!slots.banner" class="shrink-0" data-test="o-page-layout-banner">
      <slot name="banner" />
    </div>

    <!-- ── Sub-nav strip (tab/toolbar) under the header ──────────── -->
    <div v-if="!!slots.subnav" class="border-border-default shrink-0 border-b">
      <slot name="subnav" />
    </div>

    <!-- ── Body (mobile): sidebar collapses into an off-canvas drawer ── -->
    <template v-if="!!slots.sidebar && isMobile">
      <FeatureLockExempt
        v-if="!sidebarTriggerOwner"
        class="border-border-default px-page-edge flex shrink-0 items-center border-b py-1"
        data-drawer-anchor="page-layout-sidebar"
      >
        <OButton
          variant="ghost"
          data-test="o-page-layout-mobile-sidebar-btn"
          @click="mobileSidebarOpen = true"
        >
          <template #icon><OIcon name="menu" size="sm" /></template>
          {{ t("common.sidePanel") }}
        </OButton>
      </FeatureLockExempt>
      <OContent
        :bleed="bleed"
        :y="padY"
        :class="[bodyEnter, 'flex min-h-0 w-full flex-1 flex-col overflow-hidden']"
      >
        <OPageLockedBody :replace="showsOwnBody"><slot /></OPageLockedBody>
      </OContent>
      <ODrawer
        v-model:open="mobileSidebarOpen"
        side="left"
        size="sm"
        bleed
        seamless
        anchor='[data-drawer-anchor="page-layout-sidebar"]'
        :anchor-edge="sidebarTriggerOwner ? 'bottom' : 'top'"
        data-test="o-page-layout-mobile-sidebar-drawer"
      >
        <div class="flex h-full flex-col overflow-hidden">
          <slot name="sidebar" />
        </div>
      </ODrawer>
    </template>

    <!-- ── Body: resizable sidebar + main (OSplitter) ───────────── -->
    <OSplitter
      v-else-if="!!slots.sidebar && resizable"
      v-model="internalWidth"
      unit="px"
      :limits="splitterLimits"
      :horizontal="false"
      :class="[bodyEnter, 'min-h-0 flex-1 overflow-hidden']"
    >
      <template #before>
        <div
          v-if="sidebarVisible"
          class="border-border-default flex h-full w-full flex-col overflow-hidden border-e"
        >
          <slot name="sidebar" />
        </div>
      </template>
      <template #separator>
        <slot name="separator">
          <div class="hover:bg-splitter-hover h-full w-1 bg-transparent transition-colors"></div>
        </slot>
      </template>
      <template #after>
        <OContent :bleed="bleed" :y="padY" class="flex h-full w-full flex-col overflow-hidden">
          <OPageLockedBody :replace="showsOwnBody"><slot /></OPageLockedBody>
        </OContent>
      </template>
    </OSplitter>

    <!-- ── Body: fixed-width sidebar + main ─────────────────────── -->
    <div v-else-if="!!slots.sidebar" :class="[bodyEnter, 'flex min-h-0 flex-1']">
      <aside
        class="border-border-default flex h-full shrink-0 flex-col overflow-hidden border-e"
        :style="{ width: sidebarWidth + 'px' }"
      >
        <slot name="sidebar" />
      </aside>
      <OContent as="section" :bleed="bleed" :y="padY" class="h-full min-w-0 flex-1 overflow-hidden">
        <OPageLockedBody :replace="showsOwnBody"><slot /></OPageLockedBody>
      </OContent>
    </div>

    <!-- ── Body: constrained reading column (no sidebar) ────────── -->
    <ConstrainedPage
      v-else-if="constrained"
      :size="contentSize"
      :align="contentAlign === 'start' ? 'left' : 'center'"
      :class="[bodyEnter, 'min-h-0 flex-1']"
    >
      <OPageLockedBody :replace="showsOwnBody"><slot /></OPageLockedBody>
    </ConstrainedPage>

    <!-- ── Body: main only (no sidebar) ─────────────────────────── -->
    <OContent
      v-else
      :bleed="bleed"
      :y="padY"
      :class="[
        bodyEnter,
        scroll ? 'min-h-0 flex-1 overflow-auto' : 'flex min-h-0 flex-1 flex-col overflow-hidden',
      ]"
    >
      <OPageLockedBody :replace="showsOwnBody"><slot /></OPageLockedBody>
    </OContent>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nText } from "@/types/i18n";
import { ref, computed, watch, useSlots, provide, inject, onActivated } from "vue";
import { useRouter } from "vue-router";
// The route fade skips the header band (ROUTE_ENTER), so the body brings its own fade with the slide.
import { ENTER_SLIDE as BODY_ENTER } from "@/lib/styles/motion";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import ConstrainedPage from "@/components/common/ConstrainedPage.vue";
import FeatureLockExempt from "@/components/common/FeatureLockExempt.vue";
import OPageLockedBody from "./OPageLockedBody.vue";
import OPageHeader from "@/lib/core/PageHeader/OPageHeader.vue";
import OContent from "@/lib/core/Content/OContent.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import { useFeatureLock } from "@/composables/useFeatureLock";
import { PAGE_LAYOUT_SIDEBAR_KEY } from "./pageLayoutSidebar";
import { PAGE_ENTRANCE_KEY } from "./pageEntrance";
import type { PageHeaderBack } from "@/lib/core/PageHeader/OPageHeader.types";

const RAIL_WIDTH = 230;

const props = withDefaults(
  defineProps<{
    title?: I18nText;
    back?: PageHeaderBack;
    context?: I18nText;
    about?: I18nText;
    titleDataTest?: string;
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
    contentAlign?: "center" | "start";
    // Header wrapper override (rare)
    headerClass?: string;
  }>(),
  {
    title: undefined,
    back: undefined,
    context: undefined,
    about: undefined,
    titleDataTest: undefined,
    bleed: false,
    padY: false,
    scroll: false,
    sidebarWidth: RAIL_WIDTH,
    resizable: false,
    splitterLimits: () => [0, 400] as [number, number],
    constrained: false,
    contentSize: "lg",
    contentAlign: "center",
    headerClass: undefined,
  },
);

const emit = defineEmits<{
  "update:sidebarWidth": [value: number];
}>();

const slots = useSlots();
const { t } = useI18nTyped();

const pageEntering = inject(PAGE_ENTRANCE_KEY, () => true);
const bodyEnterClass = () => (pageEntering() ? BODY_ENTER : "");
const enterClass = ref(bodyEnterClass());
// A kept-alive return re-inserts the body, which would replay the slide unless the class is dropped first.
onActivated(() => (enterClass.value = bodyEnterClass()));

const { isMobile } = useBreakpoint();
const mobileSidebarOpen = ref(false);
// Picking a destination from the phone sidebar is the end of that interaction.
const router = useRouter();
watch(
  () => router?.currentRoute?.value?.fullPath,
  () => (mobileSidebarOpen.value = false),
);
// Only a sidebar host provides, so a nested sidebar-less layout doesn't shadow its parent's trigger.
const sidebarTriggerOwner = ref<symbol | null>(null);
if (slots.sidebar) {
  provide(PAGE_LAYOUT_SIDEBAR_KEY, {
    owner: sidebarTriggerOwner,
    open: () => (mobileSidebarOpen.value = true),
  });
}

const hasHeader = computed(
  () =>
    !!props.title ||
    !!props.back ||
    !!slots.header ||
    !!slots.title ||
    !!slots.actions ||
    !!slots["header-tabs"],
);

// A layout that is only a sidebar shell has its routed child's header inside the body, so that child shows the lock.
const showsOwnBody = computed(() => hasHeader.value || !slots.sidebar);
// A locked page, and the shell around it, shows its license message without the slide so nothing moves while it appears.
const { locked: pageLocked } = useFeatureLock();
// A sidebar shell's routed child fades its own body, so the shell stays still and nothing fades twice.
const bodyEnter = computed(() => (pageLocked.value || !showsOwnBody.value ? "" : enterClass.value));

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
