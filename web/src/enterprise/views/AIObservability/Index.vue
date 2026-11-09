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
  AI Observability module shell — mirrors the Settings/IAM scaffold so the
  module fits the new app-wide UX (left section rail + breadcrumb in the top
  chrome). The rail is data-driven via SectionHubGroup[]; routing each item
  picks the route the rail/breadcrumb highlight. A rail item that holds several
  sections (AI_OBSERVABILITY_TABBED_ITEMS) draws them as a tab strip above the
  page; each tab is its own route, so the page under it is unchanged.
-->
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
        <!-- The rail's foot, apart from the groups: Playground, and a Tools
             menu holding the Configure pages. Collapsed, the two stack. -->
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
        <!-- Pages hand questions to the O2 AI panel (AIO-36 "Explain"); MainLayout listens here. -->
        <router-view
          v-else
          @send-to-ai-chat="(...args: unknown[]) => emit('sendToAiChat', ...args)"
        />
      </div>
    </section>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
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

// Single source of truth for the rail items, their tabs AND the breadcrumb
// switcher, derived from AI_OBSERVABILITY_SECTIONS — the SAME list the OSS
// and enterprise routers build their /ai routes from (see
// composables/shared/useAIObservabilityRoutes.ts), so a nav item's
// `featureKey`/`routeName` can't drift from what actually gates/names its
// route. Every section beyond LLM Insights, Sessions, Issues, Users and
// Budgets is enterprise/cloud-only — rather than hiding those in OSS, they
// stay visible but locked (lock icon + pitch-card tooltip), matching the
// Settings/IAM rail pattern.
const sectionEntries = computed<SectionEntry[]>(() => {
  const featureGateCtx = buildFeatureGateContext(store.state.zoConfig);
  // With online evaluations off the server serves no evaluation sections, so drop them.
  const hideEvalSections = hidesOnlineEvalEntries(store.state.zoConfig);
  // Memoized per featureKey, not per section — the four Evaluations tabs
  // share one key and would otherwise recompute the same access check 4x.
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

// One rail item per standalone section and per tabbed item, placed where its
// first tab sits. A tabbed item opens on its first unlocked tab and is locked
// only when every tab is.
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

// Looked up in the full table, not the listed entries: a deep link to a
// section the rail hides still lights its rail item.
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

// Each page draws its tabs in its own header, under the title (AiSectionTabs),
// as the rest of the app does; the shell only knows which tabs there are.
// A tabbed rail item's header, the same on each of its tabs (Alerts keeps "Alerts").
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

// Group order: Monitor, then Evaluate, then Annotate. Evaluate holds
// Evaluations (scoring live traffic), Experiments (runs over a dataset) and
// Prompts. The rail's foot holds the rest: Playground, and the Configure pages
// (the settings the pages above read) in its Tools menu.
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
