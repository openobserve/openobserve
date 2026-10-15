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
  <OEmptyState v-bind="shell" :hide-action="true">
    <template #title>
      <span
        v-if="alternativesOnly"
        class="text-text-secondary text-sm font-normal"
        data-test="traces-no-data-another-way"
        >{{ t("ingestion.firstDataPanel.anotherWay") }}</span
      >
      <template v-else>{{ t("traces.noData.title", { product: raw("OpenObserve") }) }}</template>
    </template>
    <template v-if="!alternativesOnly" #description><span v-html="description" /></template>

    <template #actions>
      <div v-if="$slots.status" class="flex basis-full justify-center">
        <slot name="status" />
      </div>

      <!-- OpenTelemetry OTLP — primary path for traces -->
      <EmptyStateIngestionCard
        icon="account-tree"
        :label="t('traces.noData.otlp', { product: raw('OTLP') })"
        :sublabel="
          t('traces.noData.otlpDesc', {
            product1: raw('Jaeger'),
            product2: raw('Zipkin'),
            product3: raw('OpenTelemetry'),
          })
        "
        icon-variant="purple"
        data-test="traces-no-data-otlp-card"
        @click="go('tracesOTLP')"
      />

      <!-- OTel Collector / agent -->
      <EmptyStateIngestionCard
        :image="getImageURL('images/ingestion/otlp.svg')"
        :label="raw('OTel Collector / Agent')"
        :sublabel="t('traces.noData.otelCollectorDesc', { product: raw('OTel Collector') })"
        icon-variant="blue"
        data-test="traces-no-data-otel-card"
        @click="go('ingestTracesFromOtel')"
      />
    </template>

    <template #extra>
      <div class="flex flex-wrap items-center justify-center gap-2">
        <span class="text-text-secondary me-1 text-sm font-semibold">
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
          {{ raw("Kubernetes") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip data-test="traces-no-data-python-btn" @click="go('python')">
          <img
            :src="getImageURL('images/ingestion/python.svg')"
            class="h-3.5 w-3.5 shrink-0 object-contain"
            alt=""
          />
          {{ raw("Python") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip data-test="traces-no-data-nodejs-btn" @click="go('nodejs')">
          <img
            :src="getImageURL('images/ingestion/nodejs.svg')"
            class="h-3.5 w-3.5 shrink-0 object-contain"
            alt=""
          />
          {{ raw("Node.js") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          v-if="aiEnabled"
          variant="ai"
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
import { raw, useI18nTyped } from "@/types/i18n";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionCard from "@/lib/core/EmptyState/EmptyStateIngestionCard.vue";
import EmptyStateIngestionChip from "@/lib/core/EmptyState/EmptyStateIngestionChip.vue";
import { useAiIcon } from "@/composables/useAiIcon";
import { getImageURL } from "@/utils/zincutils";

const props = defineProps<{
  aiEnabled: boolean;
  /** Under FirstDataPanel's card: only the cards and chips, under an "Or start another way" caption. */
  alternativesOnly?: boolean;
}>();
const emit = defineEmits<{ "ask-ai": [] }>();

defineSlots<{
  /** A line between the description and the cards. */
  status?(): unknown;
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();
const { aiIconSrc } = useAiIcon();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

// v-bind keeps the hero's own defaults untouched; the caption form drops the illustration and backdrop.
const shell = computed(() =>
  props.alternativesOnly
    ? { size: "block" as const, backdrop: false }
    : { size: "hero" as const, illustration: "trace" as const },
);

const description = computed(() => t("traces.noData.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>
