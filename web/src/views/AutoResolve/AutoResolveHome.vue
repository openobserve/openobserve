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

<template>
  <OPageLayout
    :title="t('autoresolve.title')"
    icon="bolt"
    :subtitle="t('autoresolve.subtitle')"
    tabs-below
    :bleed="activeTab !== 'home'"
    :constrained="activeTab === 'home'"
    content-size="lg"
    data-test="autoresolve-home-page"
  >
    <template #title-trail>
      <BetaBadge stage="alpha" />
    </template>
    <template #header-tabs>
      <OTabs
        :model-value="activeTab"
        align="left"
        data-test="autoresolve-home-tabs"
        @change="onTabChange"
      >
        <OTab
          name="home"
          :label="t('autoresolve.tabs.home')"
          data-test="autoresolve-home-tab-home"
        />
        <OTab
          name="saved"
          :label="t('autoresolve.tabs.saved')"
          data-test="autoresolve-home-tab-saved"
        />
        <OTab
          name="runs"
          :label="t('autoresolve.tabs.runs')"
          data-test="autoresolve-home-tab-runs"
        />
      </OTabs>
    </template>

    <div v-if="activeTab === 'home'" class="flex flex-col gap-6 py-6">
      <div v-if="summaryForbidden" data-test="autoresolve-home-summary-forbidden">
        <OEmptyState preset="no-access" />
      </div>
      <div v-else-if="loadFailed" data-test="autoresolve-home-summary-error">
        <OEmptyState preset="load-error" :description="summaryError" @action="retry" />
      </div>
      <template v-else>
        <AutoResolveGoalBox
          v-model="goal"
          v-model:connection-ids="connectionIds"
          :connections="connections"
          :max-connections="maxConnections"
          :starting="startRun.isPending.value"
          :loading="summary.isPending.value || mcps.isPending.value"
          :error="startError"
          :can-add-mcps="mcps.data.value?.canCreate === true"
          @start="onStart"
          @edit="startError = null"
        />
        <template v-if="summary.isPending.value || mcps.isPending.value || connections.length">
          <section class="flex flex-col gap-2" data-test="autoresolve-home-examples">
            <h2 class="text-text-heading m-0 text-sm font-semibold">
              {{ t("autoresolve.home.examplesTitle") }}
            </h2>
            <div class="flex flex-wrap gap-2">
              <OButton
                v-for="example in examples"
                :key="example.id"
                variant="outline"
                size="sm"
                class="max-w-full"
                :data-test="`autoresolve-home-example-${example.id}`"
                @click="pickExample(example.label)"
              >
                <OTruncatedText class="min-w-0">{{ example.label }}</OTruncatedText>
              </OButton>
            </div>
          </section>
          <AutoResolveRunsTable :org="orgId" compact @view-all="onTabChange('runs')" />
        </template>
      </template>
    </div>

    <div v-else-if="activeTab === 'saved'" class="flex h-full min-h-0 flex-col">
      <AutoResolveSavedList :org="orgId" />
    </div>

    <div v-else class="flex h-full min-h-0 flex-col">
      <AutoResolveRunsTable :org="orgId" />
    </div>
  </OPageLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useMutation, useQuery } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import BetaBadge from "@/components/common/BetaBadge.vue";
import AutoResolveGoalBox from "@/components/autoresolve/AutoResolveGoalBox.vue";
import AutoResolveRunsTable from "@/components/autoresolve/AutoResolveRunsTable.vue";
import AutoResolveSavedList from "@/components/autoresolve/AutoResolveSavedList.vue";
import { useOrgId } from "@/composables/query/useOrgId";
import {
  autoresolveSummaryQuery,
  startAutoResolveRunMutation,
} from "@/services/autoresolve.queries";
import { mcpToolsetsQuery } from "@/services/ai_toolsets.queries";
import {
  autoresolveErrorMessage,
  autoresolveErrorStatus,
  DEFAULT_MAX_CONNECTIONS,
  isForbidden,
} from "@/services/autoresolve";
import productAnalytics from "@/services/product_analytics";

type HomeTab = "home" | "saved" | "runs";
const QUERY_TABS: readonly HomeTab[] = ["saved", "runs"];

const { t } = useI18nTyped();
const route = useRoute();
const router = useRouter();
const orgId = useOrgId();

const activeTab = computed<HomeTab>(
  () => QUERY_TABS.find((tab) => tab === route.query.tab) ?? "home",
);

const onTabChange = (name: string | number) => {
  if (name === activeTab.value) return;
  const { tab: _tab, ...rest } = route.query;
  const tab = QUERY_TABS.find((q) => q === name);
  void router.push({ query: tab ? { ...rest, tab } : rest });
};

const summary = useQuery(() =>
  Object.assign(autoresolveSummaryQuery(orgId.value), { enabled: !!orgId.value }),
);
// The server lists only the MCPs this person may read, the same set a run start accepts.
const mcps = useQuery(() =>
  Object.assign(mcpToolsetsQuery(orgId.value), { enabled: !!orgId.value }),
);
const connections = computed(() => mcps.data.value?.mcps ?? []);
const maxConnections = computed(
  () => summary.data.value?.max_connections || DEFAULT_MAX_CONNECTIONS,
);
const summaryForbidden = computed(() => isForbidden(summary.error.value));
const loadFailed = computed(() => summary.isError.value || mcps.isError.value);
const summaryError = computed(() => {
  const e: any = summary.error.value ?? mcps.error.value;
  return raw(e?.response?.data?.message ?? e?.message);
});
const retry = () => {
  if (summary.isError.value) void summary.refetch();
  if (mcps.isError.value) void mcps.refetch();
};

const examples = computed(() => [
  { id: "checkout", label: t("autoresolve.home.examples.checkout") },
  { id: "payment", label: t("autoresolve.home.examples.payment") },
  { id: "ingestion", label: t("autoresolve.home.examples.ingestion") },
]);

// Start again sends a person here with the goal of a run whose connections were all removed.
const goal = ref(typeof route.query.goal === "string" ? route.query.goal : "");
const connectionIds = ref<string[]>([]);
const startRun = useMutation(() => startAutoResolveRunMutation(orgId.value));
const startError = ref<I18nText | null>(null);

const pickExample = (label: string) => {
  goal.value = label;
  startError.value = null;
};

const onStart = (run: { goal: string; connectionIds: string[] }) => {
  startError.value = null;
  startRun.mutate(
    { goal: run.goal, connection_ids: run.connectionIds },
    {
      onSuccess: ({ run_id }) => {
        productAnalytics.track("autoresolve_run_started", { source: "home" });
        void router.push({
          name: "autoresolveRun",
          params: { id: run_id },
          query: { org_identifier: orgId.value },
        });
      },
      onError: (error: unknown) => {
        startError.value = raw(autoresolveErrorMessage(error)) || t("autoresolve.home.startFailed");
        // A refused choice may name a connection removed since the list was read.
        if (autoresolveErrorStatus(error) === 400) void mcps.refetch();
      },
    },
  );
};

onMounted(() => productAnalytics.track("autoresolve_opened"));
</script>
