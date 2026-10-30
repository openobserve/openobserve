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
  <div
    class="flex w-full max-w-xl flex-col gap-2 text-start"
    data-test="rum-analytics-funnel-quick-starts"
  >
    <span
      v-if="entriesLoading || entries.length || entriesFailed"
      class="text-text-heading text-sm font-semibold"
      >{{ t("rum.analytics.funnel.startFromEntry") }}</span
    >
    <OSkeleton v-if="entriesLoading" type="text" class="h-8 w-full" />
    <span
      v-else-if="entriesFailed"
      class="text-text-secondary flex items-center gap-2 text-xs"
      data-test="rum-analytics-funnel-entries-failed"
      >{{ t("rum.analytics.funnel.entriesFailed") }}
      <OButton
        variant="ghost"
        size="sm"
        data-test="rum-analytics-funnel-entries-retry-btn"
        @click="emit('retry')"
        >{{ t("common.retry") }}</OButton
      ></span
    >
    <OButton
      v-for="(e, i) in entries"
      :key="e.key"
      variant="outline"
      size="md"
      class="justify-start"
      :data-test="`rum-analytics-funnel-entry-start-${i}`"
      @click="emit('start', [{ kind: 'p', key: e.key }])"
    >
      <span class="flex min-w-0 items-center gap-2">
        <OTag :label="t('rum.analytics.kind.page')" variant="blue-soft" size="xs" />
        <span class="truncate font-mono text-xs">{{ e.key }}</span>
        <span class="text-text-secondary text-xs">{{
          t(
            "rum.analytics.funnel.entrySessions",
            { count: addCommasToNumber(e.sessions) },
            e.sessions,
          )
        }}</span>
      </span>
    </OButton>
    <template v-if="recent.length">
      <span class="text-text-heading mt-2 flex items-center gap-1 text-sm font-semibold"
        ><OIcon name="history" size="sm" />{{ t("rum.analytics.funnel.recent") }}</span
      >
      <OButton
        v-for="(r, i) in recent"
        :key="i"
        variant="ghost"
        size="sm"
        class="justify-start"
        :data-test="`rum-analytics-funnel-recent-${i}`"
        @click="emit('open', r)"
      >
        <KeySequence :keys="r.steps" :events="events" />
      </OButton>
    </template>
    <span class="mt-2 w-72 max-md:w-full">
      <StepPicker
        :model-value="null"
        :placeholder="t('rum.analytics.funnel.pickFirst')"
        :events="events"
        data-test="rum-analytics-funnel-first-step-select"
        @update:model-value="(s) => s && emit('start', [s])"
      />
    </span>
  </div>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import KeySequence from "@/components/rum/productAnalytics/KeySequence.vue";
import StepPicker from "@/components/rum/productAnalytics/StepPicker.vue";
import type { FunnelEntry } from "@/composables/rum/useFunnelQuickStarts";
import { useI18nTyped } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef, StepRef } from "@/utils/rum/productAnalyticsQueries";

withDefaults(
  defineProps<{
    entries: readonly FunnelEntry[];
    entriesLoading: boolean;
    entriesFailed?: boolean;
    recent: readonly FunnelDef[];
    events: NamedEvent[];
  }>(),
  { entriesFailed: false },
);
const emit = defineEmits<{ start: [StepRef[]]; open: [FunnelDef]; retry: [] }>();
const { t } = useI18nTyped();
</script>
