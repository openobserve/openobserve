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
  LogsNoStreamState — shown when no stream has been selected yet.
  Displays two action cards (Select a stream / Read the query guide)
  and a recent-streams chip row loaded from localStorage.
-->
<template>
  <OEmptyState illustration="stream-select" size="hero" :hide-action="true">
    <template #title>{{ t("logs.noStream.title") }}</template>

    <template #description>
      <span v-html="description" />
    </template>

    <template #actions>
      <!-- Select a stream card -->
      <EmptyStateIngestionCard
        icon="storage"
        :label="t('logs.noStream.selectStream')"
        :sublabel="t('logs.noStream.selectStreamDesc')"
        data-test="logs-no-stream-select-stream-card"
        @click="emit('select-stream')"
      />

      <!-- Read the query guide card -->
      <EmptyStateIngestionCard
        icon="menu-book"
        :label="t('logs.noStream.queryGuide')"
        :sublabel="t('logs.noStream.queryGuideDesc')"
        data-test="logs-no-stream-query-guide-card"
        @click="openQueryGuide"
      />
    </template>

    <template v-if="recentStreams.length" #extra>
      <div class="flex items-center justify-center gap-2 flex-wrap">
        <span class="text-sm font-semibold text-text-secondary">
          {{ t("logs.noStream.recent") }}
        </span>
        <EmptyStateIngestionChip
          v-for="stream in recentStreams"
          :key="stream"
          icon="storage"
          :data-test="`logs-no-stream-recent-${stream}`"
          @click="emit('pick-stream', stream)"
          ><span class="truncate max-w-40">{{ stream }}</span></EmptyStateIngestionChip
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
import { restoreLogsStream } from "@/utils/streamPersist";

const props = defineProps<{
  /** Org identifier — used to look up recently used streams from localStorage. */
  orgId: string;
}>();

const emit = defineEmits<{
  "select-stream": [];
  "pick-stream": [stream: string];
}>();

const { t } = useI18n();

// Show up to 3 recently used streams (deduplicated, most recent first).
const recentStreams = computed<string[]>(() => {
  if (!props.orgId) return [];
  return restoreLogsStream(props.orgId).slice(0, 3);
});

// Uses v-html — content is fully i18n-controlled, no user input.
const description = computed(() => t("logs.noStream.description"));

const openQueryGuide = () => {
  window.open("https://openobserve.ai/docs/example-queries/", "_blank", "noopener,noreferrer");
};
</script>
