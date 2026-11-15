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
  <OEmptyState icon="dataset" :title="t('traces.noStream.title')">
    <template #text>
      <span v-html="description" />
    </template>

    <template #actions>
      <OButton
        variant="primary"
        data-test="traces-no-stream-select-stream-card"
        @click="emit('select-stream')"
      >
        {{ t("traces.noStream.selectStream") }}
      </OButton>
      <OButton
        icon-end="open-in-new"
        data-test="traces-no-stream-query-guide-card"
        @click="openGuide"
      >
        {{ t("traces.noStream.queryGuide") }}
      </OButton>
    </template>

    <template v-if="recentStream" #extra>
      <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <span class="text-text-secondary text-compact">{{ t("traces.noStream.recent") }}</span>
        <OButton
          variant="link"
          :data-test="`traces-no-stream-recent-${recentStream}`"
          @click="emit('pick-stream', recentStream)"
          ><OTruncatedText class="max-w-40">{{ recentStream }}</OTruncatedText></OButton
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
import { restoreTracesStream } from "@/utils/streamPersist";
import DOMPurify from "dompurify";

const props = defineProps<{
  orgId: string;
}>();

const emit = defineEmits<{
  "select-stream": [];
  "pick-stream": [stream: string];
}>();

const { t } = useI18nTyped();

const recentStream = computed<string>(() => {
  if (!props.orgId) return "";
  return restoreTracesStream(props.orgId);
});

// Uses v-html — fully i18n-controlled, no user input.
const description = computed(() => DOMPurify.sanitize(t("traces.noStream.description")));

const openGuide = () => {
  window.open(
    "https://openobserve.ai/docs/features/distributed-tracing/#overview",
    "_blank",
    "noopener,noreferrer",
  );
};
</script>
