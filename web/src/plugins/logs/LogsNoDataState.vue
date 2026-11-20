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
  LogsNoDataState — shown when the selected organization has no log streams yet.
  Each action routes to a distinct, real ingestion path in OpenObserve.
-->
<template>
  <OEmptyState v-bind="shell">
    <template v-if="!alternativesOnly" #text>
      <span v-html="description" />
    </template>

    <template v-if="!alternativesOnly" #actions>
      <div v-if="$slots.status" class="flex basis-full justify-center">
        <slot name="status" />
      </div>
      <OButton variant="primary" data-test="logs-no-data-curl-card" @click="go('curl')">
        {{ t("logs.noData.curl") }}
      </OButton>
      <OButton data-test="logs-no-data-otel-card" @click="go('ingestLogsFromOtel')">
        {{ raw("OpenTelemetry") }}
      </OButton>
    </template>

    <template #extra>
      <div
        :class="[
          'flex flex-wrap items-center gap-x-4 gap-y-1',
          alternativesOnly ? 'justify-start' : 'justify-center',
        ]"
      >
        <span class="text-text-secondary text-compact">{{ t("logs.noData.or") }}</span>
        <template v-if="alternativesOnly">
          <OButton variant="link" data-test="logs-no-data-curl-card" @click="go('curl')">
            {{ t("logs.noData.curl") }}
          </OButton>
          <OButton
            variant="link"
            data-test="logs-no-data-otel-card"
            @click="go('ingestLogsFromOtel')"
          >
            {{ raw("OpenTelemetry") }}
          </OButton>
        </template>
        <OButton variant="link" data-test="logs-no-data-shippers-card" @click="go('ingestLogs')">
          {{ t("logs.noData.shippers") }}
        </OButton>
        <OButton
          variant="link"
          data-test="logs-no-data-kubernetes-btn"
          @click="go('ingestFromKubernetes')"
        >
          {{ raw("Kubernetes") }}
        </OButton>
        <OButton variant="link" data-test="logs-no-data-aws-btn" @click="go('AWSConfig')">
          {{ t("logs.noData.aws") }}
        </OButton>
        <OButton variant="link" data-test="logs-no-data-linux-btn" @click="go('ingestFromLinux')">
          {{ raw("Linux") }}
        </OButton>
        <OButton
          variant="link"
          data-test="logs-no-data-windows-btn"
          @click="go('ingestFromWindows')"
        >
          {{ raw("Windows") }}
        </OButton>
        <OButton
          v-if="aiEnabled"
          variant="link"
          data-test="logs-no-data-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          {{ t("logs.noData.askAi") }}
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

defineSlots<{
  /** A line between the description and the cards. */
  status?(): unknown;
}>();

const emit = defineEmits<{
  "ask-ai": [];
}>();

const { t } = useI18nTyped();
const router = useRouter();
const store = useStore();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization.identifier,
}));

// Under FirstDataPanel the caption names the alternatives instead of the first-run title.
const shell = computed(() =>
  props.alternativesOnly
    ? { size: "compact" as const, title: t("ingestion.firstDataPanel.anotherWay") }
    : { icon: "link" as const, title: t("logs.noData.title", { product: raw("OpenObserve") }) },
);

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => t("logs.noData.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>
