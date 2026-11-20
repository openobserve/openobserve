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
  <OEmptyState icon="dataset" :title="t('logs.noStream.title')">
    <template #text>
      <span v-html="description" />
    </template>

    <template #actions>
      <OButton
        variant="primary"
        data-test="logs-no-stream-select-stream-card"
        @click="emit('select-stream')"
      >
        {{ t("logs.noStream.selectStream") }}
      </OButton>
      <OButton
        icon-end="open-in-new"
        data-test="logs-no-stream-query-guide-card"
        @click="openQueryGuide"
      >
        {{ t("logs.noStream.queryGuide") }}
      </OButton>
    </template>

    <template v-if="recentStreams.length" #extra>
      <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span class="text-text-secondary text-compact">{{ t("logs.noStream.recent") }}</span>
        <OButton
          v-for="stream in recentStreams"
          :key="stream"
          variant="link"
          :data-test="`logs-no-stream-recent-${stream}`"
          @click="emit('pick-stream', stream)"
          ><OTruncatedText class="max-w-40">{{ stream }}</OTruncatedText></OButton
        >
      </div>
    </template>
  </OEmptyState>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { restoreLogsSelectedStreams } from "@/utils/streamPersist";
import DOMPurify from "dompurify";

const props = withDefaults(
  defineProps<{
    orgId: string;
    streamType?: string;
  }>(),
  { streamType: "logs" },
);

const emit = defineEmits<{
  "select-stream": [];
  "pick-stream": [stream: string];
}>();

const { t } = useI18nTyped();

const recentStreams = computed<string[]>(() => {
  if (!props.orgId) return [];
  return restoreLogsSelectedStreams(props.orgId, props.streamType).slice(0, 3);
});

// Picking a stream runs it, so the copy never sends the user to Run query.
const description = computed(() => DOMPurify.sanitize(t("logs.noStream.descriptionAutoRun")));

const openQueryGuide = () => {
  window.open("https://openobserve.ai/docs/example-queries/", "_blank", "noopener,noreferrer");
};
</script>
