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
  <q-page class="tw:px-[0.625rem] q-pt-xs home-page" :class="store.state.isAiChatEnabled ? 'ai-enabled-home-view q-pb-sm' : ''">

    test this feature

    <div class="card-container tw:mb-[0.625rem] tw:h-full tw:overflow-auto" style="max-height: calc(100vh - var(--navbar-height) - 18px)">
      <!-- Tab bar (drag to reorder) — shown when multiple tabs exist -->
      <div
        v-if="tabOrder.length > 1"
        class="home-tab-bar"
        @dragover.prevent
        @drop="onTabDrop($event)"
      >
        <OButton
          v-for="tab in tabOrder"
          :key="tab.id"
          variant="ghost"
        class="home-tab-btn"
          :class="{
          'home-tab-active': activeHomeTab === tab.id,
          'home-tab-dragging': draggingTab === tab.id,
        }"
          draggable="true"
          @click="activeHomeTab = tab.id"
          @dragstart="onTabDragStart($event, tab.id)"
          @dragend="onTabDragEnd"
          @dragenter.prevent="onTabDragEnter(tab.id)"
        >
          <q-icon
          name="drag_indicator"
          class="home-tab-drag-handle"
          size="0.875em"
        />
          {{ tab.label }}
        </OButton>
      </div>

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

      <!-- Overview tab -->
      <div v-if="activeHomeTab === 'overview'" class="card-container home-tab-panel">
        <OverviewTab />
      </div>

      <!-- Usage tab -->
      <div v-if="activeHomeTab === 'usage'" class="home-tab-panel">
        <UsageTab />
      </div>
    </div>
  </q-page>
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
import OButton from "@/lib/core/Button/OButton.vue";

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
            .map(id => DEFAULT_TABS.value.find(t => t.id === id))
            .filter(Boolean) as { id: string; label: string }[];
          // append any new tabs not yet in saved order
          DEFAULT_TABS.value.forEach(t => { if (!ordered.find(o => o.id === t.id)) ordered.push(t); });
          return ordered;
        }
      } catch {}
      return [...DEFAULT_TABS.value];
    }

    const tabOrder = ref(loadTabOrder());

    const savedActiveTab = localStorage.getItem(LS_ACTIVE_TAB_KEY);
    const activeHomeTab = ref(savedActiveTab && DEFAULT_TABS.value.find(t => t.id === savedActiveTab) ? savedActiveTab : tabOrder.value[0].id);

    watch(activeHomeTab, (val) => localStorage.setItem(LS_ACTIVE_TAB_KEY, val));

    // Drag state
    const draggingTab = ref<string | null>(null);
    const dragOverTab = ref<string | null>(null);

    function onTabDragStart(e: DragEvent, id: string) {
      draggingTab.value = id;
      e.dataTransfer!.effectAllowed = "move";
      e.dataTransfer!.setData("text/plain", id);
    }

    function onTabDragEnter(id: string) {
      dragOverTab.value = id;
    }

    function onTabDragEnd() {
      draggingTab.value = null;
      dragOverTab.value = null;
    }

    function onTabDrop(e: DragEvent) {
      e.preventDefault();
      const fromId = e.dataTransfer?.getData("text/plain") ?? draggingTab.value;
      const toId = dragOverTab.value;
      if (!fromId || !toId || fromId === toId) return;

      const order = [...tabOrder.value];
      const fromIdx = order.findIndex((t) => t.id === fromId);
      const toIdx = order.findIndex((t) => t.id === toId);
      if (fromIdx === -1 || toIdx === -1) return;

      const [moved] = order.splice(fromIdx, 1);
      order.splice(toIdx, 0, moved);
      tabOrder.value = order;
      localStorage.setItem(
        LS_TAB_ORDER_KEY,
        JSON.stringify(order.map((t) => t.id)),
      );

      draggingTab.value = null;
      dragOverTab.value = null;
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
      if (DEFAULT_TABS.value.find(t => t.id === tab)) {
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
      draggingTab,
      dragOverTab,
      onTabDragStart,
      onTabDragEnter,
      onTabDragEnd,
      onTabDrop,
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
    OButton,
  },
});
</script>

<style scoped lang="scss">
/*
 * HomeView Styles — Tab bar and page layout only.
 * Usage-tab-specific styles live in UsageTab.vue.
 */

/* ── Home tab bar ── */
.home-tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--color-tabs-bar-border);
  margin: 0 0.625rem 0 0.625rem;
  padding-top: 0.25rem;
}

.home-tab-btn {
  background: none;
  border: none;
  border-top-left-radius: 0.375rem;
  border-top-right-radius: 0.375rem;
  border-bottom: 2px solid transparent;
  border-radius: 0.375rem 0.375rem 0 0 !important;
  padding: 0 0.75rem;
  height: 40px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-tabs-inactive-text);
  cursor: pointer;
  white-space: nowrap;
  transition:
    color 0.15s,
    border-color 0.15s,
    background-color 0.15s,
    opacity 0.15s;
  margin-bottom: -1px;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  user-select: none;

  &:hover {
    color: var(--color-tabs-hover-text);
    background: var(--color-tabs-hover-bg);

    .home-tab-drag-handle {
      opacity: 0.6;
    }
  }
}

.home-tab-drag-handle {
  opacity: 0;
  transition: opacity 0.15s;
  cursor: grab;
  flex-shrink: 0;

  &:active {
    cursor: grabbing;
  }
}

.home-tab-dragging {
  opacity: 0.4;
}

.home-tab-active {
  color: var(--color-tabs-active-text) !important;
  border-bottom-color: var(--color-tabs-indicator) !important;
  background: var(--color-tabs-active-bg) !important;
}

.home-tab-panel {
  height: calc(100% - 41px);
  overflow: hidden;
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
}

/* Hide the entire chat header + its separator — sidebar owns this UI */
.home-ai-panel :deep(.chat-header),
.home-ai-panel :deep(.chat-content-wrapper > .q-separator) {
  display: none;
}

.home-page {
  overflow: hidden;
  min-height: unset;
  height: calc(100vh - 2.5em);
}

.ai-enabled-home-view {
  height: calc(100vh - 120px);
}
</style>
