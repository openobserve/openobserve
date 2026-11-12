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

<!-- AI Observability shell: a section rail; tabbed rail items draw a tab strip, one route per tab. -->
<template>
  <OPageLayout bleed :sidebar-width="railCollapsed ? RAIL_COLLAPSED_WIDTH : RAIL_WIDTH">
    <template #sidebar>
      <SectionRail
        v-model:collapsed="railCollapsed"
        :groups="sectionGroups"
        :active-key="activeSection"
        :title="t('aiObservability.title')"
        :icon="AI_ICON"
        collapsible
      >
        <!-- Rail foot: Playground and a Tools menu of Configure pages; they stack when collapsed. -->
        <template v-if="footerItem || configureItems.length" #footer="{ collapsed }">
          <div class="flex gap-2" :class="collapsed ? 'flex-col items-center' : 'items-center'">
            <OButton
              v-if="footerItem"
              variant="outline-primary"
              :size="collapsed ? 'icon-md' : 'md'"
              :active="activeSection === footerItem.key"
              :icon-left="collapsed ? undefined : 'play-arrow'"
              :icon-right="footerItem.locked && !collapsed ? 'lock' : undefined"
              :aria-label="collapsed ? footerItem.label : undefined"
              :aria-current="activeSection === footerItem.key ? 'page' : undefined"
              :class="collapsed ? undefined : 'flex-1'"
              :data-test="footerItem.locked ? `${footerItem.dataTest}-locked` : footerItem.dataTest"
              @click="openEntry(footerItem)"
            >
              <OIcon v-if="collapsed" name="play-arrow" size="sm" />
              <template v-else>{{ footerItem.label }}</template>
              <OTooltip v-if="collapsed" :content="footerItem.label" side="right" />
            </OButton>
            <ODropdown
              v-if="configureItems.length"
              v-model:open="toolsOpen"
              :side="collapsed ? 'right' : 'top'"
              align="end"
            >
              <template #trigger>
                <OButton
                  variant="outline"
                  size="icon-md"
                  :active="configureActive"
                  :aria-label="t('aiObservability.nav.tools')"
                  data-test="ai-rail-tools"
                >
                  <OIcon name="tune" size="sm" />
                  <!-- Off while the menu is open: it would sit over the menu's items. -->
                  <OTooltip
                    v-if="!toolsOpen"
                    :content="t('aiObservability.nav.tools')"
                    side="right"
                  />
                </OButton>
              </template>
              <ODropdownGroup :label="groupLabels.Configure">
                <ODropdownItem
                  v-for="entry in configureItems"
                  :key="entry.key"
                  :icon-left="entry.icon"
                  :aria-current="activeSection === entry.key ? 'page' : undefined"
                  :data-test="entry.locked ? `${entry.dataTest}-locked` : entry.dataTest"
                  @select="openEntry(entry)"
                >
                  {{ entry.label }}
                  <template v-if="entry.locked" #icon-right>
                    <OIcon name="lock" size="xs" />
                  </template>
                </ODropdownItem>
              </ODropdownGroup>
            </ODropdown>
          </div>
        </template>
      </SectionRail>
    </template>

    <section class="flex h-full min-h-0 min-w-0 flex-col">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <OnlineEvalsDisabled v-if="onlineEvalsRouteOff" />
        <!-- Only pages that declare the event get the listener; elsewhere Vue warns on fragment roots. -->
        <router-view v-else v-slot="{ Component }">
          <component :is="Component" v-bind="aiChatListener(Component)" />
        </router-view>
      </div>
    </section>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, provide, ref, watch, type VNode } from "vue";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import { useRoute, useRouter } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import SectionRail from "@/components/common/SectionRail.vue";
import type { SectionHubGroup, SectionHubItem } from "@/components/common/SectionHub.vue";
import { navSection } from "./navSection";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";
import {
  AI_OBSERVABILITY_SECTIONS,
  AI_OBSERVABILITY_TABBED_ITEMS,
  ONLINE_EVAL_FEATURE_KEYS,
  type AiObservabilityGroup,
  type AiObservabilityTabbedItemKey,
} from "@/composables/shared/useAIObservabilityRoutes";
import {
  hidesOnlineEvalEntries,
  useOnlineEvalsRouteOff,
} from "@/composables/shared/useOnlineEvalsGate";
import OnlineEvalsDisabled from "@/components/OnlineEvalsDisabled.vue";
import { AI_SECTION_TABS } from "@/enterprise/components/AIObservability/aiSectionTabs";

const emit = defineEmits<{ (e: "sendToAiChat", ...args: unknown[]): void }>();

const forwardToAiChat = (...args: unknown[]) => emit("sendToAiChat", ...args);
function aiChatListener(page: VNode | undefined) {
  const emits = (page?.type as { emits?: string[] | Record<string, unknown> } | undefined)?.emits;
  const declared = Array.isArray(emits) ? emits.includes("sendToAiChat") : !!emits?.sendToAiChat;
  return declared ? { onSendToAiChat: forwardToAiChat } : {};
}

/** The same mark the primary nav uses for this module, so the collapsed rail
 *  still says which module it belongs to. */
const AI_ICON: IconName = "auto-awesome";

// Wide enough for one icon plus the pill's own inset; the expanded width is
// unchanged from before the toggle existed.
const RAIL_WIDTH = 230;
const RAIL_COLLAPSED_WIDTH = 52;
const RAIL_STORAGE_KEY = "o2-ai-rail-collapsed";

// Remembered per browser: a rail you collapsed should not reopen every time you
// leave the module. Storage can throw (private mode), and the rail opening
// expanded is a fine outcome when it does.
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const railCollapsed = ref(readCollapsed());

watch(railCollapsed, (value) => {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, String(value));
  } catch {
    // Unavailable storage keeps the toggle working for this session only.
  }
});

defineOptions({ name: "AIObservabilityShell" });

const { t } = useI18nTyped();
const store = useStore();
const route = useRoute();
const router = useRouter();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

/** The lit section: a rail item of its own, or a tab of one. */
const activeTab = computed<string>(() => navSection(route.name, route.query.tab));

// A deep link to an evaluation page with evaluations off renders the disabled state instead.
const onlineEvalsRouteOff = useOnlineEvalsRouteOff();

type SectionEntry = Omit<SectionHubItem, "icon" | "dataTest"> & {
  icon: IconName;
  dataTest: string;
  group: AiObservabilityGroup;
  tabOf?: AiObservabilityTabbedItemKey;
  footer?: true;
};

// Derived from AI_OBSERVABILITY_SECTIONS, the list the routers use, so nav keys can't drift from routes.
const sectionEntries = computed<SectionEntry[]>(() => {
  const featureGateCtx = buildFeatureGateContext(store.state.zoConfig);
  // With online evaluations off the server serves no evaluation sections, so drop them.
  const hideEvalSections = hidesOnlineEvalEntries(store.state.zoConfig);
  // Per featureKey, not per section: the four Evaluations tabs share one key.
  const accessByFeatureKey = new Map<string, ReturnType<typeof checkFeatureAccess>>();
  const sections = AI_OBSERVABILITY_SECTIONS.filter(
    (section) =>
      !(hideEvalSections && section.featureKey && ONLINE_EVAL_FEATURE_KEYS[section.featureKey]) &&
      (!section.requiresConfigFlag || store.state.zoConfig?.[section.requiresConfigFlag] === true),
  );
  return sections.map((section) => {
    let locked: boolean | undefined;
    let lockedMessage: I18nText | undefined;
    if (section.featureKey) {
      let access = accessByFeatureKey.get(section.featureKey);
      if (!access) {
        access = checkFeatureAccess(section.featureKey, featureGateCtx);
        accessByFeatureKey.set(section.featureKey, access);
      }
      locked = !access.allowed;
      lockedMessage = access.message;
    }
    return {
      key: section.key,
      label: t(section.labelKey),
      icon: section.icon,
      to: {
        name: section.routeName,
        query: section.tabQuery ? { ...orgQuery.value, tab: section.tabQuery } : orgQuery.value,
      },
      dataTest: section.dataTest,
      group: section.group,
      tabOf: section.tabOf,
      footer: section.footer,
      locked,
      lockedMessage,
      lockedLabel: locked ? lockedMessage : undefined,
    };
  });
});

const tabsByItem = computed(() => {
  const tabs = new Map<AiObservabilityTabbedItemKey, SectionEntry[]>();
  for (const entry of sectionEntries.value) {
    if (!entry.tabOf) continue;
    tabs.set(entry.tabOf, [...(tabs.get(entry.tabOf) ?? []), entry]);
  }
  return tabs;
});

// A tabbed item opens on its first unlocked tab and is locked only when every tab is.
const railItems = computed<SectionEntry[]>(() => {
  const items: SectionEntry[] = [];
  for (const entry of sectionEntries.value) {
    if (entry.footer || entry.group === "Configure") continue;
    if (!entry.tabOf) {
      items.push(entry);
      continue;
    }
    const tabs = tabsByItem.value.get(entry.tabOf)!;
    if (tabs[0] !== entry) continue;
    const item = AI_OBSERVABILITY_TABBED_ITEMS[entry.tabOf];
    const open = tabs.find((tab) => !tab.locked);
    items.push({
      key: entry.tabOf,
      label: t(item.labelKey),
      icon: item.icon,
      to: (open ?? entry).to,
      dataTest: item.dataTest,
      group: entry.group,
      locked: !open || undefined,
      lockedMessage: open ? undefined : entry.lockedMessage,
      lockedLabel: open ? undefined : entry.lockedMessage,
    });
  }
  return items;
});

/** The section pinned to the rail's foot (Playground), when the rail lists it. */
const footerItem = computed(() => sectionEntries.value.find((entry) => entry.footer));

/** The Configure pages, listed in the foot's Tools menu rather than as a group. */
const configureItems = computed(() =>
  sectionEntries.value.filter((entry) => entry.group === "Configure"),
);
const configureActive = computed(() =>
  configureItems.value.some((entry) => entry.key === activeSection.value),
);
const toolsOpen = ref(false);

// A locked entry goes where a locked rail item does (see SectionRail).
function openEntry(entry: SectionEntry) {
  Promise.resolve(router.push(entry.locked ? { name: "enterpriseFeatures" } : entry.to)).catch(
    () => {},
  );
}

// Looked up in the full table so a deep link to a hidden section still lights its rail item.
const TAB_OF_SECTION = new Map(AI_OBSERVABILITY_SECTIONS.map((s) => [s.key, s.tabOf]));

const activeSection = computed<string>(
  () => TAB_OF_SECTION.get(activeTab.value) ?? activeTab.value,
);

const activeTabs = computed<SectionEntry[]>(() => {
  const item = TAB_OF_SECTION.get(activeTab.value);
  return item ? (tabsByItem.value.get(item) ?? []) : [];
});

// A locked tab goes where a locked rail item does (see SectionRail).
function openTab(key: string | number) {
  if (key === activeTab.value) return;
  const tab = activeTabs.value.find((entry) => entry.key === key);
  if (!tab) return;
  Promise.resolve(router.push(tab.locked ? { name: "enterpriseFeatures" } : tab.to)).catch(
    () => {},
  );
}

const ITEM_SUBTITLES: Record<AiObservabilityTabbedItemKey, I18nKey> = {
  agents: "aiObservability.itemSubtitle.agents",
  costUsage: "aiObservability.itemSubtitle.costUsage",
  evaluations: "aiObservability.itemSubtitle.evaluations",
  scorers: "aiObservability.itemSubtitle.scorers",
  experiments: "aiObservability.itemSubtitle.experiments",
};
const activeItemHeader = computed(() => {
  const key = TAB_OF_SECTION.get(activeTab.value);
  if (!key) return null;
  const item = AI_OBSERVABILITY_TABBED_ITEMS[key];
  return { title: t(item.labelKey), subtitle: t(ITEM_SUBTITLES[key]), icon: item.icon };
});
provide(AI_SECTION_TABS, {
  tabs: activeTabs,
  header: activeItemHeader,
  active: activeTab,
  open: openTab,
});

const sectionGroupOrder = ["Monitor", "Evaluate", "Annotate"];

const groupLabels = computed<Record<string, I18nText>>(() => ({
  Monitor: t("aiObservability.sections.monitor"),
  Annotate: t("aiObservability.sections.annotate"),
  Evaluate: t("aiObservability.sections.evaluate"),
  Configure: t("aiObservability.sections.configure"),
}));

const sectionGroups = computed<SectionHubGroup[]>(() => {
  const buckets = new Map<string, SectionHubItem[]>();
  for (const item of railItems.value) {
    const g = item.group;
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(item);
  }
  const rank = (label: string) => {
    const i = sectionGroupOrder.indexOf(label);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...buckets.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((key) => ({ label: groupLabels.value[key] ?? raw(key), items: buckets.get(key)! }));
});
</script>
