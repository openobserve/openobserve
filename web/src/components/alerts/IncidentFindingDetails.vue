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
  <div class="flex flex-col gap-3" data-test="incident-finding-details">
    <div v-if="facts" class="space-y-2">
      <div class="flex flex-col gap-0.5">
        <span class="text-text-secondary text-3xs">
          {{ t("alerts.incidents.findingWhatHappened") }}
        </span>
        <span class="text-text-body text-sm font-medium" data-test="incident-finding-what">
          {{ facts.what }}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-0.5">
          <span class="text-text-secondary text-3xs">{{ t("alerts.streamType") }}</span>
          <OTag
            type="streamType"
            :value="facts.streamType"
            class="w-fit"
            data-test="incident-finding-stream-type"
          />
        </div>
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-text-secondary text-3xs">{{ t("alerts.stream_name") }}</span>
          <OTruncatedText
            class="text-text-body text-sm font-medium"
            data-test="incident-finding-stream-name"
          >
            {{ facts.streamName }}
          </OTruncatedText>
        </div>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-text-secondary text-3xs">{{ t("alerts.incidents.findingStarted") }}</span>
        <span class="text-text-body text-sm font-medium" data-test="incident-finding-started">
          {{ started }}
        </span>
      </div>
    </div>
    <p class="text-text-secondary text-xs" data-test="incident-finding-note">
      {{ facts ? t("alerts.incidents.findingNote") : t("alerts.incidents.findingNoteNoFacts") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatToReadable } from "@/utils/date";
import type { FindingFacts } from "@/utils/incidents/findingDimensions";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

const props = defineProps<{
  /** Null when the incident's dimensions cannot be read; only the note shows. */
  facts: FindingFacts | null;
}>();

const { t } = useI18nTyped();

const started = computed(() =>
  props.facts?.startedAt ? raw(formatToReadable(props.facts.startedAt)) : raw("—"),
);
</script>
