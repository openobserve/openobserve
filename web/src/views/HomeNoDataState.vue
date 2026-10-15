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
  HomeNoDataState — empty state for the Home/Usage tab when the org has no ingested data.
  Each card and chip routes to a distinct, real ingestion path in OpenObserve,
  covering logs, traces, metrics, and AI integrations.
-->
<template>
  <OEmptyState v-bind="{ ...shell, ...rootTestAttrs }" :hide-action="true">
    <template #title>
      <span
        v-if="alternativesOnly"
        class="text-text-secondary text-sm font-normal"
        data-test="home-no-data-another-way"
        >{{ t("ingestion.firstDataPanel.anotherWay") }}</span
      >
      <template v-else-if="tab">{{
        t("logs.noData.title", { product: raw("OpenObserve") })
      }}</template>
      <template v-else>{{ t("home.noDataState.title") }}</template>
    </template>

    <template v-if="!alternativesOnly" #description>
      <span v-if="tab" data-test="home-no-data-description">{{ tabDescription }}</span>
      <span v-else v-html="description" />
    </template>

    <template #actions>
      <div v-if="$slots.status" class="flex basis-full justify-center">
        <slot name="status" />
      </div>

      <!-- Send Logs -->
      <EmptyStateIngestionCard
        icon="search"
        :label="t('home.noDataState.logs')"
        :sublabel="
          t('home.noDataState.logsDesc', {
            product1: raw('Curl'),
            product2: raw('Filebeat'),
            product3: raw('Fluentbit'),
            product4: raw('Vector'),
          })
        "
        icon-variant="blue"
        data-test="home-no-data-logs-card"
        @click="go('curl')"
      />

      <!-- Send Traces -->
      <EmptyStateIngestionCard
        icon="account-tree"
        :label="t('home.noDataState.traces')"
        :sublabel="
          t('home.noDataState.tracesDesc', {
            product1: raw('OTLP'),
            product2: raw('Jaeger'),
            product3: raw('Zipkin'),
          })
        "
        icon-variant="purple"
        data-test="home-no-data-traces-card"
        @click="go('tracesOTLP')"
      />

      <!-- Send Metrics -->
      <EmptyStateIngestionCard
        icon="bar-chart"
        :label="t('home.noDataState.metrics')"
        :sublabel="
          t('home.noDataState.metricsDesc', {
            product1: raw('Prometheus'),
            product2: raw('OTel Collector'),
            product3: raw('Telegraf'),
          })
        "
        icon-variant="teal"
        data-test="home-no-data-metrics-card"
        @click="go('prometheus')"
      />
    </template>

    <template #extra>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <span class="text-text-secondary me-1 text-sm font-semibold">
          {{ t("home.noDataState.or") }}
        </span>
        <EmptyStateIngestionChip
          data-test="home-no-data-otel-btn"
          @click="go('ingestLogsFromOtel')"
        >
          <img
            :src="getImageURL('images/ingestion/otlp.svg')"
            class="h-3.5 w-3.5 shrink-0 object-contain"
            alt=""
          />
          {{ raw("OpenTelemetry") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          data-test="home-no-data-kubernetes-btn"
          @click="go('ingestFromKubernetes')"
        >
          <img
            :src="getImageURL('images/common/kubernetes.svg')"
            class="h-3.5 w-3.5 shrink-0 object-contain"
            alt=""
          />
          {{ raw("Kubernetes") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip data-test="home-no-data-aws-btn" @click="go('AWSConfig')">
          <img
            :src="getImageURL('images/ingestion/aws.svg')"
            class="h-3.5 w-3.5 shrink-0 object-contain"
            alt=""
          />
          {{ t("home.noDataState.aws") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          icon="insights"
          data-test="home-no-data-ai-btn"
          @click="go('ai-integrations')"
          >{{ t("home.noDataState.aiIntegrations") }}</EmptyStateIngestionChip
        >
        <EmptyStateIngestionChip
          icon="alt-route"
          data-test="home-no-data-shippers-btn"
          @click="go('ingestLogs')"
          >{{ t("home.noDataState.shippers") }}</EmptyStateIngestionChip
        >
        <EmptyStateIngestionChip
          v-if="store.state.zoConfig?.profiling_enabled"
          icon="bar-chart"
          data-test="home-no-data-profiles-btn"
          @click="go('profiles')"
        >
          {{ t("home.noDataState.profiles") }}
        </EmptyStateIngestionChip>
      </div>
      <div v-if="tab" class="mt-2 flex justify-center">
        <OButton
          variant="ghost-primary"
          size="sm-action"
          data-test="home-no-data-all-sources-link"
          @click="go('recommended')"
        >
          {{ t("home.noDataState.allSources") }}
        </OButton>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionCard from "@/lib/core/EmptyState/EmptyStateIngestionCard.vue";
import EmptyStateIngestionChip from "@/lib/core/EmptyState/EmptyStateIngestionChip.vue";
import { getImageURL } from "@/utils/zincutils";
import DOMPurify from "dompurify";

const props = defineProps<{
  /** The Home tab the onboarding block stands in for; unset keeps the flag-off Usage empty state. */
  tab?: "overview" | "usage";
  /** Under FirstDataPanel's card: only the cards and chips, under an "Or start another way" caption. */
  alternativesOnly?: boolean;
  /** The flag-off Overview, which names only what every edition's Overview shows. */
  flagOff?: boolean;
}>();

defineSlots<{
  /** A line between the description and the cards. */
  status?(): unknown;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const shell = computed(() => {
  if (props.alternativesOnly) return { size: "block" as const, backdrop: false };
  return { size: "hero" as const, illustration: props.tab ? "connect" : "wave-bars" } as const;
});
// an unset data-test would also erase OEmptyState's own id on the flag-off page
const rootTestAttrs = computed((): Record<string, string> => {
  if (!props.tab) return {};
  return {
    "data-test": props.alternativesOnly ? "home-first-data-alternatives" : "home-first-data-hero",
  };
});
// Cloud identifiers are random strings; a selection set from the URL carries no label, so the org list names it
const orgName = computed<string>(() => {
  const id: string = store.state.selectedOrganization?.identifier ?? "";
  return (
    store.state.selectedOrganization?.label ||
    (store.state.organizations ?? []).find(
      (o: { identifier?: string; name?: string }) => o?.identifier === id,
    )?.name ||
    id
  );
});
const tabDescription = computed(() => {
  const org = raw(orgName.value);
  if (props.tab === "usage") return t("home.noDataState.descriptionUsage", { org });
  if (props.flagOff) return t("home.noDataState.descriptionOverviewFlagOff", { org });
  return t("home.noDataState.descriptionOverview", { org });
});

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => DOMPurify.sanitize(t("home.noDataState.description")));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>
