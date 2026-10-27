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
  has no data yet: what the page does, where to set it up, the ways to send data, and what
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
          <p
            v-if="spec.minutes"
            class="text-text-secondary basis-full text-sm"
            data-test="no-data-intro-time"
          >
            {{ t("noDataIntro.aboutMinutes", { count: spec.minutes }, spec.minutes) }}
          </p>
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
        <div
          v-if="spec.sources"
          class="grid grid-cols-[repeat(2,minmax(0,18rem))] gap-3 max-md:w-full max-md:grid-cols-1 max-md:gap-2"
        >
          <EmptyStateIngestionCard
            v-for="source in spec.sources"
            :key="source.id"
            :icon="source.icon"
            :label="t(`${rowKey(source)}.name`, source.params)"
            :sublabel="t(`${rowKey(source)}.description`, source.params)"
            :data-test="`${signal}-no-data-intro-${source.id}-card`"
            @click="go(spec.choice, source)"
          />
        </div>
        <ul
          class="text-text-secondary flex flex-wrap justify-center gap-x-5 gap-y-1.5 text-sm"
          :aria-label="t('noDataIntro.afterSetup')"
        >
          <li
            v-for="feature in features"
            :key="feature"
            class="flex items-center gap-1.5"
            :data-test="`no-data-intro-feature-${feature}`"
          >
            <OIcon name="check" size="sm" />
            {{ t(`noDataIntro.${signal}.features.${feature}.title`) }}
          </li>
        </ul>
        <slot name="extra" />
      </template>
    </OEmptyState>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionCard from "@/lib/core/EmptyState/EmptyStateIngestionCard.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import type { IllustrationName } from "@/lib/core/EmptyState/illustrations";
import type { OnboardingChoiceId } from "@/components/onboarding/onboardingChoices";
import { useSetupTarget } from "@/composables/useNoDataIntro";
import { buildFeatureGateContext, checkFeatureAccess } from "@/utils/enterpriseFeatures";

export type NoDataSignal = "logs" | "metrics" | "traces" | "llm" | "rum";

interface Source {
  id: string;
  /** The onboarding row it opens on cloud; the card shows that row's copy. */
  row: string;
  icon: IconName;
  /** Otherwise: the ingestion page for the same source. */
  route: string;
  params: Record<string, unknown>;
}

interface IntroSpec {
  /** The module's nav label, shown above the headline. */
  module: I18nKey;
  title: I18nKey;
  description: I18nKey;
  illustration: IllustrationName;
  /** Left out where no one estimate holds for every way in. */
  minutes?: number;
  /** The onboarding choice this signal starts from (cloud, org with no data). */
  choice: OnboardingChoiceId;
  /** Otherwise: the setup page this page's empty state already linked to. */
  route: string;
  sources?: Source[];
  features: string[];
}

const SPECS: Record<NoDataSignal, IntroSpec> = {
  logs: {
    module: "menu.search",
    title: "noDataIntro.logs.title",
    description: "noDataIntro.logs.description",
    illustration: "logs",
    choice: "logs",
    route: "curl",
    sources: [
      {
        id: "shipper",
        row: "from-a-log-shipper-you-run",
        icon: "extension",
        route: "fluentbit",
        // the row's first guides; the spec checks them against onboarding
        params: { examples: raw("Fluent Bit, Fluentd, Vector, Filebeat"), count: 3 },
      },
      {
        id: "curl",
        row: "over-http-with-curl",
        icon: "send",
        route: "curl",
        params: { curl: raw("curl") },
      },
      {
        id: "otel",
        row: "from-opentelemetry",
        icon: "code",
        route: "ingestLogsFromOtel",
        params: { otel: raw("OpenTelemetry") },
      },
      {
        id: "other",
        row: "something-else",
        icon: "swap-horiz",
        route: "recommended",
        params: { splunk: raw("Splunk"), cribl: raw("Cribl") },
      },
    ],
    features: ["search", "patterns", "alerts"],
  },
  metrics: {
    module: "menu.metrics",
    title: "noDataIntro.metrics.title",
    description: "noDataIntro.metrics.description",
    illustration: "wave-bars",
    minutes: 5,
    choice: "infrastructure",
    route: "ingestMetrics",
    features: ["explore", "dashboards", "alerts"],
  },
  traces: {
    module: "menu.traces",
    title: "noDataIntro.traces.title",
    description: "noDataIntro.traces.description",
    illustration: "trace",
    minutes: 10,
    choice: "backend",
    route: "tracesOTLP",
    features: ["spans", "latency", "logs"],
  },
  llm: {
    module: "menu.aiObservability",
    title: "noDataIntro.llm.title",
    description: "noDataIntro.llm.description",
    illustration: "constellation",
    minutes: 5,
    choice: "llm",
    route: "ai-integrations",
    features: ["cost", "latency", "agents"],
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
    features: ["performance", "errors", "replay"],
  },
};

// log patterns are enterprise-only; other builds get a point every build has
const LOG_DASHBOARDS = "dashboards";

const props = defineProps<{
  signal: NoDataSignal;
  /** FirstDataPanel's command card already asks for setup above: drop the time and buttons. */
  hideSetup?: boolean;
}>();

defineSlots<{
  /** FirstDataPanel's status line, above the setup buttons. */
  status?(): unknown;
  /** Extra links under the "After setup you can" line. */
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
  return spec.value.features.map((f) => (f === "patterns" && !patterns ? LOG_DASHBOARDS : f));
});

// a row's copy sits under the camelCase of its id, as onboarding reads it
const rowKey = (source: Source) =>
  `onboarding.${spec.value.choice}.rows.${source.row.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`;

const go = (choice: OnboardingChoiceId | "agent", source?: Source) => {
  void router.push(target(choice, source?.route ?? spec.value.route, source?.row));
};
</script>
