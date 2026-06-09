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
    class="ai-secondary-sidebar tw:flex tw:flex-col tw:h-full"
    data-test="ai-secondary-sidebar"
  >
    <div class="tw:flex-1 tw:min-h-0 tw:overflow-y-auto">
      <div
        v-if="!compact"
        class="ai-secondary-sidebar__section-label tw:px-[0.75rem] tw:pt-[1.5rem] tw:pb-[0.125rem] tw:text-[0.8125rem] tw:font-normal tw:text-[var(--o2-text-tertiary)] tw:select-none"
      >
        {{ t("aiObservability.sections.monitor") }}
      </div>
      <OTabs
        :model-value="monitorActiveTab"
        orientation="vertical"
        :class="{ 'compact-tabs': compact }"
      >
        <ORouteTab
          data-test="ai-secondary-nav-overview"
          name="overview"
          :to="link('aiOverview')"
          :label="compact ? undefined : t('aiObservability.nav.overview')"
          icon="dashboard"
        >
          <OTooltip
            v-if="compact"
            side="right"
            align="center"
            :sideOffset="8"
            :content="t('aiObservability.nav.overview')"
          />
        </ORouteTab>
        <ORouteTab
          data-test="ai-secondary-nav-sessions"
          name="sessions"
          :to="link('aiSessions')"
          :label="compact ? undefined : t('aiObservability.nav.sessions')"
          icon="forum"
        >
          <OTooltip
            v-if="compact"
            side="right"
            align="center"
            :sideOffset="8"
            :content="t('aiObservability.nav.sessions')"
          />
        </ORouteTab>
      </OTabs>

      <div
        v-if="!compact"
        class="ai-secondary-sidebar__section-label tw:px-[0.75rem] tw:pt-[1.5rem] tw:pb-[0.125rem] tw:text-[0.8125rem] tw:font-normal tw:text-[var(--o2-text-tertiary)] tw:select-none"
      >
        {{ t("aiObservability.sections.evaluate") }}
      </div>
      <OTabs
        :model-value="evaluateActiveTab"
        orientation="vertical"
        :class="{ 'compact-tabs': compact }"
      >
        <ORouteTab
          data-test="ai-secondary-nav-quality"
          name="quality"
          :to="evalLink('quality')"
          :label="compact ? undefined : t('aiObservability.nav.quality')"
          icon="star-rate"
        >
          <OTooltip
            v-if="compact"
            side="right"
            align="center"
            :sideOffset="8"
            :content="t('aiObservability.nav.quality')"
          />
        </ORouteTab>
        <ORouteTab
          data-test="ai-secondary-nav-eval-jobs"
          name="jobs"
          :to="evalLink('jobs')"
          :label="compact ? undefined : t('aiObservability.nav.evalJobs')"
          icon="event"
        >
          <OTooltip
            v-if="compact"
            side="right"
            align="center"
            :sideOffset="8"
            :content="t('aiObservability.nav.evalJobs')"
          />
        </ORouteTab>
        <ORouteTab
          data-test="ai-secondary-nav-scorers"
          name="scorers"
          :to="evalLink('scorers')"
          :label="compact ? undefined : t('aiObservability.nav.scorers')"
          icon="rule"
        >
          <OTooltip
            v-if="compact"
            side="right"
            align="center"
            :sideOffset="8"
            :content="t('aiObservability.nav.scorers')"
          />
        </ORouteTab>
        <ORouteTab
          data-test="ai-secondary-nav-score-configs"
          name="scoreConfigs"
          :to="evalLink('scoreConfigs')"
          :label="compact ? undefined : t('aiObservability.nav.scoreConfigs')"
          icon="tune"
        >
          <OTooltip
            v-if="compact"
            side="right"
            align="center"
            :sideOffset="8"
            :content="t('aiObservability.nav.scoreConfigs')"
          />
        </ORouteTab>
      </OTabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import { useStore } from "vuex";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import ORouteTab from "@/lib/navigation/Tabs/ORouteTab.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

defineOptions({ name: "AISecondarySidebar" });

defineProps<{ compact?: boolean }>();

const { t } = useI18n();
const route = useRoute();
const store = useStore();

type EvalTab = "quality" | "jobs" | "scorers" | "scoreConfigs";

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

function link(name: string) {
  return { name, query: orgQuery.value };
}

function evalLink(tab: EvalTab) {
  return {
    name: "aiEvaluations",
    query: { ...orgQuery.value, tab },
  };
}

// OTabs requires a non-empty modelValue; passing "" leaves the block
// with nothing visually selected, which is correct when the active route
// belongs to the OTHER section.
const monitorActiveTab = computed<string>(() => {
  if (route.name === "aiOverview") return "overview";
  if (route.name === "aiSessions") return "sessions";
  return "";
});

const evaluateActiveTab = computed<string>(() => {
  if (route.name !== "aiEvaluations") return "";
  const tab = (route.query.tab as string) || "quality";
  return tab;
});
</script>

<style scoped lang="scss">
// OTabs ships with `tw:p-1` (4px all sides). In this sidebar we want the
// vertical tabs to extend to the card edges (no awkward whitespace strip
// on the right), so we collapse the horizontal padding while keeping a
// little breathing room above/below the group.
.ai-secondary-sidebar :deep(.o-tabs) {
  padding-left: 0;
  padding-right: 0;
}

// Section labels are presentation-only; reinforce they aren't clickable so
// the cursor never changes on hover and the text can't be selected like
// a nav item.
.ai-secondary-sidebar__section-label {
  cursor: default;
  pointer-events: none;
}

.compact-tabs {
  width: 100%;

  :deep(.o-tabs__content) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.5rem 0;
  }

  :deep(.o-tab) {
    min-height: 2.5rem;
    min-width: 2.5rem;
    width: 2.5rem;
    padding: 0;
    transition: background-color 0.2s ease, color 0.2s ease;

    .o-tab__icon {
      font-size: 1.25rem;

      img {
        width: 1.25rem;
        height: 1.25rem;
      }
    }

    &:hover {
      background-color: var(--o2-hover-accent);
    }

    &.o-tab--active {
      background: color-mix(
        in srgb,
        var(--o2-primary-btn-bg) 20%,
        white 10%
      );
      color: var(--o2-text-primary);

      .o-tab__icon {
        color: var(--o2-text-primary);
      }
    }
  }
}
</style>
