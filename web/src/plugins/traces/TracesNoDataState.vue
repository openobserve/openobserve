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
  TracesNoDataState — shown when no trace streams exist in the org yet.
  Each card routes to a distinct, real tracing ingestion path.
-->
<template>
  <OEmptyState illustration="trace" size="hero" :hide-action="true">
    <template #title>{{ t("traces.noData.title") }}</template>
    <template #description><span v-html="description" /></template>

    <template #actions>
      <!-- OpenTelemetry OTLP — primary path for traces -->
      <EmptyStateIngestionCard
        icon="account-tree"
        :label="t('traces.noData.otlp')"
        :sublabel="t('traces.noData.otlpDesc')"
        icon-variant="purple"
        data-test="traces-no-data-otlp-card"
        @click="go('tracesOTLP')"
      />

      <!-- OTel Collector / agent -->
      <EmptyStateIngestionCard
        icon="hub"
        :label="t('traces.noData.otelCollector')"
        :sublabel="t('traces.noData.otelCollectorDesc')"
        icon-variant="blue"
        data-test="traces-no-data-otel-card"
        @click="go('ingestTracesFromOtel')"
      />
    </template>

    <template #extra>
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <span class="tw:text-sm tw:font-semibold tw:text-text-secondary tw:mr-1">
          {{ t("traces.noData.or") }}
        </span>
        <EmptyStateIngestionChip
          icon="layers"
          data-test="traces-no-data-kubernetes-btn"
          @click="go('ingestFromKubernetes')"
        >{{ t("traces.noData.kubernetes") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          icon="code"
          data-test="traces-no-data-python-btn"
          @click="go('python')"
        >{{ t("traces.noData.python") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          icon="code"
          data-test="traces-no-data-java-btn"
          @click="go('java')"
        >{{ t("traces.noData.java") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          icon="code"
          data-test="traces-no-data-nodejs-btn"
          @click="go('nodejs')"
        >{{ t("traces.noData.nodejs") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          v-if="aiEnabled"
          icon="bolt"
          data-test="traces-no-data-ask-ai-btn"
          @click="emit('ask-ai')"
        >{{ t("traces.noData.askAi") }}</EmptyStateIngestionChip>
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

const props = defineProps<{ aiEnabled: boolean }>();
const emit = defineEmits<{ "ask-ai": [] }>();

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

const description = computed(() => t("traces.noData.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>
