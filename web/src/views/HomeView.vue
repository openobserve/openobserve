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
  <div class="rounded-default flex h-full min-h-0 flex-col overflow-hidden" data-test="home-page">
    <!-- No card-container here: the page already renders inside MainLayout's
         bordered content card, so an inner panel border would double-frame the
         home page. Keep only the layout classes.

         The page is NOT padded at the root: the header must be full-bleed so its
         bottom divider reaches the card edges (like Data Sources / Pipelines) —
         a padded root insets the header and makes it read as a floating bar.
         Padding is reintroduced on the body wrapper below the header instead. -->
    <OPageLayout
      :title="t('menu.home')"
      :subtitle="assistantV2 ? undefined : t('home.subtitle')"
      icon="home"
      :tabs-below="tabOrder.length > 1"
      bleed
    >
      <template v-if="!assistantV2 && isMobile && activeHomeTab === 'ai' && !aiLocked" #actions>
        <OButton
          variant="outline"
          size="sm"
          data-test="home-mobile-chats-toggle"
          @click="mobileChatsOpen = true"
        >
          <template #icon-left><OIcon name="menu" size="sm" /></template>
          {{ t("chatHistory.title") }}
        </OButton>
      </template>
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
          :class="{ invisible: !homePrefsReady }"
          data-test="home-tab-bar"
          @change="onTabChange"
          @reorder="onTabReorder"
        >
          <OTab
            v-for="tab in tabOrder"
            :key="tab.id"
            :name="tab.id"
            :data-test="`home-tab-${tab.id}`"
            :tooltip="tab.id === 'ai' ? tabLockReason(tab.id) : undefined"
          >
            <span class="o-tab__label truncate">{{ tab.label }}</span>
            <template v-if="tabLockReason(tab.id)">
              <OIcon
                name="lock"
                size="xs"
                class="lock-chip ms-1 shrink-0"
                :data-test="`home-tab-lock-${tab.id}`"
              />
              <span class="sr-only">{{ tabLockReason(tab.id) }}</span>
            </template>
            <template v-if="tab.id.startsWith('dash:')" #trailing>
              <button
                type="button"
                class="rounded-default text-text-secondary hover:bg-surface-subtle-hover hover:text-text-body inline-flex h-5 w-5 cursor-pointer items-center justify-center border-none bg-transparent opacity-60 transition-all duration-200 ease-[ease] hover:opacity-100 max-md:h-6 max-md:w-6"
                :data-test="`home-tab-close-${tab.id}`"
                :aria-label="t('home.removeHomeDashboard')"
                @mousedown.stop.prevent
                @pointerdown.stop.prevent
                @click.stop.prevent="onCloseTab(tab.id)"
              >
                <OIcon name="close" size="xs" />
              </button>
              <OTooltip side="bottom" :content="t('home.removeHomeDashboard')" />
            </template>
          </OTab>
        </OTabs>
      </template>

      <!-- Body: padded wrapper that holds the active tab panel. Padding lives
           here (not on the root) so the header above stays full-bleed. The
           pinned dashboard tab opts out: its actions row draws a full-bleed
           divider (like the header's) and the dashboard grid pads itself. -->
      <div
        class="flex min-h-0 flex-1 flex-col"
        :class="activeHomeTab.startsWith('dash:') ? '' : 'px-2.5 pt-px pb-2.5'"
      >
        <FirstDataNotice
          v-if="firstDataNotice?.visible.value"
          class="mt-2.5 mb-3"
          :stream="firstDataNotice.stream.value"
          :arrived-at="firstDataNotice.arrivedAt.value"
          @open="firstDataNotice.open"
          @dismiss="firstDataNotice.dismiss"
        />
        <SampleDataHomeBanner v-if="activeHomeTab === 'overview'" class="mt-2.5 mb-1" />
        <FirstDataPanel
          v-if="flagOn && isDataTab && arrived"
          signal="any"
          variant="compact"
          :arrived="arrived"
          class="mt-2.5 mb-3"
          @dismiss="arrived = undefined"
          @open="openArrived"
        />
        <LicenseDeniedState
          v-if="activeHomeTab === 'ai' && aiLocked"
          :features="['ai_assistant']"
          data-test="home-ai-locked"
        />
        <!-- O2 AI Assistant tab -->
        <div
          v-else-if="activeHomeTab === 'ai' && !assistantV2"
          class="home-ai-panel flex min-h-0 flex-1 flex-row overflow-hidden max-md:flex-col"
        >
          <HomeChatHistory class="max-md:hidden" @load-chat="onLoadChat" @new-chat="onNewChat" />
          <O2AIChat
            ref="homeChat"
            :is-open="true"
            :header-height="0"
            :centered-start="true"
            :ai-chat-payload="aiChatPayload"
          />
          <ODrawer
            v-if="isMobile"
            v-model:open="mobileChatsOpen"
            side="left"
            size="sm"
            bleed
            seamless
            anchor="header.app-page-header"
            anchor-edge="bottom"
            data-test="home-mobile-chats-drawer"
          >
            <HomeChatHistory
              class="w-full!"
              @load-chat="
                (chat) => {
                  onLoadChat(chat);
                  mobileChatsOpen = false;
                }
              "
              @new-chat="
                () => {
                  onNewChat();
                  mobileChatsOpen = false;
                }
              "
            />
          </ODrawer>
        </div>

        <HomeViewSkeleton v-if="!homePrefsReady" />
        <!-- The hero's own rail and no chat bar, so a sent question stays on the same Home -->
        <div
          v-else-if="aiHome && threadId !== null"
          class="-mx-2.5 -mb-2.5 flex min-h-0 flex-1 overflow-hidden"
          data-test="home-full-thread"
        >
          <HomeThreadContext />
          <aside
            v-if="threadRail"
            :aria-label="t('assistant.history.title')"
            :class="HOME_RAIL_CLASS"
            data-test="assistant-home-chats"
          >
            <HomeChatsRail thread @close="threadView?.focusEntry()" />
          </aside>
          <AssistantView
            ref="threadView"
            :chat-id="threadId"
            bare
            :class="[
              'h-full min-w-0 flex-1',
              threadHandoff && 'motion-safe:animate-[assistant-fade-up_0.25s_ease-out_both]',
            ]"
          />
        </div>
        <div
          v-else-if="aiFirstRun"
          class="min-h-0 flex-1 overflow-y-auto pt-2.5"
          data-test="home-ai-first-run"
        >
          <HomeNoDataContext />
          <AgentHomeFirstRun class="mb-4" />
        </div>
        <FirstDataPanel
          v-else-if="flagOn && isDataTab"
          v-slot="{ layout, statusLine }"
          signal="any"
          variant="compact"
          :context="activeHomeTab === 'usage' ? 'usage' : 'overview'"
          status-in-slot
          @detected="(r) => (arrived = r)"
        >
          <HomeViewSkeleton v-if="layout === 'pending'" />
          <div
            v-else-if="layout !== 'none'"
            class="min-h-0 flex-1 overflow-y-auto"
            :class="{ 'pt-2.5': layout !== 'card' }"
          >
            <div
              v-if="activeHomeTab === 'usage'"
              class="flex shrink-0 flex-col not-empty:mb-3 empty:hidden"
            >
              <TrialPeriod current-page="usage" />
            </div>
            <OEmptyState
              v-if="layout === 'forbidden'"
              preset="no-access"
              size="block"
              data-test="home-no-access-empty-state"
            />
            <template v-else>
              <template v-if="activeHomeTab === 'ai'">
                <HomeNoDataContext />
                <AgentHomeFirstRun class="mb-4" />
              </template>
              <HomeNoDataState
                :tab="activeHomeTab === 'usage' ? 'usage' : 'overview'"
                :alternatives-only="layout === 'card'"
              >
                <template v-if="layout === 'status'" #status>
                  <component :is="statusLine" />
                </template>
              </HomeNoDataState>
            </template>
          </div>
          <div
            v-else-if="aiHome"
            class="-mx-2.5 -mb-2.5 min-h-0 flex-1 overflow-hidden"
            data-test="home-ai-panel"
          >
            <AssistantHomeTab />
          </div>
          <!-- Overview pads itself like the Kubernetes overview, so it cancels the body inset to run edge to edge -->
          <div
            v-else-if="activeHomeTab === 'overview'"
            class="-mx-2.5 -mb-2.5 min-h-0 flex-1 overflow-hidden"
            data-test="home-overview-panel"
          >
            <OverviewTab @send-to-ai-chat="onSendToAiChat" />
          </div>
          <div v-else class="-mx-2.5 min-h-0 flex-1 overflow-hidden">
            <UsageTab />
          </div>
        </FirstDataPanel>

        <template v-else>
          <div
            v-if="aiHome"
            class="-mx-2.5 -mb-2.5 min-h-0 flex-1 overflow-hidden"
            data-test="home-ai-panel"
          >
            <AssistantHomeTab />
          </div>
          <!-- Overview tab (no inner card-container — the outer section panel
               already provides the border; avoids a double-bordered card). -->
          <div
            v-if="activeHomeTab === 'overview'"
            class="-mx-2.5 -mb-2.5 min-h-0 flex-1 overflow-hidden"
            data-test="home-overview-panel"
          >
            <OverviewTab @send-to-ai-chat="onSendToAiChat" />
          </div>

          <!-- Usage tab -->
          <div v-if="activeHomeTab === 'usage'" class="-mx-2.5 min-h-0 flex-1 overflow-hidden">
            <UsageTab />
          </div>

          <!-- Pinned dashboard tab -->
          <div v-else-if="activeHomeTab.startsWith('dash:')" class="min-h-0 flex-1 overflow-hidden">
            <HomeViewSkeleton v-if="pinnedTabPending" />
            <PinnedDashboardTab
              v-else
              :key="activeHomeTab"
              :dashboard-id="parsePinnedTabId(activeHomeTab).dashboardId"
              :folder-id="parsePinnedTabId(activeHomeTab).folderId"
              @update-label="(l) => onPinnedLabel(parsePinnedTabId(activeHomeTab).dashboardId, l)"
              @unavailable="onPinnedUnavailable"
            />
          </div>
        </template>
      </div>
    </OPageLayout>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  effectScope,
  inject,
  nextTick,
  onScopeDispose,
  ref,
  watch,
  onDeactivated,
  onMounted,
  onUnmounted,
} from "vue";
import { useI18nTyped } from "@/types/i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import config from "../aws-exports";
import OverviewTab from "@/views/OverviewTab.vue";
import UsageTab from "@/views/UsageTab.vue";
import O2AIChat from "@/components/O2AIChat.vue";
import LicenseDeniedState from "@/components/common/LicenseDeniedState.vue";
import { menuState } from "@/utils/featureGate";
import type { AiChatHandoff } from "@/plugins/traces/utils/traceAiPayload";
import HomeChatHistory from "@/views/HomeChatHistory.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import useBreakpoint from "@/composables/useBreakpoint";
import PinnedDashboardTab from "@/views/PinnedDashboardTab.vue";
import { useHomeDashboard } from "@/composables/useHomeDashboard";
import { useLicenseLock } from "@/composables/useFeatureLock";
import { toast } from "@/lib/feedback/Toast/useToast";
import FirstDataPanel from "@/components/ingestion/FirstDataPanel.vue";
import FirstDataNotice from "@/components/ingestion/FirstDataNotice.vue";
import { FIRST_DATA_NOTICE } from "@/composables/firstEvent/useFirstDataNotice";
import type { FirstEventResult } from "@/composables/firstEvent/useFirstEventWatch";
import { rangeRoute } from "@/composables/firstEvent/confirmQuery";
import { useOrgHasUserData } from "@/composables/useOrgHasUserData";
import HomeNoDataState from "@/views/HomeNoDataState.vue";
import SampleDataHomeBanner from "@/components/sampleData/SampleDataHomeBanner.vue";
import HomeViewSkeleton from "@/components/shared/HomeViewSkeleton.vue";
import TrialPeriod from "@/enterprise/components/billings/TrialPeriod.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import analytics from "@/services/product_analytics";
import { isAssistantV2 } from "@/composables/assistant/flags";
import {
  AI_HOME_TAB,
  ASSISTANT_SURFACES_SELECTOR,
  HOME_TAB_QUERY_KEY,
  THREAD_QUERY_KEY,
  threadParam,
} from "@/composables/assistant/pure";
import type { GateCode } from "@/composables/assistant/pure";
import { aiTabMode, gateHidesAiTab, HOME_RAIL_CLASS, railGate } from "@/views/home/homeState";
import { useThreadUrlSync } from "@/views/home/useThreadUrl";
import { isFullConfigLoaded } from "@/services/config.queries";
import { useShortcuts } from "@/lib/vue-shortcut-manager";
import { overviewFocusListening, requestOverviewFocus } from "@/composables/goto/goToRequests";
import {
  useHomeContextProvider,
  useHomeWindowProvider,
} from "@/composables/contextProviders/homeContextProvider";
import type { OverviewNowSnapshot } from "@/composables/contextProviders/types";
import { DEFAULT_HOME_RANGE, homePeriodOf, readHomeUrl } from "@/views/home/homeUrl";

// Past this the tabs show in their default order; a key that resolves later never reorders them.
const HOME_PREFS_WAIT_MS = 1_500;

/** Set by Back to Home: this visit opens that tab whatever the saved one, and the key is dropped. */
const HOME_RETURN_TAB_KEY = "home_tab";

/** What the assistant sees while the first-data layout replaces the Overview. */
export const NO_DATA_SNAPSHOT: OverviewNowSnapshot = {
  rows: [],
  noData: true,
  selectedKey: null,
  window: { start: 0, end: 0 },
  services: { available: false, partial: false, dataUntil: null, window: null, allRegions: false },
};

const HomeNoDataContext = defineComponent({
  name: "HomeNoDataContext",
  setup() {
    const route = useRoute();
    useHomeContextProvider(
      () => NO_DATA_SNAPSHOT,
      useStore(),
      () => homePeriodOfRoute(route),
    );
    return () => null;
  },
});

// A thread at Full density on Home keeps the window it had in a panel or window over Home.
const HomeThreadContext = defineComponent({
  name: "HomeThreadContext",
  setup() {
    const route = useRoute();
    useHomeWindowProvider(useStore(), () => homePeriodOfRoute(route));
    return () => null;
  },
});

function homePeriodOfRoute(route: ReturnType<typeof useRoute>) {
  return homePeriodOf(readHomeUrl(route.query).range ?? DEFAULT_HOME_RANGE);
}

/** One dynamic import per mount, shared by the gate and the tab prefs. */
function loadAssistant() {
  return import("@/composables/assistant");
}

/** The assistant gate, read without loading the assistant chunk when the v2 flag is off. */
function useAssistantGate(enabled: boolean, assistant: ReturnType<typeof loadAssistant> | null) {
  const gate = ref<GateCode>("loading");
  if (!enabled || !assistant) return gate;
  const scope = effectScope();
  onScopeDispose(() => scope.stop());
  void assistant.then(
    ({ useAssistantCapability }) => {
      if (!scope.active) return;
      scope.run(() => {
        const capability = useAssistantCapability();
        watch(capability.gate, (value) => (gate.value = value), { immediate: true });
      });
    },
    () => (gate.value = "unhealthy"),
  );
  return gate;
}

/** Home's v2 tab state under the signed-in user+org; `ready` holds the tabs back until it is applied once. */
function useHomeTabPrefs(
  assistant: ReturnType<typeof loadAssistant>,
  apply: (prefs: { order?: string[]; active?: string | null }) => void,
) {
  const ready = ref(false);
  const scope = effectScope();
  let key: string | null = null;
  // A tab the user saved or picked is never overridden by the gate settling.
  let picked = false;
  const pending: { order?: string[]; active?: string }[] = [];
  let writer: ((userOrgKey: string, delta: { order?: string[]; active?: string }) => void) | null =
    null;
  const fallback = setTimeout(() => (ready.value = true), HOME_PREFS_WAIT_MS);
  const settle = () => {
    clearTimeout(fallback);
    ready.value = true;
  };
  onScopeDispose(() => {
    clearTimeout(fallback);
    scope.stop();
  });
  void assistant.then(({ assistantStore, migrateHome, writeHome }) => {
    if (!scope.active) return;
    writer = writeHome;
    scope.run(() =>
      watch(
        () => assistantStore.state.userOrgKey,
        (userOrgKey) => {
          if (!userOrgKey || userOrgKey === key) return;
          const orgSwitch = key !== null;
          key = userOrgKey;
          if (!ready.value || orgSwitch) {
            const prefs = migrateHome(userOrgKey);
            picked = picked || !!prefs.active;
            apply(prefs);
          }
          settle();
          pending.splice(0).forEach((delta) => writeHome(userOrgKey, delta));
        },
        { immediate: true },
      ),
    );
  }, settle);
  return {
    ready,
    picked: () => picked,
    save(delta: { order?: string[]; active?: string }) {
      if (delta.active) picked = true;
      if (key && writer) writer(key, delta);
      else pending.push(delta);
    },
  };
}

export default defineComponent({
  name: "PageHome",

  setup() {
    const store = useStore();
    const router = useRouter();
    const route = useRoute();
    const { t } = useI18nTyped();
    const firstDataNotice = inject(FIRST_DATA_NOTICE, null);
    const LS_TAB_ORDER_KEY = "o2_home_tab_order";
    const LS_ACTIVE_TAB_KEY = "o2_home_active_tab";

    const isEnterpriseOrCloud = config.isEnterprise === "true" || config.isCloud === "true";
    // The v2 assistant redesigns the AI tab as its own page; the legacy tabs stay byte-identical with it off.
    const assistantV2 = isAssistantV2();
    const assistantModule = assistantV2 ? loadAssistant() : null;
    const aiGate = useAssistantGate(assistantV2, assistantModule);
    if (assistantModule) useThreadUrlSync(assistantModule);
    const requestedTab = (): string | null => {
      if (!assistantV2) return null;
      const value = route.query[HOME_RETURN_TAB_KEY] ?? route.query[HOME_TAB_QUERY_KEY];
      if (threadParam(route.query) !== null) return AI_HOME_TAB;
      return typeof value === "string" && value ? value : null;
    };
    // A tab named in the URL holds for this visit only, so it never becomes the saved tab.
    const forcedTab = ref<string | null>(requestedTab());

    const { homeDashboard, clearHomeDashboard, updateLabel, isLoadedFor, load } =
      useHomeDashboard(t);
    const { locked: dashboardsLocked, lockedReason: dashboardsLockedReason } =
      useLicenseLock("dashboards");
    const { lockedReason: aiLockedReason } = useLicenseLock("ai_assistant");
    const aiState = computed(() =>
      menuState(
        store.state.zoConfig?.features,
        "ai_assistant",
        Boolean(store.state.zoConfig?.ai_enabled),
      ),
    );
    const aiLocked = computed(() => aiState.value === "locked");
    const configLoaded = computed(() => isFullConfigLoaded(store.state.zoConfig));
    const tabLockReason = (id: string) => {
      if (id === "ai" && aiLocked.value) return aiLockedReason.value;
      if (id.startsWith("dash:") && dashboardsLocked.value) return dashboardsLockedReason.value;
      return undefined;
    };

    const aiMode = computed(() =>
      aiTabMode({
        gate: aiGate.value,
        isEnterprise: config.isEnterprise === "true",
        isCloud: config.isCloud === "true",
        menu: aiState.value,
        configLoaded: configLoaded.value,
      }),
    );
    const DEFAULT_TABS = computed(() => {
      const tabs: { id: string; label: string; closable?: boolean }[] = [];
      const legacyAi = !assistantV2 && isEnterpriseOrCloud && aiState.value !== "hidden";
      if (legacyAi || (assistantV2 && aiMode.value !== "hidden")) {
        tabs.push({
          id: "ai",
          label: assistantV2 ? t("home.agent.tabLabel") : t("home.tabAiAssistant"),
        });
      }
      // Always reachable — Incidents/Services inside render locked (not
      // hidden) in a build that doesn't unlock them (see OverviewTab.vue).
      tabs.push({ id: "overview", label: t("home.tabOverview") });
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
      const cleared = clearHomeDashboard(org);
      // Active tab no longer exists in the recomputed set → fall back to first.
      if (!DEFAULT_TABS.value.find((tb) => tb.id === activeHomeTab.value)) {
        activeHomeTab.value = firstTab();
      }
      return cleared;
    }

    let verifyingPin = false;

    // The pinned dashboard could not be loaded (deleted / inaccessible). Clear
    // the pin and tell the user why — distinct from a deliberate close.
    async function onPinnedUnavailable(dashboardId: string, folderId: string) {
      const org = store.state.selectedOrganization?.identifier;
      if (!org || verifyingPin) return;
      verifyingPin = true;
      try {
        await load(org, true);
      } finally {
        verifyingPin = false;
      }
      const failed = `dash:${folderId}:${dashboardId}`;
      const pin = homeDashboard.value;
      if (pin?.dashboardId !== dashboardId) return;
      const pinTab = `dash:${pin.folderId}:${pin.dashboardId}`;
      // The pin is org-wide, so it is only deleted when a fresh read still names the folder that failed; a late failure from a replaced tab must not.
      if (pinTab !== failed) {
        if (activeHomeTab.value === failed) activeHomeTab.value = pinTab;
        return;
      }
      if (activeHomeTab.value !== failed) return;
      removeHomePin();
      toast({
        variant: "error",
        message: t("dashboard.homePinUnavailable"),
      });
    }

    function onCloseTab(id: string) {
      if (!id.startsWith("dash:")) return;
      // Deliberate unpin — no error toast.
      void removeHomePin().then(() => {
        // A failed clear restores the pin, so only a cleared one counts.
        if (!homeDashboard.value)
          analytics.track("home_dashboard_unpinned", { source: "home_tab" });
      });
    }

    function onTabChange(id: string | number) {
      const tab = String(id).startsWith("dash:") ? "dashboard" : String(id);
      analytics.track("home_tab_switched", { tab });
    }

    function loadTabOrder() {
      if (assistantV2) return [...DEFAULT_TABS.value];
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
    // Home opens on the AI tab only where the assistant can be used; elsewhere on Overview.
    const firstTab = () =>
      assistantV2 && aiMode.value !== "default"
        ? "overview"
        : (tabOrder.value[0]?.id ?? "overview");

    // DEFAULT_TABS depends on zoConfig.ai_enabled, which arrives asynchronously
    // from the backend /config response. Re-sync tabOrder whenever the set of
    // available tabs changes so the AI tab appears once the backend confirms
    // it's enabled.
    watch(
      () => DEFAULT_TABS.value.map((t) => t.id).join(","),
      () => {
        // Late tabs land where the user dragged them, or in the default order (AI first) if never dragged.
        tabOrder.value = loadTabOrder();
      },
    );

    // The tab id carries the folder, so a saved tab for the pinned dashboard takes the pin's current folder.
    function pinTabFor(id: string) {
      const pin = homeDashboard.value;
      if (!pin || !id.startsWith("dash:")) return id;
      if (parsePinnedTabId(id).dashboardId !== pin.dashboardId) return id;
      return `dash:${pin.folderId}:${pin.dashboardId}`;
    }

    const storedActiveTab = assistantV2 ? null : localStorage.getItem(LS_ACTIVE_TAB_KEY);
    const savedActiveTab = storedActiveTab && pinTabFor(storedActiveTab);
    const isAvailableTab = (id: string) => DEFAULT_TABS.value.some((tb) => tb.id === id);
    const pinnedTabPending = ref(
      !!savedActiveTab?.startsWith("dash:") &&
        !isAvailableTab(savedActiveTab) &&
        !isLoadedFor(store.state.selectedOrganization?.identifier),
    );
    const activeHomeTab = ref(
      forcedTab.value && isAvailableTab(forcedTab.value)
        ? forcedTab.value
        : savedActiveTab && (pinnedTabPending.value || isAvailableTab(savedActiveTab))
          ? savedActiveTab
          : firstTab(),
    );
    watch(
      () => [
        pinnedTabPending.value,
        isAvailableTab(pinTabFor(activeHomeTab.value)),
        isLoadedFor(store.state.selectedOrganization?.identifier),
      ],
      ([pending, available, loaded]) => {
        if (!pending || (!available && !loaded)) return;
        pinnedTabPending.value = false;
        activeHomeTab.value = available ? pinTabFor(activeHomeTab.value) : firstTab();
      },
    );

    // A tab Home picked by itself (the gate settling) is shown but never saved as the user's choice.
    let autoTab: string | null = null;
    const setAutoTab = (tab: string) => {
      autoTab = tab;
      activeHomeTab.value = tab;
    };
    // The AI tab was asked for (a link or the saved prefs) before the config made it available.
    let pendingAi = forcedTab.value === AI_HOME_TAB && activeHomeTab.value !== AI_HOME_TAB;
    // The saved tab a link held back, applied if the link turns out to name a tab this Home never gets.
    let heldPrefActive: string | null = null;

    watch(activeHomeTab, (val) => {
      const auto = autoTab === val;
      autoTab = null;
      if (forcedTab.value === val || auto) return;
      dropStaleTabQuery(val);
      forcedTab.value = null;
      pendingAi = false;
      if (assistantV2) homePrefs.save({ active: val });
      else localStorage.setItem(LS_ACTIVE_TAB_KEY, val);
    });

    // Leaving the tab a link named drops `tab` (and the AI tab's thread), so a reload opens the saved tab.
    function dropStaleTabQuery(val: string): void {
      const named = route.query[HOME_TAB_QUERY_KEY];
      const thread = threadParam(route.query) !== null;
      const staleTab = typeof named === "string" && named !== val;
      if (!staleTab && !(thread && val !== AI_HOME_TAB)) return;
      const query = { ...route.query };
      if (val !== AI_HOME_TAB) delete query[THREAD_QUERY_KEY];
      delete query[HOME_TAB_QUERY_KEY];
      void router.replace({ query }).catch(() => undefined);
    }

    // `?tab=ai&thread=` shows that chat at Full density inside the AI tab.
    const threadId = computed(() => (assistantV2 ? threadParam(route.query) : null));
    const aiHome = computed(
      () => assistantV2 && activeHomeTab.value === AI_HOME_TAB && !aiLocked.value,
    );
    // A thread opened while Home is on screen settles in once; a pasted link or a kept-alive return lands still.
    const threadHandoff = ref(false);
    watch(threadId, (id, was) => (threadHandoff.value = id !== null && was === null));
    onDeactivated(() => (threadHandoff.value = false));

    // A thread link or Back to Home can land while Home is already mounted on another tab.
    if (assistantV2) {
      watch(
        () => [route.query[HOME_RETURN_TAB_KEY], route.query[HOME_TAB_QUERY_KEY], threadId.value],
        () => {
          const tab = requestedTab();
          if (tab && isAvailableTab(tab)) {
            forcedTab.value = tab;
            pinnedTabPending.value = false;
            activeHomeTab.value = tab;
          }
          if (route.query[HOME_RETURN_TAB_KEY] === undefined) return;
          const query = { ...route.query };
          delete query[HOME_RETURN_TAB_KEY];
          void router.replace({ query }).catch(() => undefined);
        },
        { immediate: true },
      );
      // The gate resolves after mount: a hidden AI tab hands Home to Overview, a usable one opens if it was asked for or nothing was picked.
      watch(aiMode, (mode, was) => {
        if (mode === "hidden") {
          // A config still arriving reads as hidden too, so a link waits for the AI tab unless the gate itself refused.
          if (activeHomeTab.value === AI_HOME_TAB) {
            pendingAi = pendingAi || forcedTab.value === AI_HOME_TAB;
            setAutoTab("overview");
          }
          dropRefusedAiLink();
          return;
        }
        if (pendingAi) {
          pendingAi = false;
          if (forcedTab.value === AI_HOME_TAB) activeHomeTab.value = AI_HOME_TAB;
          else setAutoTab(AI_HOME_TAB);
          return;
        }
        const becameUsable = was !== "default" && mode === "default";
        const untouched = !homePrefs.picked() && !forcedTab.value;
        if (becameUsable && untouched && activeHomeTab.value === "overview")
          setAutoTab(AI_HOME_TAB);
      });
      // The tab can be hidden from setup (Open Source, a loaded AI-off config), so the refusal is also watched on its inputs.
      watch(() => [aiGate.value, aiState.value, configLoaded.value], dropRefusedAiLink);
      dropRefusedAiLink();
    }

    // A link to the AI tab is dropped only when it can never open here: Open Source, a refusing gate, or a loaded config that hides AI.
    function dropRefusedAiLink(): void {
      const final =
        !isEnterpriseOrCloud ||
        gateHidesAiTab(aiGate.value) ||
        (configLoaded.value && aiState.value === "hidden");
      if (!pendingAi || !final) return;
      pendingAi = false;
      if (forcedTab.value !== AI_HOME_TAB) return;
      forcedTab.value = null;
      dropStaleTabQuery(activeHomeTab.value);
      if (heldPrefActive) applyHeldPref(heldPrefActive);
      heldPrefActive = null;
    }

    // Same rules as the prefs callback: an unloaded pinned dashboard waits for its pin instead of being dropped.
    function applyHeldPref(active: string): void {
      if (isAvailableTab(active)) return setAutoTab(active);
      if (!active.startsWith("dash:") || isLoadedFor(store.state.selectedOrganization?.identifier))
        return;
      setAutoTab(active);
      pinnedTabPending.value = true;
    }

    const { hasAnyStream, hasUserData, isFetching } = useOrgHasUserData(
      () => store.state.selectedOrganization?.identifier ?? "",
    );
    // O2's own streams count, so the _meta org keeps the assistant; a stale cached list may be out of date
    watch(
      [hasAnyStream, isFetching],
      ([has, fetching]) => {
        if (has !== false || fetching || activeHomeTab.value !== AI_HOME_TAB) return;
        // A link that names the AI tab is the user's ask, so only the default landing moves.
        if (forcedTab.value === AI_HOME_TAB) return;
        setAutoTab("overview");
      },
      { immediate: true },
    );

    // The cached pin can be stale from another device, so it is re-read without holding the tab; a stale folder is caught by onPinnedUnavailable.
    function revalidatePin() {
      const org = store.state.selectedOrganization?.identifier;
      if (org) void load(org, true);
    }

    watch(activeHomeTab, (val, prev) => {
      if (!val.startsWith("dash:")) return;
      // Only the folder changed, by the watch below, which already applied the fresh pin.
      if (
        prev?.startsWith("dash:") &&
        parsePinnedTabId(prev).dashboardId === parsePinnedTabId(val).dashboardId
      )
        return;
      revalidatePin();
    });

    // The tab id carries the folder, so a re-read that moved, replaced or dropped the pin must move the open tab with it.
    watch(homeDashboard, (pin) => {
      if (pinnedTabPending.value || !activeHomeTab.value.startsWith("dash:")) return;
      if (!pin || pin.dashboardId !== parsePinnedTabId(activeHomeTab.value).dashboardId) {
        activeHomeTab.value = firstTab();
        return;
      }
      const nextId = `dash:${pin.folderId}:${pin.dashboardId}`;
      if (activeHomeTab.value !== nextId) activeHomeTab.value = nextId;
    });

    if (homeDashboard.value && !pinnedTabPending.value) revalidatePin();

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
      if (assistantV2) homePrefs.save({ order: order.map((t) => t.id) });
      else localStorage.setItem(LS_TAB_ORDER_KEY, JSON.stringify(order.map((t) => t.id)));
    }

    // v2: tab state is per user+org in `o2.assistant.home:{userOrgKey}`, read once the key resolves (constraint 56).
    const homePrefs = assistantModule
      ? useHomeTabPrefs(assistantModule, (prefs) => {
          const ids = prefs.order ?? [];
          if (ids.length) {
            const ordered = ids
              .map((id) => DEFAULT_TABS.value.find((tab) => tab.id === id))
              .filter(Boolean) as { id: string; label: string }[];
            DEFAULT_TABS.value.forEach((tab) => {
              if (!ordered.find((o) => o.id === tab.id)) ordered.push(tab);
            });
            tabOrder.value = ordered;
          }
          const active = prefs.active;
          if (forcedTab.value) {
            heldPrefActive = active ?? null;
            return;
          }
          if (active && isAvailableTab(active)) {
            activeHomeTab.value = active;
          } else if (active === AI_HOME_TAB) {
            pendingAi = true;
          } else if (
            active?.startsWith("dash:") &&
            !isLoadedFor(store.state.selectedOrganization?.identifier)
          ) {
            activeHomeTab.value = active;
            pinnedTabPending.value = true;
          }
        })
      : { ready: ref(true), save: () => undefined, picked: () => false };
    const homePrefsReady = homePrefs.ready;

    const homeChat = ref<any>(null);
    function onLoadChat(id: number) {
      homeChat.value?.loadChat(id);
    }
    function onNewChat() {
      homeChat.value?.addNewChat();
    }

    const aiChatPayload = ref<{
      text: string;
      autoSend: boolean;
      id: number;
      chipName: string;
      newChat: boolean;
      context: Record<string, unknown>;
    } | null>(null);

    // The chat mounts with the AI tab, so the payload waits a tick for its watcher to see the change.
    function onSendToAiChat(handoff: AiChatHandoff) {
      if (aiLocked.value) return;
      // Flag on: the hand-off goes through the assistant's one door, as MainLayout relays a page's payload.
      if (assistantModule)
        return void assistantModule.then((m) => m.openAssistant(m.legacyRelayArgs(handoff)));
      const payload = {
        text: handoff.query,
        autoSend: false,
        id: Date.now(),
        chipName: handoff.chipName,
        newChat: handoff.newChat,
        context: handoff.context,
      };
      activeHomeTab.value = "ai";
      nextTick(() => (aiChatPayload.value = payload));
    }

    function onSwitchTab(e: Event) {
      const tab = (e as CustomEvent).detail;
      if (DEFAULT_TABS.value.find((t) => t.id === tab)) {
        activeHomeTab.value = tab;
      }
    }
    onMounted(() => window.addEventListener("o2:home-switch-tab", onSwitchTab));
    onUnmounted(() => window.removeEventListener("o2:home-switch-tab", onSwitchTab));

    // One `/` binding for Home, so launchers swapping in and out never unbind each other; the visible one answers the request.
    const inAssistantSurface = () => !!document.activeElement?.closest(ASSISTANT_SURFACES_SELECTOR);
    const focusInAssistant = ref(inAssistantSurface());
    const syncAssistantFocus = () => {
      focusInAssistant.value = inAssistantSurface();
    };
    useShortcuts([{ id: "homeFocusAsk", handler: () => void requestOverviewFocus() }], undefined, {
      active: computed(
        () =>
          aiHome.value &&
          threadId.value === null &&
          overviewFocusListening.value &&
          !focusInAssistant.value,
      ),
    });
    onMounted(() => {
      // Children mount before this hook, so a surface that took focus during mount is seen here.
      syncAssistantFocus();
      document.addEventListener("focusin", syncAssistantFocus);
      document.addEventListener("focusout", syncAssistantFocus);
    });
    onUnmounted(() => {
      document.removeEventListener("focusin", syncAssistantFocus);
      document.removeEventListener("focusout", syncAssistantFocus);
    });

    const { isMobile, lgUp } = useBreakpoint();
    const mobileChatsOpen = ref(false);
    // Below lg the hero draws no rail either, so the chat's own New Chat icon stands in for it.
    const threadRail = computed(() => lgUp.value && railGate(aiGate.value));
    const threadView = ref<{ focusEntry(): void } | null>(null);

    // the first-data takeover replaces Overview and Usage only behind the empty-data flag; flag off is BASE Home
    const flagOn = computed(() => store.state.zoConfig?.restricted_routes_on_empty_data === true);
    const isDataTab = computed(
      () =>
        activeHomeTab.value === "overview" ||
        activeHomeTab.value === "usage" ||
        (aiHome.value && threadId.value === null),
    );
    // Without the takeover flag nothing else notices an empty org, so the AI tab reads the stream lists itself.
    const aiFirstRun = computed(
      () => !flagOn.value && aiHome.value && threadId.value === null && hasUserData.value === false,
    );
    const arrived = ref<FirstEventResult>();
    const openArrived = () => {
      const r = arrived.value;
      if (!r) return;
      const org = store.state.selectedOrganization?.identifier ?? "";
      router
        .push(
          rangeRoute(org, r.streamType, r.streamName, { startUs: r.rangeStart, endUs: r.rangeEnd }),
        )
        .catch(() => {});
    };

    return {
      assistantV2,
      threadId,
      threadHandoff,
      threadRail,
      threadView,
      HOME_RAIL_CLASS,
      aiHome,
      homePrefsReady,
      t,
      store,
      config,
      firstDataNotice,
      isMobile,
      mobileChatsOpen,
      activeHomeTab,
      pinnedTabPending,
      tabOrder,
      onTabReorder,
      isEnterpriseOrCloud,
      homeChat,
      aiChatPayload,
      onSendToAiChat,
      onLoadChat,
      onNewChat,
      parsePinnedTabId,
      onPinnedLabel,
      onPinnedUnavailable,
      onCloseTab,
      onTabChange,
      flagOn,
      aiFirstRun,
      isDataTab,
      arrived,
      openArrived,
      aiLocked,
      tabLockReason,
    };
  },
  components: {
    HomeNoDataContext,
    HomeThreadContext,
    AssistantView: defineAsyncComponent(() => import("@/views/AssistantView.vue")),
    HomeChatsRail: defineAsyncComponent(() => import("@/views/home/HomeChatsRail.vue")),
    AgentHomeFirstRun: defineAsyncComponent(() => import("@/views/home/AgentHomeFirstRun.vue")),
    AssistantHomeTab: defineAsyncComponent(() => import("@/views/home/AssistantHomeTab.vue")),
    OverviewTab,
    UsageTab,
    O2AIChat,
    LicenseDeniedState,
    HomeChatHistory,
    OTabs,
    OTab,
    OTooltip,
    OPageLayout,
    OButton,
    OIcon,
    ODrawer,
    PinnedDashboardTab,
    FirstDataPanel,
    FirstDataNotice,
    HomeNoDataState,
    SampleDataHomeBanner,
    HomeViewSkeleton,
    TrialPeriod,
    OEmptyState,
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
  box-shadow: var(--shadow-ai-composer) !important;
}

.dark .home-ai-panel :deep(.unified-input-box) {
  /* Only the fill flips here — --shadow-ai-composer carries its own dark values. */
  --color-ai-input-bg: var(--color-surface-panel);
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
  box-shadow: var(--shadow-ai-focus) !important;
}

.home-ai-panel :deep(.unified-input-box:focus-within::before) {
  opacity: 0.4;
}
</style>
