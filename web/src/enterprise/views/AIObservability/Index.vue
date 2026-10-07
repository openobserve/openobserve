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
  picks the route the rail/breadcrumb highlight.
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
      />
    </template>

    <section class="h-full min-h-0 min-w-0 overflow-y-auto">
      <router-view />
    </section>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { useStore } from "vuex";
import { useRoute } from "vue-router";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import SectionRail from "@/components/common/SectionRail.vue";
import type { SectionHubGroup, SectionHubItem } from "@/components/common/SectionHub.vue";
import { navSection } from "./navSection";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";
import { AI_OBSERVABILITY_SECTIONS } from "@/composables/shared/useAIObservabilityRoutes";

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

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

const activeSection = computed<string>(() => navSection(route.name, route.query.tab));

// Single source of truth for the rail items (groups) AND the breadcrumb
// switcher, derived from AI_OBSERVABILITY_SECTIONS — the SAME list the OSS
// and enterprise routers build their /ai routes from (see
// composables/shared/useAIObservabilityRoutes.ts), so a nav item's
// `featureKey`/`routeName` can't drift from what actually gates/names its
// route. Every section beyond Monitor's LLM Insights + Sessions is
// enterprise/cloud-only — rather than hiding those items in OSS, they stay
// visible but locked (lock icon + pitch-card tooltip), matching the
// Settings/IAM rail pattern.
const sectionItems = computed<(SectionHubItem & { group: string })[]>(() => {
  const featureGateCtx = buildFeatureGateContext(store.state.zoConfig);
  // Memoized per featureKey, not per nav item — the four Evaluate entries
  // share one key and would otherwise recompute the same access check 4x.
  const accessByFeatureKey = new Map<string, ReturnType<typeof checkFeatureAccess>>();
  return AI_OBSERVABILITY_SECTIONS.map((section) => {
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
        query: section.tabQuery
          ? { ...orgQuery.value, tab: section.tabQuery }
          : orgQuery.value,
      },
      dataTest: section.dataTest,
      group: section.group,
      locked,
      lockedMessage,
    };
  });
});

const activeSectionItem = computed(() =>
  sectionItems.value.find((i) => i.key === activeSection.value),
);

// Group order: Monitor, then Evaluate, then Experiment, then Annotate at the
// bottom. Experiment is its own section (not an Evaluate sub-item) because an
// experiment is a run you author, not a scoring config you maintain.
const sectionGroupOrder = ["Monitor", "Evaluate", "Experiment", "Annotate"];

const groupLabels = computed<Record<string, I18nText>>(() => ({
  Monitor: t("aiObservability.sections.monitor"),
  Annotate: t("aiObservability.sections.annotate"),
  Evaluate: t("aiObservability.sections.evaluate"),
  Experiment: t("aiObservability.sections.experiment"),
}));

const sectionGroups = computed<SectionHubGroup[]>(() => {
  const buckets = new Map<string, SectionHubItem[]>();
  for (const item of sectionItems.value) {
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

// Reserved for future per-section header chrome wiring (mirrors Settings'
// activeSectionItem use). Keeping the reference live for clarity.
void activeSectionItem.value;
</script>
