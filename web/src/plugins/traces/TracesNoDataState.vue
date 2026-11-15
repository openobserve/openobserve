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
  Each action routes to a distinct, real tracing ingestion path.
-->
<template>
  <OEmptyState v-bind="shell">
    <template v-if="!alternativesOnly" #text><span v-html="description" /></template>

    <template v-if="!alternativesOnly" #actions>
      <div v-if="$slots.status" class="flex basis-full justify-center">
        <slot name="status" />
      </div>
      <OButton variant="primary" data-test="traces-no-data-otlp-card" @click="go('tracesOTLP')">
        {{ t("traces.noData.otlp", { product: raw("OTLP") }) }}
      </OButton>
      <OButton data-test="traces-no-data-otel-card" @click="go('ingestTracesFromOtel')">
        {{ otelLabel }}
      </OButton>
    </template>

    <template #extra>
      <div
        :class="[
          'flex flex-wrap items-center gap-x-4 gap-y-1',
          alternativesOnly ? 'justify-start' : 'justify-center',
        ]"
      >
        <span class="text-text-secondary text-compact">{{ t("traces.noData.or") }}</span>
        <template v-if="alternativesOnly">
          <OButton variant="link" data-test="traces-no-data-otlp-card" @click="go('tracesOTLP')">
            {{ t("traces.noData.otlp", { product: raw("OTLP") }) }}
          </OButton>
          <OButton
            variant="link"
            data-test="traces-no-data-otel-card"
            @click="go('ingestTracesFromOtel')"
          >
            {{ otelLabel }}
          </OButton>
        </template>
        <OButton
          variant="link"
          data-test="traces-no-data-kubernetes-btn"
          @click="go('ingestFromKubernetes')"
        >
          {{ raw("Kubernetes") }}
        </OButton>
        <OButton variant="link" data-test="traces-no-data-python-btn" @click="go('python')">
          {{ raw("Python") }}
        </OButton>
        <OButton variant="link" data-test="traces-no-data-nodejs-btn" @click="go('nodejs')">
          {{ raw("Node.js") }}
        </OButton>
        <OButton
          v-if="aiEnabled"
          variant="link"
          data-test="traces-no-data-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          {{ t("traces.noData.askAi") }}
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
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";

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
const otelLabel = raw("OTel Collector / Agent");

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization?.identifier,
}));

// Under FirstDataPanel the caption names the alternatives instead of the first-run title.
const shell = computed(() =>
  props.alternativesOnly
    ? { size: "compact" as const, title: t("ingestion.firstDataPanel.anotherWay") }
    : {
        icon: "timeline" as const,
        title: t("traces.noData.title", { product: raw("OpenObserve") }),
      },
);

const description = computed(() => t("traces.noData.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>
