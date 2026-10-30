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
  <OCard
    v-if="status !== 'hidden'"
    variant="outlined"
    class="p-4"
    role="region"
    :aria-label="panelLabel"
    :aria-busy="status === 'loading' || busy"
    :data-test="dataTest"
  >
    <span v-if="busy && status !== 'loading'" class="sr-only" :data-test="`${dataTest}-refreshing`">
      {{ t("rum.overviewPage.stateRefreshing", { panel: panelLabel }) }}
    </span>

    <div v-if="status === 'loading'" :data-test="`${dataTest}-loading`">
      <OSkeleton class="h-4 w-1/2" />
      <OSkeleton class="mt-3 h-8 w-1/3" />
      <OSkeleton class="mt-3 h-2 w-full" />
      <p class="text-text-secondary mt-3 text-sm">
        {{ t("rum.overviewPage.stateLoading", { panel: panelLabel }) }}
      </p>
    </div>

    <div v-else-if="status === 'error'" role="alert" :data-test="`${dataTest}-error`">
      <OEmptyState size="inline" preset="load-error">
        <template #title>{{
          t("rum.overviewPage.stateErrorTitle", { panel: panelLabel })
        }}</template>
        <template #description>{{ t("rum.overviewPage.stateErrorBody") }}</template>
        <template #actions>
          <OButton
            variant="outline"
            size="sm"
            icon-left="refresh"
            :data-test="`${dataTest}-retry`"
            @click="emit('retry')"
          >
            {{ t("rum.overviewPage.retry") }}
          </OButton>
        </template>
      </OEmptyState>
    </div>

    <OEmptyState
      v-else-if="status === 'forbidden'"
      size="inline"
      preset="no-access"
      :data-test="`${dataTest}-forbidden`"
    >
      <template #title>{{ t("rum.overviewPage.forbiddenTitle", { panel: panelLabel }) }}</template>
      <template #description>{{ t("rum.overviewPage.forbiddenBody") }}</template>
    </OEmptyState>

    <OEmptyState
      v-else-if="status === 'empty'"
      size="compact"
      :hide-action="true"
      :data-test="`${dataTest}-empty`"
    >
      <template #title>{{ emptyTitle ?? t("rum.overviewPage.stateEmptyTitle") }}</template>
      <template #description>{{ emptyBody ?? t("rum.overviewPage.stateEmptyBody") }}</template>
    </OEmptyState>

    <template v-else>
      <div v-if="status === 'low'" class="mb-3">
        <OBanner variant="info" :data-test="`${dataTest}-low-data`">
          <p class="font-bold">
            {{ t("rum.overviewPage.stateLowTitle", { count: formatCount(lowCount) }, lowCount) }}
          </p>
          <p>{{ t("rum.overviewPage.stateLowBody", { min: MIN_VIEWS }) }}</p>
        </OBanner>
      </div>
      <div
        class="transition-opacity"
        :class="busy ? 'opacity-60' : ''"
        :data-test="`${dataTest}-content`"
      >
        <slot />
      </div>
    </template>
  </OCard>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { WidgetStatus } from "@/composables/rum/useRumOverviewData";
import { MIN_VIEWS, formatCount } from "@/utils/rum/performanceOverview";

withDefaults(
  defineProps<{
    status: WidgetStatus;
    panelLabel: I18nText;
    dataTest: string;
    lowCount?: number;
    emptyTitle?: I18nText;
    emptyBody?: I18nText;
    busy?: boolean;
  }>(),
  { lowCount: 0, emptyTitle: undefined, emptyBody: undefined, busy: false },
);
const emit = defineEmits<{ (e: "retry"): void }>();
const { t } = useI18nTyped();
</script>
