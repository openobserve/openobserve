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
  <div class="flex min-h-0 flex-col">
    <OEmptyState
      v-if="state.status === 'forbidden'"
      preset="no-access"
      size="inline"
      :data-test="`${dataTest}-no-access`"
    />
    <OEmptyState
      v-else-if="state.status === 'error'"
      preset="load-error"
      size="inline"
      :description="errorText"
      :data-test="`${dataTest}-error`"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          icon-left="refresh"
          :data-test="`${dataTest}-retry-btn`"
          @click="emit('retry')"
          >{{ t("rum.analytics.retry") }}</OButton
        >
      </template>
    </OEmptyState>
    <div
      v-else-if="
        state.status === 'loading' || state.status === 'aborted' || state.status === 'idle'
      "
      class="flex flex-col gap-2 py-2"
      :data-test="`${dataTest}-loading`"
    >
      <OSkeleton v-for="n in skeletonRows" :key="n" type="text" class="h-6 w-full" />
    </div>
    <template v-else>
      <OBanner
        v-if="state.partial"
        variant="warning"
        dense
        class="mb-2"
        :content="t('rum.analytics.partial')"
        :data-test="`${dataTest}-partial`"
      />
      <slot />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { PanelState } from "@/composables/rum/useAnalyticsSearch";

const props = withDefaults(
  defineProps<{ state: PanelState<unknown>; dataTest: string; skeletonRows?: number }>(),
  { skeletonRows: 4 },
);
const emit = defineEmits<{ retry: [] }>();
const { t } = useI18nTyped();

const errorText = computed(() => {
  const e = props.state.error;
  if (!e) return undefined;
  return e.status
    ? t("rum.analytics.errorWithStatus", { status: e.status, message: raw(e.message) })
    : raw(e.message);
});
</script>
