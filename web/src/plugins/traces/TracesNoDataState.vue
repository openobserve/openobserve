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
      <div class="flex flex-wrap items-center justify-center gap-2">
        <span class="text-text-secondary mr-1 text-sm font-semibold">
          {{ t("traces.noData.or") }}
        </span>
        <EmptyStateIngestionChip
          data-test="traces-no-data-kubernetes-btn"
          @click="go('ingestFromKubernetes')"
        >
          <img
            :src="getImageURL('images/common/kubernetes.svg')"
            class="h-3.5 w-3.5 shrink-0 object-contain"
            alt=""
          />
          {{ t("traces.noData.kubernetes") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip data-test="traces-no-data-python-btn" @click="go('python')">
          <img
            :src="getImageURL('images/ingestion/python.svg')"
            class="h-3.5 w-3.5 shrink-0 object-contain"
            alt=""
          />
          {{ t("traces.noData.python") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip data-test="traces-no-data-nodejs-btn" @click="go('nodejs')">
          <img
            :src="getImageURL('images/ingestion/nodejs.svg')"
            class="h-3.5 w-3.5 shrink-0 object-contain"
            alt=""
          />
          {{ t("traces.noData.nodejs") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          v-if="aiEnabled"
          class="ai-hover-btn"
          data-test="traces-no-data-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <img :src="aiIconSrc" class="h-3.5 w-3.5 shrink-0" alt="" />
          {{ t("traces.noData.askAi") }}
        </EmptyStateIngestionChip>
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
import { useAiIcon } from "@/composables/useAiIcon";
import { getImageURL } from "@/utils/zincutils";

defineProps<{ aiEnabled: boolean }>();
const emit = defineEmits<{ "ask-ai": [] }>();

const { t } = useI18n();
const router = useRouter();
const store = useStore();
const { aiIconSrc } = useAiIcon();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

const description = computed(() => t("traces.noData.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>
