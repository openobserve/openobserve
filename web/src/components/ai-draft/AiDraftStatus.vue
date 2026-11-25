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

<!-- A draft's progress: done steps ticked, the running one with the region's only spinner. -->
<template>
  <ul
    class="m-0 flex list-none flex-col gap-1.5 p-0"
    role="status"
    aria-live="polite"
    data-test="ai-draft-status"
  >
    <li
      v-if="earlier > 0"
      class="text-text-secondary ps-6 text-xs"
      data-test="ai-draft-status-earlier"
    >
      {{ t("aiDraft.earlierSteps", { count: earlier }, earlier) }}
    </li>
    <li
      v-for="(line, i) in shown"
      :key="earlier + i"
      class="flex min-w-0 items-center gap-2 text-sm"
      :class="i === shown.length - 1 ? 'text-text-body' : 'text-text-secondary'"
      data-test="ai-draft-status-line"
    >
      <OSpinner v-if="i === shown.length - 1" size="xs" class="shrink-0" />
      <OIcon v-else name="check" size="xs" class="text-status-positive shrink-0" />
      <OTruncatedText class="min-w-0">{{ line }}</OTruncatedText>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSpinner from "@/lib/feedback/Spinner/OSpinner.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const MAX_LINES = 4;

const props = defineProps<{ lines: I18nText[] }>();

const { t } = useI18nTyped();

// Before the first event there is still one honest line to show.
const all = computed<I18nText[]>(() =>
  props.lines.length ? props.lines : [t("aiDraft.drafting")],
);
const earlier = computed(() => Math.max(0, all.value.length - MAX_LINES));
const shown = computed(() => all.value.slice(earlier.value));
</script>
