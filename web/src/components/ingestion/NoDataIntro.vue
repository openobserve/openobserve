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
  NoDataIntro — the product intro a data page shows in place of its query UI while the org
  has no data yet: what the page does, how long setup takes, where to set it up, and what
  the user can do once data arrives. One layout for Logs, Metrics, Traces, AI and RUM.
-->
<template>
  <div
    class="min-h-0 w-full flex-1 overflow-y-auto"
    data-test="no-data-intro"
    :data-signal="signal"
  >
    <OEmptyState size="intro" :illustration="spec.illustration" :hide-action="true">
      <template #eyebrow>
        <span data-test="no-data-intro-module">{{ t(spec.module) }}</span>
      </template>
      <template #title>{{ t(spec.title) }}</template>
      <template #description>{{ t(spec.description) }}</template>

      <template #actions>
        <div v-if="$slots.status" class="flex basis-full justify-center">
          <slot name="status" />
        </div>
        <template v-if="!hideSetup">
          <div class="flex basis-full justify-center">
            <OTag
              :label="t('noDataIntro.aboutMinutes', { count: spec.minutes }, spec.minutes)"
              variant="primary-soft"
              icon="schedule"
              size="md"
              data-test="no-data-intro-time"
            />
          </div>
          <OButton
            variant="primary"
            size="md"
            icon-right="arrow-forward"
            data-test="no-data-intro-setup-btn"
            @click="go(spec.choice)"
          >
            {{ t(`noDataIntro.${signal}.setUp`) }}
          </OButton>
          <OButton
            v-if="onboarding"
            variant="outline"
            size="md"
            data-test="no-data-intro-agent-btn"
            @click="go('agent')"
          >
            {{ t("noDataIntro.codingAgent") }}
          </OButton>
        </template>
      </template>

      <template #extra>
        <section
          class="flex w-full max-w-3xl flex-col gap-2.5 text-start"
          aria-labelledby="no-data-intro-after-setup"
        >
          <h3 id="no-data-intro-after-setup" class="text-text-secondary text-sm font-semibold">
            {{ t("noDataIntro.afterSetup") }}
          </h3>
          <ul class="grid grid-cols-3 gap-3 max-md:grid-cols-1">
            <li v-for="feature in features" :key="feature.id">
              <OCard
                variant="outlined"
                class="h-full gap-1.5 px-4 py-3"
                :data-test="`no-data-intro-feature-${feature.id}`"
              >
                <span class="flex items-center gap-2.5">
                  <span
                    class="rounded-default bg-icon-chip-primary-bg text-icon-chip-primary-text inline-flex size-7 shrink-0 items-center justify-center"
                  >
                    <OIcon :name="feature.icon" size="sm" />
                  </span>
                  <span class="text-text-heading text-sm font-semibold">{{
                    t(`noDataIntro.${signal}.features.${feature.id}.title`)
                  }}</span>
                </span>
                <span class="text-text-secondary text-xs leading-relaxed">{{
                  t(`noDataIntro.${signal}.features.${feature.id}.text`)
                }}</span>
              </OCard>
            </li>
          </ul>
        </section>
        <slot name="extra" />
      </template>
    </OEmptyState>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { IllustrationName } from "@/lib/core/EmptyState/illustrations";
import type { OnboardingChoiceId } from "@/components/onboarding/onboardingChoices";
import { useSetupTarget } from "@/composables/useNoDataIntro";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";

export type NoDataSignal = "logs" | "metrics" | "traces" | "llm" | "rum";

interface Feature {
  id: string;
  icon: IconName;
}

interface IntroSpec {
  /** The module's nav label, shown above the headline. */
  module: I18nKey;
  title: I18nKey;
  description: I18nKey;
  illustration: IllustrationName;
  minutes: number;
  /** The onboarding choice this signal starts from (cloud, org with no data). */
  choice: OnboardingChoiceId;
  /** Otherwise: the setup page this page's empty state already linked to. */
  route: string;
  features: Feature[];
}

const SPECS: Record<NoDataSignal, IntroSpec> = {
  logs: {
    module: "menu.search",
    title: "noDataIntro.logs.title",
    description: "noDataIntro.logs.description",
    illustration: "logs",
    minutes: 2,
    choice: "logs",
    route: "curl",
    features: [
      { id: "search", icon: "search" },
      { id: "patterns", icon: "pattern" },
      { id: "alerts", icon: "notifications-active" },
    ],
  },
  metrics: {
    module: "menu.metrics",
    title: "noDataIntro.metrics.title",
    description: "noDataIntro.metrics.description",
    illustration: "wave-bars",
    minutes: 5,
    choice: "infrastructure",
    route: "ingestMetrics",
    features: [
      { id: "explore", icon: "show-chart" },
      { id: "dashboards", icon: "dashboard" },
      { id: "alerts", icon: "notifications-active" },
    ],
  },
  traces: {
    module: "menu.traces",
    title: "noDataIntro.traces.title",
    description: "noDataIntro.traces.description",
    illustration: "trace",
    minutes: 10,
    choice: "backend",
    route: "tracesOTLP",
    features: [
      { id: "spans", icon: "timeline" },
      { id: "latency", icon: "speed" },
      { id: "logs", icon: "article" },
    ],
  },
  llm: {
    module: "menu.aiObservability",
    title: "noDataIntro.llm.title",
    description: "noDataIntro.llm.description",
    illustration: "constellation",
    minutes: 5,
    choice: "llm",
    route: "ai-integrations",
    features: [
      { id: "cost", icon: "paid" },
      { id: "latency", icon: "speed" },
      { id: "agents", icon: "account-tree" },
    ],
  },
  rum: {
    module: "menu.rum",
    // RUM keeps the copy its empty state already had
    title: "rum.emptyState.title",
    description: "rum.emptyState.description",
    illustration: "radar",
    minutes: 5,
    choice: "frontend",
    route: "frontendMonitoring",
    features: [
      { id: "performance", icon: "speed" },
      { id: "errors", icon: "error-outline" },
      { id: "replay", icon: "play-circle" },
    ],
  },
};

// log patterns are enterprise-only; other builds get a card every build has
const LOG_DASHBOARDS: Feature = { id: "dashboards", icon: "dashboard" };

const props = defineProps<{
  signal: NoDataSignal;
  /** FirstDataPanel's command card already asks for setup above: drop the time and buttons. */
  hideSetup?: boolean;
}>();

defineSlots<{
  /** FirstDataPanel's status line, above the time estimate. */
  status?(): unknown;
  /** Extra links under the "After setup you can" cards. */
  extra?(): unknown;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const { onboarding, target } = useSetupTarget();

const spec = computed(() => SPECS[props.signal]);
const features = computed(() => {
  const patterns = checkFeatureAccess(
    "logPatterns",
    buildFeatureGateContext(store.state.zoConfig),
  ).allowed;
  return spec.value.features.map((f) => (f.id === "patterns" && !patterns ? LOG_DASHBOARDS : f));
});

const go = (choice: OnboardingChoiceId | "agent") => {
  void router.push(target(choice, spec.value.route));
};
</script>
