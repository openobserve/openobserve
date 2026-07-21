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
    class="tw:rounded-md home-page"
    :class="store.state.isAiChatEnabled ? 'ai-enabled-home-view' : ''"
    data-test="home-page"
  >
    <!-- No card-container here: the page already renders inside MainLayout's
         bordered content card, so an inner panel border would double-frame the
         home page. Keep only the layout classes.

         The page is NOT padded at the root: the header must be full-bleed so its
         bottom divider reaches the card edges (like Data Sources / Pipelines) —
         a padded root insets the header and makes it read as a floating bar.
         Padding is reintroduced on the body wrapper below the header instead. -->
    <div
      class="tw:h-full tw:overflow-hidden tw:flex tw:flex-col tw:min-h-0"
    >
      <!-- Top-level page header: module icon + "Home" title, with the home tabs
           rendered as a full-width strip below (tabsBelow). The header owns its
           own bottom divider when tabs are present; when only a single tab
           exists we hand-draw the border so the header still reads as a header.
           The tab bar keeps its drag-to-reorder behavior (OTabs `reorderable`);
           OTabs draws the active underline flush with the header's divider. -->
      <AppPageHeader
        :title="t('menu.home')"
        :subtitle="t('home.subtitle')"
        icon="home"
        :tabs-below="tabOrder.length > 1"
        class="tw:shrink-0 tw:px-4"
        :class="
          tabOrder.length > 1 ? '' : 'tw:border-b tw:border-border-default'
        "
      >
        <template v-if="tabOrder.length > 1" #tabs>
          <OTabs
            v-model="activeHomeTab"
            align="left"
            reorderable
            data-test="home-tab-bar"
            @reorder="onTabReorder"
          >
            <OTab
              v-for="tab in tabOrder"
              :key="tab.id"
              :name="tab.id"
              :label="tab.label"
              :data-test="`home-tab-${tab.id}`"
            />
          </OTabs>
        </template>
      </AppPageHeader>

      <!-- Body: padded wrapper that holds the active tab panel. Padding lives
           here (not on the root) so the header above stays full-bleed. -->
      <div class="tw:flex-1 tw:min-h-0 tw:flex tw:flex-col tw:pt-px tw:px-2.5 tw:pb-2.5">
        <!-- O2 AI Assistant tab -->
        <div v-if="activeHomeTab === 'ai'" class="home-tab-panel home-ai-panel">
          <HomeChatHistory @load-chat="onLoadChat" @new-chat="onNewChat" />
          <O2AIChat
            ref="homeChat"
            :is-open="true"
            :header-height="0"
            :centered-start="true"
          />
        </div>

        <!-- Overview tab (no inner card-container — the outer section panel
             already provides the border; avoids a double-bordered card). -->
        <div
          v-if="activeHomeTab === 'overview'"
          class="home-tab-panel"
        >
          <OverviewTab />
        </div>

        <!-- Usage tab -->
        <div v-if="activeHomeTab === 'usage'" class="home-tab-panel home-tab-panel--usage">
          <UsageTab />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  ref,
  watch,
  onMounted,
  onUnmounted,
} from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "../aws-exports";
import OverviewTab from "@/views/OverviewTab.vue";
import UsageTab from "@/views/UsageTab.vue";
import O2AIChat from "@/components/O2AIChat.vue";
import HomeChatHistory from "@/views/HomeChatHistory.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import AppPageHeader from "@/components/common/AppPageHeader.vue";

export default defineComponent({
  name: "PageHome",

  setup() {
    const store = useStore();
    const { t } = useI18n();
    const LS_TAB_ORDER_KEY = "o2_home_tab_order";
    const LS_ACTIVE_TAB_KEY = "o2_home_active_tab";

    const isEnterpriseOrCloud =
      config.isEnterprise === "true" || config.isCloud === "true";

    const DEFAULT_TABS = computed(() => {
      const tabs: { id: string; label: string }[] = [];
      if (isEnterpriseOrCloud && store.state.zoConfig.ai_enabled) {
        tabs.push({ id: "ai", label: t("home.tabAiAssistant") });
      }
      if (isEnterpriseOrCloud) {
        tabs.push({ id: "overview", label: t("home.tabOverview") });
      }
      tabs.push({ id: "usage", label: t("home.tabUsage") });
      return tabs;
    });

    function loadTabOrder() {
      try {
        const saved = localStorage.getItem(LS_TAB_ORDER_KEY);
        if (saved) {
          const ids: string[] = JSON.parse(saved);
          const ordered = ids
            .map((id) => DEFAULT_TABS.value.find((t) => t.id === id))
            .filter(Boolean) as { id: string; label: string }[];
          // append any new tabs not yet in saved order
          DEFAULT_TABS.value.forEach((t) => {
            if (!ordered.find((o) => o.id === t.id)) ordered.push(t);
          });
          return ordered;
        }
      } catch {}
      return [...DEFAULT_TABS.value];
    }

    const tabOrder = ref(loadTabOrder());

    // DEFAULT_TABS depends on zoConfig.ai_enabled, which arrives asynchronously
    // from the backend /config response. Re-sync tabOrder whenever the set of
    // available tabs changes so the AI tab appears once the backend confirms
    // it's enabled.
    watch(
      () => DEFAULT_TABS.value.map((t) => t.id).join(","),
      () => {
        const current = tabOrder.value;
        const merged: { id: string; label: string }[] = [];
        // Preserve existing user-defined order, drop tabs no longer available
        current.forEach((t) => {
          const match = DEFAULT_TABS.value.find((d) => d.id === t.id);
          if (match) merged.push(match);
        });
        // Append any newly available tabs
        DEFAULT_TABS.value.forEach((d) => {
          if (!merged.find((m) => m.id === d.id)) merged.push(d);
        });
        tabOrder.value = merged;
      },
    );

    const savedActiveTab = localStorage.getItem(LS_ACTIVE_TAB_KEY);
    const activeHomeTab = ref(
      savedActiveTab && DEFAULT_TABS.value.find((t) => t.id === savedActiveTab)
        ? savedActiveTab
        : tabOrder.value[0].id,  
    );

    watch(activeHomeTab, (val) => localStorage.setItem(LS_ACTIVE_TAB_KEY, val));

    // Drag-to-reorder — OTabs reports the move (dragged id → target id + which
    // side of the target) and we apply it to our own ordered list, then persist.
    function onTabReorder({
      from,
      to,
      before = true,
    }: {
      from: string | number;
      to: string | number;
      before?: boolean;
    }) {
      if (from === to) return;
      const order = [...tabOrder.value];
      const fromIdx = order.findIndex((t) => t.id === from);
      if (fromIdx === -1) return;

      const [moved] = order.splice(fromIdx, 1);
      // Recompute the target index after removal, then insert on the chosen side.
      let toIdx = order.findIndex((t) => t.id === to);
      if (toIdx === -1) return;
      if (!before) toIdx += 1;
      order.splice(toIdx, 0, moved);

      tabOrder.value = order;
      localStorage.setItem(
        LS_TAB_ORDER_KEY,
        JSON.stringify(order.map((t) => t.id)),
      );
    }

    const homeChat = ref<any>(null);
    function onLoadChat(id: number) {
      homeChat.value?.loadChat(id);
    }
    function onNewChat() {
      homeChat.value?.addNewChat();
    }

    function onSwitchTab(e: Event) {
      const tab = (e as CustomEvent).detail;
      if (DEFAULT_TABS.value.find((t) => t.id === tab)) {
        activeHomeTab.value = tab;
      }
    }
    onMounted(() => window.addEventListener("o2:home-switch-tab", onSwitchTab));
    onUnmounted(() =>
      window.removeEventListener("o2:home-switch-tab", onSwitchTab),
    );

    return {
      t,
      store,
      config,
      activeHomeTab,
      tabOrder,
      onTabReorder,
      isEnterpriseOrCloud,
      homeChat,
      onLoadChat,
      onNewChat,
    };
  },
  components: {
    OverviewTab,
    UsageTab,
    O2AIChat,
    HomeChatHistory,
    OTabs,
    OTab,
    AppPageHeader,
  },
});
</script>

<style scoped lang="scss">
/*
 * HomeView Styles — Tab bar and page layout only.
 * Usage-tab-specific styles live in UsageTab.vue.
 */

/* Home tab bar now uses the shared OTabs component (see template). */

.home-tab-panel {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* Usage tab: cancel the body wrapper's right padding so the scroll container
   reaches the content-card's right edge and its scrollbar sits flush there
   (instead of floating ~10px inset). The wrapper is overflow:visible, so this
   negative margin isn't clipped. The inner gap is restored by UsageTab's
   `.usage-scroll` padding-right. */
.home-tab-panel--usage {
  margin-right: -0.625rem;
}

/* AI assistant tab — side-by-side layout */
.home-ai-panel {
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

/* Chat fills remaining width and height */
.home-ai-panel :deep(.chat-container) {
  flex: 1;
  height: 100%;
  box-shadow: none;
  border-radius: 0;
  min-width: 0;
  overflow: visible;
}

/* Allow the input's gradient glow + shadow to spill outside the container.
   messages-container has its own overflow-y, so the page itself won't grow. */
.home-ai-panel :deep(.chat-content-wrapper),
.home-ai-panel :deep(.chat-content) {
  overflow: visible;
}

/* The home tab sets chat-content to overflow:visible (above) so the input's
   glow can spill — but that removes the clip that normally bounds the message
   list. Without min-height:0, the flex:1 chat-content + messages-container grow
   to their content height and push the input bar off the bottom. min-height:0
   lets them shrink within their flex columns so the message list scrolls and
   the input stays pinned at the bottom. */
.home-ai-panel :deep(.chat-content),
.home-ai-panel :deep(.messages-container) {
  min-height: 0;
}

/* Hide the entire chat header + its separator — sidebar owns this UI */
.home-ai-panel :deep(.chat-header),
.home-ai-panel :deep(.chat-content-wrapper > [role="separator"]) {
  display: none;
}

/* Gradient border on the prompt input — home tab only.
   Uses the dual-background trick: bg color for padding-box, gradient for border-box.
   2px border for stronger presence + layered shadows for depth. */
.home-ai-panel :deep(.unified-input-box) {
  position: relative;
  border: 2px solid transparent !important;
  background:
    linear-gradient(
        var(--o2-ai-input-bg, #ffffff),
        var(--o2-ai-input-bg, #ffffff)
      )
      padding-box,
    linear-gradient(90deg, #f59e0b, #ec4899, #7b61ff) border-box !important;
  box-shadow:
    0 2px 4px rgba(15, 23, 42, 0.06),
    0 8px 20px -2px rgba(15, 23, 42, 0.12),
    0 18px 44px -10px rgba(123, 97, 255, 0.3) !important;
}

.home-ai-panel :deep(.unified-input-box.light-mode) {
  --o2-ai-input-bg: #ffffff;
}

.home-ai-panel :deep(.unified-input-box.dark-mode) {
  --o2-ai-input-bg: #191919;
  box-shadow:
    0 2px 4px rgba(0, 0, 0, 0.45),
    0 8px 22px -2px rgba(0, 0, 0, 0.55),
    0 20px 48px -10px rgba(123, 97, 255, 0.45) !important;
}

/* Soft ambient glow behind the input */
.home-ai-panel :deep(.unified-input-box)::before {
  content: "";
  position: absolute;
  inset: -10px;
  border-radius: inherit;
  background: linear-gradient(90deg, #f59e0b, #ec4899, #7b61ff);
  opacity: 0.22;
  filter: blur(22px);
  z-index: -1;
  pointer-events: none;
}

/* Stronger glow + shadow on focus, no harsh ring */
.home-ai-panel :deep(.unified-input-box:focus-within) {
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 6px 16px -2px rgba(15, 23, 42, 0.1),
    0 16px 40px -8px rgba(123, 97, 255, 0.32) !important;
}

.home-ai-panel :deep(.unified-input-box.dark-mode:focus-within) {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.4),
    0 6px 20px -2px rgba(0, 0, 0, 0.55),
    0 18px 44px -8px rgba(123, 97, 255, 0.42) !important;
}

.home-ai-panel :deep(.unified-input-box:focus-within)::before {
  opacity: 0.4;
}

.home-page {
  overflow: hidden;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.ai-enabled-home-view {
  height: 100%;
}
</style>
