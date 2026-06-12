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
  <OEmptyState illustration="wave-bars" size="hero" :hide-action="true">
    <template #title>{{ t("home.noDataState.title") }}</template>

    <template #description>
      <span v-html="description" />
    </template>

    <template #actions>
      <!-- Send Logs -->
      <EmptyStateIngestionCard
        icon="search"
        :label="t('home.noDataState.logs')"
        :sublabel="t('home.noDataState.logsDesc')"
        icon-variant="blue"
        data-test="home-no-data-logs-card"
        @click="go('curl')"
      />

      <!-- Send Traces -->
      <EmptyStateIngestionCard
        icon="account-tree"
        :label="t('home.noDataState.traces')"
        :sublabel="t('home.noDataState.tracesDesc')"
        icon-variant="purple"
        data-test="home-no-data-traces-card"
        @click="go('tracesOTLP')"
      />

      <!-- Send Metrics -->
      <EmptyStateIngestionCard
        icon="bar-chart"
        :label="t('home.noDataState.metrics')"
        :sublabel="t('home.noDataState.metricsDesc')"
        icon-variant="teal"
        data-test="home-no-data-metrics-card"
        @click="go('prometheus')"
      />
    </template>

    <template #extra>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <span class="tw:text-sm tw:font-semibold tw:text-text-secondary tw:mr-1">
          {{ t("home.noDataState.or") }}
        </span>
        <EmptyStateIngestionChip
          icon="hub"
          data-test="home-no-data-otel-btn"
          @click="go('ingestLogsFromOtel')"
        >{{ t("home.noDataState.otel") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          data-test="home-no-data-kubernetes-btn"
          @click="go('ingestFromKubernetes')"
        >
          <img :src="getImageURL('images/common/kubernetes.svg')" class="tw:w-3.5 tw:h-3.5 tw:shrink-0 tw:object-contain" alt="" />
          {{ t("home.noDataState.kubernetes") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          data-test="home-no-data-aws-btn"
          @click="go('AWSConfig')"
        >
          <img :src="getImageURL('images/ingestion/aws.svg')" class="tw:w-3.5 tw:h-3.5 tw:shrink-0 tw:object-contain" alt="" />
          {{ t("home.noDataState.aws") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          icon="insights"
          data-test="home-no-data-ai-btn"
          @click="go('ai-integrations')"
        >{{ t("home.noDataState.aiIntegrations") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          icon="alt-route"
          data-test="home-no-data-shippers-btn"
          @click="go('ingestLogs')"
        >{{ t("home.noDataState.shippers") }}</EmptyStateIngestionChip>
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionCard from "@/lib/core/EmptyState/EmptyStateIngestionCard.vue";
import EmptyStateIngestionChip from "@/lib/core/EmptyState/EmptyStateIngestionChip.vue";
import { getImageURL } from "@/utils/zincutils";

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => t("home.noDataState.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>
