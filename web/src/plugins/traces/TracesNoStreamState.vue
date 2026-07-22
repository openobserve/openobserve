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
  TracesNoStreamState — shown when no trace stream has been selected yet.
  Mirrors the LogsNoStreamState pattern: stream-select illustration, two action
  cards, and a recent-stream chip loaded from localStorage.
-->
<template>
  <OEmptyState illustration="stream-select" size="hero" :hide-action="true">
    <template #title>{{ t("traces.noStream.title") }}</template>

    <template #description>
      <span v-html="description" />
    </template>

    <template #actions>
      <!-- Select a stream -->
      <EmptyStateIngestionCard
        icon="account-tree"
        :label="t('traces.noStream.selectStream')"
        :sublabel="t('traces.noStream.selectStreamDesc')"
        data-test="traces-no-stream-select-stream-card"
        @click="emit('select-stream')"
      />

      <!-- Read the query guide -->
      <EmptyStateIngestionCard
        icon="menu-book"
        :label="t('traces.noStream.queryGuide')"
        :sublabel="t('traces.noStream.queryGuideDesc')"
        icon-variant="teal"
        data-test="traces-no-stream-query-guide-card"
        @click="openGuide"
      />
    </template>

    <template v-if="recentStream" #extra>
      <div class="flex items-center justify-center gap-2 flex-wrap">
        <span class="text-sm font-semibold text-text-secondary mr-1">
          {{ t("traces.noStream.recent") }}
        </span>
        <EmptyStateIngestionChip
          icon="account-tree"
          :data-test="`traces-no-stream-recent-${recentStream}`"
          @click="emit('pick-stream', recentStream)"
          ><span class="truncate max-w-40">{{ recentStream }}</span></EmptyStateIngestionChip
        >
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionCard from "@/lib/core/EmptyState/EmptyStateIngestionCard.vue";
import EmptyStateIngestionChip from "@/lib/core/EmptyState/EmptyStateIngestionChip.vue";
import { restoreTracesStream } from "@/utils/streamPersist";

const props = defineProps<{
  orgId: string;
}>();

const emit = defineEmits<{
  "select-stream": [];
  "pick-stream": [stream: string];
}>();

const { t } = useI18n();

const recentStream = computed<string>(() => {
  if (!props.orgId) return "";
  return restoreTracesStream(props.orgId);
});

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => t("traces.noStream.description"));

const openGuide = () => {
  window.open(
    "https://openobserve.ai/docs/features/distributed-tracing/#overview",
    "_blank",
    "noopener,noreferrer",
  );
};
</script>
