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
  <div v-if="assistantV2" class="flex h-full flex-col" data-test="autoobserve-home">
    <div class="flex shrink-0 flex-col gap-2 px-4 pt-3">
      <OText as="h1" variant="page-title" data-test="autoobserve-preview-header">{{
        t("autoobserve2.previewHeader")
      }}</OText>
      <OBanner variant="info" bar data-test="autoobserve-preview-strip">
        <span class="break-words">
          <strong>{{ t("autoobserve2.previewLabel") }}</strong>
          {{ t("autoobserve2.previewStrip") }}
        </span>
      </OBanner>
    </div>
    <div class="min-h-0 flex-1">
      <AutoObserveMock v-if="!live" />
      <AutoObserve v-else-if="view === 'nerd'" />
      <AutoObserve2 v-else />
    </div>
  </div>
  <div v-else class="h-full" data-test="autoobserve-home">
    <AutoObserveMock v-if="!live" />
    <AutoObserve v-else-if="view === 'nerd'" />
    <AutoObserve2 v-else />
    <BulkReviewDrawer />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, provide } from "vue";
import { onBeforeRouteUpdate } from "vue-router";
import BulkReviewDrawer from "@/components/autoobserve/insight/bulk/BulkReviewDrawer.vue";
import { ASK_AI_KEY, type InsightAskPayload } from "@/components/autoobserve/insight/insightCta";
import { keepLiveMode, useLiveMode } from "@/components/autoobserve/v2/autoobserveRoute";
import { useAutoObserveView } from "@/components/autoobserve/v2/useAutoObserveView";
import { isAssistantV2 } from "@/composables/assistant/flags";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped } from "@/types/i18n";

// Loaded on demand, so a visitor downloads the live pages or the sample pages, never both.
const AutoObserve = defineAsyncComponent(() => import("@/views/AutoObserve.vue"));
const AutoObserve2 = defineAsyncComponent(() => import("@/views/AutoObserve2.vue"));
// The sample pages read their data and their copy synchronously, so both are installed before they mount.
const AutoObserveMock = defineAsyncComponent(async () => {
  const [facts, locale] = await Promise.all([
    import("@/components/autoobserve/mock/data/facts"),
    import("@/components/autoobserve/mock/locale"),
  ]);
  locale.installMockLocale();
  await facts.factsReady;
  return import("@/components/autoobserve/mock/views/AutoObserveMockHome.vue");
});

// The route root carries MainLayout's chat binding, so every card below asks through this one emit.
const emit = defineEmits<{ sendToAiChat: [payload: InsightAskPayload] }>();
provide(ASK_AI_KEY, (payload: InsightAskPayload) => emit("sendToAiChat", payload));

const { view } = useAutoObserveView();
const live = useLiveMode();
onBeforeRouteUpdate(keepLiveMode);

const { t } = useI18nTyped();
const assistantV2 = isAssistantV2();
</script>
