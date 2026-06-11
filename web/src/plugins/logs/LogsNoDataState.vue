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
  <OEmptyState illustration="hourglass" size="hero" :hide-action="true">
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
      <div class="tw:flex tw:items-center tw:justify-center tw:gap-2 tw:flex-wrap">
        <span class="tw:text-sm tw:font-semibold tw:text-text-secondary tw:mr-1">
          {{ t("logs.noData.or") }}
        </span>
        <EmptyStateIngestionChip
          icon="layers"
          data-test="logs-no-data-kubernetes-btn"
          @click="go('ingestFromKubernetes')"
        >{{ t("logs.noData.kubernetes") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          icon="cloud"
          data-test="logs-no-data-aws-btn"
          @click="go('AWSConfig')"
        >{{ t("logs.noData.aws") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          icon="dns"
          data-test="logs-no-data-linux-btn"
          @click="go('ingestFromLinux')"
        >{{ t("logs.noData.linux") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          icon="monitor"
          data-test="logs-no-data-windows-btn"
          @click="go('ingestFromWindows')"
        >{{ t("logs.noData.windows") }}</EmptyStateIngestionChip>
        <EmptyStateIngestionChip
          v-if="aiEnabled"
          icon="bolt"
          data-test="logs-no-data-ask-ai-btn"
          @click="emit('ask-ai')"
        >{{ t("logs.noData.askAi") }}</EmptyStateIngestionChip>
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

const props = defineProps<{
  aiEnabled: boolean;
}>();

const emit = defineEmits<{
  "ask-ai": [];
}>();

const { t } = useI18n();
const router = useRouter();
const store = useStore();

const orgQuery = computed(() => ({
  org_identifier: store.state.selectedOrganization.identifier,
}));

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => t("logs.noData.description"));

const go = (routeName: string) => {
  router.push({ name: routeName, query: orgQuery.value });
};
</script>
