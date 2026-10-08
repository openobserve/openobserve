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
      <div class="flex flex-wrap items-center justify-center gap-2">
        <span class="text-text-secondary text-sm font-semibold">
          {{ t("logs.noStream.recent") }}
        </span>
        <EmptyStateIngestionChip
          v-for="stream in recentStreams"
          :key="stream"
          icon="storage"
          :data-test="`logs-no-stream-recent-${stream}`"
          @click="emit('pick-stream', stream)"
          ><OTruncatedText class="max-w-40">{{ stream }}</OTruncatedText></EmptyStateIngestionChip
        >
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import EmptyStateIngestionCard from "@/lib/core/EmptyState/EmptyStateIngestionCard.vue";
import EmptyStateIngestionChip from "@/lib/core/EmptyState/EmptyStateIngestionChip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { restoreLogsSelectedStreams } from "@/utils/streamPersist";
import DOMPurify from "dompurify";

const props = withDefaults(
  defineProps<{
    /** Org identifier — used to look up recently used streams from localStorage. */
    orgId: string;
    streamType?: string;
    /** Auto Run is on: picking a stream runs it, so the copy drops "press Run query". */
    autoRun?: boolean;
  }>(),
  { streamType: "logs", autoRun: false },
);

const emit = defineEmits<{
  "select-stream": [];
  "pick-stream": [stream: string];
}>();

const { t } = useI18nTyped();

// The last selection set for this org and stream type, up to 3 names.
const recentStreams = computed<string[]>(() => {
  if (!props.orgId) return [];
  return restoreLogsSelectedStreams(props.orgId, props.streamType).slice(0, 3);
});

// Uses v-html — content is fully i18n-controlled, no user input.
const description = computed(() =>
  DOMPurify.sanitize(
    t(props.autoRun ? "logs.noStream.descriptionAutoRun" : "logs.noStream.description"),
  ),
);

const openQueryGuide = () => {
  window.open("https://openobserve.ai/docs/example-queries/", "_blank", "noopener,noreferrer");
};
</script>
