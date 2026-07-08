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
  Each card routes to a distinct, real ingestion path in OpenObserve.
-->
<template>
  <OEmptyState illustration="connect" size="hero" :hide-action="true">
    <template #title>{{ t("logs.noData.title") }}</template>

    <template #description>
      <span v-html="description" />
    </template>

    <template #actions>
      <!-- Curl / HTTP API — simplest quick-start -->
      <EmptyStateIngestionCard
        icon="code"
        :label="t('logs.noData.curl')"
        :sublabel="t('logs.noData.curlDesc')"
        data-test="logs-no-data-curl-card"
        @click="go('curl')"
      />

      <!-- Log shippers — Filebeat, Fluentbit, Fluentd, Vector, SyslogNg -->
      <EmptyStateIngestionCard
        icon="alt-route"
        :label="t('logs.noData.shippers')"
        :sublabel="t('logs.noData.shippersDesc')"
        icon-variant="teal"
        data-test="logs-no-data-shippers-card"
        @click="go('ingestLogs')"
      />

      <!-- OpenTelemetry -->
      <EmptyStateIngestionCard
        icon="hub"
        :label="t('logs.noData.otel')"
        :sublabel="t('logs.noData.otelDesc')"
        icon-variant="amber"
        data-test="logs-no-data-otel-card"
        @click="go('ingestLogsFromOtel')"
      />
    </template>

    <template #extra>
      <div class="flex items-center justify-center gap-2 flex-wrap">
        <span class="text-sm font-semibold text-text-secondary mr-1">
          {{ t("logs.noData.or") }}
        </span>
        <EmptyStateIngestionChip
          data-test="logs-no-data-kubernetes-btn"
          @click="go('ingestFromKubernetes')"
        >
          <img :src="getImageURL('images/common/kubernetes.svg')" class="w-3.5 h-3.5 shrink-0 object-contain" alt="" />
          {{ t("logs.noData.kubernetes") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          data-test="logs-no-data-aws-btn"
          @click="go('AWSConfig')"
        >
          <img :src="getImageURL('images/ingestion/aws.svg')" class="w-3.5 h-3.5 shrink-0 object-contain" alt="" />
          {{ t("logs.noData.aws") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          data-test="logs-no-data-linux-btn"
          @click="go('ingestFromLinux')"
        >
          <img :src="getImageURL('images/common/linux.svg')" class="w-3.5 h-3.5 shrink-0 object-contain" alt="" />
          {{ t("logs.noData.linux") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          data-test="logs-no-data-windows-btn"
          @click="go('ingestFromWindows')"
        >
          <img :src="getImageURL('images/common/windows.svg')" class="w-3.5 h-3.5 shrink-0 object-contain" alt="" />
          {{ t("logs.noData.windows") }}
        </EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          v-if="aiEnabled"
          class="ai-hover-btn"
          data-test="logs-no-data-ask-ai-btn"
          @click="emit('ask-ai')"
        >
          <img :src="aiIconSrc" class="w-3.5 h-3.5 shrink-0" alt="" />
          {{ t("logs.noData.askAi") }}
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

const props = defineProps<{
  aiEnabled: boolean;
}>();

const emit = defineEmits<{
  "ask-ai": [];
}>();

const { t } = useI18n();
const router = useRouter();
const store = useStore();
const { aiIconSrc } = useAiIcon();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization.identifier,
}));

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => t("logs.noData.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>
