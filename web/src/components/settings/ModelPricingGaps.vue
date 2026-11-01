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

<!-- Pricing gaps: the models a stream's spans priced at nothing or only
     approximately over the last 24 h. Insights, cost cells and data-health links
     open it with `?stream=<name>`. -->
<template>
  <OPageLayout
    :back="{
      label: t('modelPricing.header'),
      onClick: goBack,
      dataTest: 'model-pricing-gaps-back-btn',
    }"
    :title="t('modelPricing.unpriced.title')"
    :subtitle="t('modelPricing.unpriced.subtitle')"
    bleed
  >
    <div class="bg-card-glass-bg min-h-0 flex-1 overflow-hidden">
      <UnpricedModelsTable
        :stream="stream"
        :models="models"
        :truncated-of="truncatedOf"
        :loading="unpricedQuery.isLoading.value"
        :fetching="unpricedQuery.isFetching.value"
        :error="unpricedQuery.isError.value"
        :loaded="unpricedQuery.isSuccess.value"
        :last-run-at="unpricedQuery.dataUpdatedAt.value"
        :streams="streams"
        :streams-loaded="streamsLoaded"
        @update:stream="onStreamChange"
        @refresh="refresh"
      />
    </div>
  </OPageLayout>
</template>

<script lang="ts" setup>
import { computed, onActivated, onBeforeMount, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18nTyped } from "@/types/i18n";
import { unpricedModelsQuery } from "@/services/model_pricing.queries";
import { useLlmTraceStreams } from "@/enterprise/composables/useLlmTraceStreams";
import { toast } from "@/lib/feedback/Toast/useToast";
import OPageLayout from "@/lib/core/PageLayout/OPageLayout.vue";
import UnpricedModelsTable from "@/components/settings/UnpricedModelsTable.vue";

const { t } = useI18nTyped();
const store = useStore();
const router = useRouter();

const orgIdentifier = computed(() => store.state.selectedOrganization?.identifier || "");

const WINDOW_US = 24 * 60 * 60 * 1_000_000;
const lastDayWindow = () => {
  const end = Date.now() * 1000;
  return { start: end - WINDOW_US, end };
};
const stream = ref("");
// Fixed when set, so the query key stays stable until a refresh moves it.
const timeWindow = ref(lastDayWindow());
const {
  availableStreams: streams,
  streamsLoaded,
  ensureStreamsLoaded,
  loadTraceStreams,
} = useLlmTraceStreams(stream, t);
// The kept-alive page outlives an org switch; the stream names belong to the old org.
watch(orgIdentifier, () => loadTraceStreams());

const unpricedQuery = useQuery(() =>
  Object.assign(
    unpricedModelsQuery(
      orgIdentifier.value,
      stream.value,
      timeWindow.value.start,
      timeWindow.value.end,
    ),
    { enabled: !!orgIdentifier.value && !!stream.value },
  ),
);
const models = computed(() => unpricedQuery.data.value?.models ?? []);
// The server lists the models with the most tokens; the banner names the full count then.
const truncatedOf = computed(() =>
  unpricedQuery.data.value?.models_truncated ? unpricedQuery.data.value.model_count : null,
);

function refresh() {
  timeWindow.value = lastDayWindow();
}

watch(unpricedQuery.error, (e: any) => {
  // 403s already raise the global no-access banner.
  if (!e || e.response?.status === 403) return;
  const msg = e.response?.data?.message || e.message || t("modelPricing.errUnknown");
  toast({
    variant: "error",
    message: t("toastMessages.settings.message", {
      prefix: t("modelPricing.unpriced.errLoad"),
      message: msg,
    }),
    timeout: 5000,
  });
});

/** Reads `?stream=` from a link or a reload. */
function applyRouteStream() {
  const s = router.currentRoute.value.query.stream;
  // Before the list loads, the loader keeps a valid name and clamps an unknown one.
  if (typeof s === "string" && s && (!streamsLoaded.value || streams.value.includes(s))) {
    stream.value = s;
  }
  // A link back into a kept-alive page should show the last 24 h from now; mount
  // and its first activation both land here, so only a stale window moves.
  if (Date.now() * 1000 - timeWindow.value.end > 60_000_000) refresh();
}

function onStreamChange(s: string) {
  stream.value = s;
  router.replace({ query: { ...router.currentRoute.value.query, stream: s } });
}

function goBack() {
  router.push({ name: "modelPricing", query: { org_identifier: orgIdentifier.value } });
}

onBeforeMount(() => {
  applyRouteStream();
  ensureStreamsLoaded();
});
onActivated(applyRouteStream);
</script>
