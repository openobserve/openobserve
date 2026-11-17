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

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped } from "@/types/i18n";
import type { FailedPillEmits, FailedPillProps } from "./OFailedPill.types";

withDefaults(defineProps<FailedPillProps>(), {
  marker: undefined,
  retry: true,
  dataTest: "failed-pill",
});

const emit = defineEmits<FailedPillEmits>();

const { t } = useI18nTyped();
</script>

<template>
  <span
    class="rounded-default border-status-error-text bg-status-error-bg text-status-error-text inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 border ps-2 text-xs"
    :class="!retry && 'pe-2'"
    :data-test="dataTest"
  >
    <!-- Focusable so the sentence in the tooltip is reachable from the keyboard. -->
    <span
      v-if="marker"
      tabindex="0"
      class="rounded-default focus-visible:outline-focus-ring-accent inline-flex min-w-0 items-center gap-1 whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
    >
      <!-- First child, so the tooltip binds to this focusable marker, not to its hidden text. -->
      <OTooltip :content="sentence" max-width="22.5rem" />
      <OIcon name="error-outline" size="xs" class="shrink-0" />
      <span aria-hidden="true">{{ marker }}</span>
      <span class="sr-only">{{ sentence }}</span>
    </span>
    <template v-else>
      <OIcon name="error-outline" size="xs" class="shrink-0" />
      <OTruncatedText class="min-w-0">{{ sentence }}</OTruncatedText>
    </template>
    <template v-if="retry">
      <span class="bg-status-error-text h-3 w-px shrink-0 opacity-40" aria-hidden="true" />
      <OButton
        variant="ghost-destructive"
        size="xs"
        icon-left="refresh"
        class="shrink-0"
        :data-test="`${dataTest}-retry`"
        @click="emit('retry', $event)"
      >
        {{ t("common.retry") }}
      </OButton>
    </template>
  </span>
</template>
