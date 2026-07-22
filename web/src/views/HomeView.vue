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
  <div class="rounded-default overflow-hidden min-h-0 h-full flex flex-col" data-test="home-page">
    <!-- No card-container here: the page already renders inside MainLayout's
         bordered content card, so an inner panel border would double-frame the
         home page. Keep only the layout classes.

         The page is NOT padded at the root: the header must be full-bleed so its
         bottom divider reaches the card edges (like Data Sources / Pipelines) —
         a padded root insets the header and makes it read as a floating bar.
         Padding is reintroduced on the body wrapper below the header instead. -->
    <OPageLayout
      :title="t('menu.home')"
      :subtitle="t('home.subtitle')"
      icon="home"
      :tabs-below="tabOrder.length > 1"
      bleed
    >
      <!-- Top-level page header: module icon + "Home" title, with the home tabs
           rendered as a full-width strip below (tabsBelow). The header owns its
           own bottom divider when tabs are present; when only a single tab
           exists we hand-draw the border so the header still reads as a header.
           The tab bar keeps its drag-to-reorder behavior (OTabs `reorderable`);
           OTabs draws the active underline flush with the header's divider. -->
      <template v-if="tabOrder.length > 1" #header-tabs>
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
            :data-test="`home-tab-${tab.id}`"
          >
            <span class="o-tab__label truncate">{{ tab.label }}</span>
            <button
              v-if="tab.id.startsWith('dash:')"
              type="button"
              class="ml-1 inline-flex items-center justify-center w-4 h-4 leading-none border-none bg-transparent rounded-default cursor-pointer opacity-60 text-sm text-text-secondary transition-all duration-200 ease-[ease] hover:opacity-100 hover:bg-surface-subtle-hover hover:text-text-body"
              :data-test="`home-tab-close-${tab.id}`"
              :aria-label="t('home.removeHomeDashboard')"
              @mousedown.stop.prevent
              @pointerdown.stop.prevent
              @click.stop.prevent="onCloseTab(tab.id)"
            >
              &times;
            </button>
            <OTooltip
              v-if="tab.id.startsWith('dash:')"
              side="bottom"
              :content="t('home.removeHomeDashboard')"
            />
          </OTab>
        </OTabs>
      </template>

      <!-- Body: padded wrapper that holds the active tab panel. Padding lives
           here (not on the root) so the header above stays full-bleed. The
           pinned dashboard tab opts out: its actions row draws a full-bleed
           divider (like the header's) and the dashboard grid pads itself. -->
      <div
        class="flex-1 min-h-0 flex flex-col"
        :class="activeHomeTab.startsWith('dash:') ? '' : 'pt-px px-2.5 pb-2.5'"
      >
        <!-- O2 AI Assistant tab -->
        <div
          v-if="activeHomeTab === 'ai'"
          class="home-ai-panel flex-1 min-h-0 flex flex-row overflow-hidden"
        >
          <HomeChatHistory @load-chat="onLoadChat" @new-chat="onNewChat" />
          <O2AIChat ref="homeChat" :is-open="true" :header-height="0" :centered-start="true" />
        </div>

        <!-- Overview tab (no inner card-container — the outer section panel
             already provides the border; avoids a double-bordered card). -->
        <div v-if="activeHomeTab === 'overview'" class="flex-1 min-h-0 overflow-hidden">
          <OverviewTab />
        </div>

        <!-- Usage tab -->
        <div v-if="activeHomeTab === 'usage'" class="flex-1 min-h-0 overflow-hidden -mx-2.5">
          <UsageTab />
        </div>

        <!-- Pinned dashboard tab -->
        <div v-else-if="activeHomeTab.startsWith('dash:')" class="flex-1 min-h-0 overflow-hidden">
          <PinnedDashboardTab
            :key="activeHomeTab"
            :dashboard-id="parsePinnedTabId(activeHomeTab).dashboardId"
            :folder-id="parsePinnedTabId(activeHomeTab).folderId"
            @update-label="(l) => onPinnedLabel(parsePinnedTabId(activeHomeTab).dashboardId, l)"
            @unavailable="onPinnedUnavailable"
          />
        </div>
      </div>
    </OPageLayout>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useStore } from "vuex";
import config from "../aws-exports";
import OverviewTab from "@/views/OverviewTab.vue";
import UsageTab from "@/views/UsageTab.vue";
import O2AIChat from "@/components/O2AIChat.vue";
import HomeChatHistory from "@/views/HomeChatHistory.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import PinnedDashboardTab from "@/views/PinnedDashboardTab.vue";
import { useHomeDashboard } from "@/composables/useHomeDashboard";
import { toast } from "@/lib/feedback/Toast/useToast";

export default defineComponent({
  name: "PageHome",

  setup() {
    const store = useStore();
    const { t } = useI18n();
    const LS_TAB_ORDER_KEY = "o2_home_tab_order";
    const LS_ACTIVE_TAB_KEY = "o2_home_active_tab";

    const isEnterpriseOrCloud = config.isEnterprise === "true" || config.isCloud === "true";

    const { homeDashboard, clearHomeDashboard, updateLabel } = useHomeDashboard();

    const DEFAULT_TABS = computed(() => {
      const tabs: { id: string; label: string; closable?: boolean }[] = [];
      if (isEnterpriseOrCloud && store.state.zoConfig.ai_enabled) {
        tabs.push({ id: "ai", label: t("home.tabAiAssistant") });
      }
      if (isEnterpriseOrCloud) {
        tabs.push({ id: "overview", label: t("home.tabOverview") });
      }
      tabs.push({ id: "usage", label: t("home.tabUsage") });
      // Append the org home dashboard as a single tab (if set).
      if (homeDashboard.value) {
        tabs.push({
          id: `dash:${homeDashboard.value.folderId}:${homeDashboard.value.dashboardId}`,
          label: homeDashboard.value.label,
          closable: true,
        });
      }
      return tabs;
    });

    // "dash:default:abc" -> { folderId: "default", dashboardId: "abc" }
    function parsePinnedTabId(id: string) {
      const rest = id.slice("dash:".length);
      const sep = rest.indexOf(":");
      return { folderId: rest.slice(0, sep), dashboardId: rest.slice(sep + 1) };
    }

    function onPinnedLabel(dashboardId: string, label: string) {
      updateLabel(store.state.selectedOrganization?.identifier, dashboardId, label);
    }

    // Remove the pin and recover the active tab. Shared by the "dashboard is
    // gone" path (onPinnedUnavailable) and the deliberate close (onCloseTab).
    function removeHomePin() {
      const org = store.state.selectedOrganization?.identifier;
      clearHomeDashboard(org);
      // Active tab no longer exists in the recomputed set → fall back to first.
      if (!DEFAULT_TABS.value.find((tb) => tb.id === activeHomeTab.value)) {
        activeHomeTab.value = tabOrder.value[0]?.id ?? "usage";
      }
    }

    // The pinned dashboard could not be loaded (deleted / inaccessible). Clear
    // the pin and tell the user why — distinct from a deliberate close.
    function onPinnedUnavailable() {
      removeHomePin();
      toast({
        variant: "error",
        message: t("dashboard.homePinUnavailable"),
      });
    }

    function onCloseTab(id: string) {
      if (!id.startsWith("dash:")) return;
      // Deliberate unpin — no error toast.
      removeHomePin();
    }

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
      } catch {
        /* ignore: fall back to default tab order */
      }
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

    // When the user opens the pinned dashboard tab, re-read the authoritative
    // home_dashboard org setting so a snapshot that went stale on another system
    // (e.g. the dashboard was moved to a different folder elsewhere) self-corrects
    // before we render / navigate with its folderId.
    watch(activeHomeTab, (val) => {
      if (val.startsWith("dash:")) {
        const org = store.state.selectedOrganization?.identifier;
        if (org) useHomeDashboard().load(org);
      }
    });

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
      localStorage.setItem(LS_TAB_ORDER_KEY, JSON.stringify(order.map((t) => t.id)));
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
    onUnmounted(() => window.removeEventListener("o2:home-switch-tab", onSwitchTab));

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
      parsePinnedTabId,
      onPinnedLabel,
      onPinnedUnavailable,
      onCloseTab,
    };
  },
  components: {
    OverviewTab,
    UsageTab,
    O2AIChat,
    HomeChatHistory,
    OTabs,
    OTab,
    OTooltip,
    OPageLayout,
    PinnedDashboardTab,
  },
});
</script>

<style scoped>
/*
 * HomeView Styles — Tab bar and page layout only.
 * Usage-tab-specific styles live in UsageTab.vue.
 */

/* Home tab bar now uses the shared OTabs component (see template). */

/* keep(lib-override): every selector below reaches into the AI chat component's own DOM
   (.chat-container / .chat-content / .messages-container / .chat-header /
   .unified-input-box), so none of it is addressable from this template's utilities.
   The brand ribbon gradient + accent glow use the --color-gradient-brand-ribbon and
   --color-ai-accent tokens. */

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
   Heavier border for stronger presence + layered shadows for depth. */
.home-ai-panel :deep(.unified-input-box) {
  --color-ai-input-bg: var(--color-white);
  position: relative;
  border: 0.125rem solid transparent !important;
  background:
    linear-gradient(var(--color-ai-input-bg), var(--color-ai-input-bg)) padding-box,
    var(--color-gradient-brand-ribbon) border-box !important;
  box-shadow:
    0 0.125rem 0.25rem color-mix(in srgb, var(--color-black) 6%, transparent),
    0 0.5rem 1.25rem -0.125rem color-mix(in srgb, var(--color-black) 12%, transparent),
    0 1.125rem 2.75rem -0.625rem color-mix(in srgb, var(--color-ai-accent) 30%, transparent) !important;
}

.dark .home-ai-panel :deep(.unified-input-box) {
  --color-ai-input-bg: var(--color-surface-panel);
  box-shadow:
    0 0.125rem 0.25rem color-mix(in srgb, var(--color-black) 45%, transparent),
    0 0.5rem 1.375rem -0.125rem color-mix(in srgb, var(--color-black) 55%, transparent),
    0 1.25rem 3rem -0.625rem color-mix(in srgb, var(--color-ai-accent) 45%, transparent) !important;
}

/* Soft ambient glow behind the input */
.home-ai-panel :deep(.unified-input-box::before) {
  content: "";
  position: absolute;
  inset: -0.625rem;
  border-radius: inherit;
  background: var(--color-gradient-brand-ribbon);
  opacity: 0.22;
  filter: blur(1.375rem);
  z-index: -1;
  pointer-events: none;
}

/* Stronger glow + shadow on focus, no harsh ring */
.home-ai-panel :deep(.unified-input-box:focus-within) {
  box-shadow:
    0 1px 0.125rem color-mix(in srgb, var(--color-black) 4%, transparent),
    0 0.375rem 1rem -0.125rem color-mix(in srgb, var(--color-black) 10%, transparent),
    0 1rem 2.5rem -0.5rem color-mix(in srgb, var(--color-ai-accent) 32%, transparent) !important;
}

.dark .home-ai-panel :deep(.unified-input-box:focus-within) {
  box-shadow:
    0 1px 0.125rem color-mix(in srgb, var(--color-black) 40%, transparent),
    0 0.375rem 1.25rem -0.125rem color-mix(in srgb, var(--color-black) 55%, transparent),
    0 1.125rem 2.75rem -0.5rem color-mix(in srgb, var(--color-ai-accent) 42%, transparent) !important;
}

.home-ai-panel :deep(.unified-input-box:focus-within::before) {
  opacity: 0.4;
}
</style>
