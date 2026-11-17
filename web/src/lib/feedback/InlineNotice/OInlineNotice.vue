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
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { InlineNoticeEmits, InlineNoticeProps } from "./OInlineNotice.types";

const props = withDefaults(defineProps<InlineNoticeProps>(), {
  variant: "warning",
  actionLabel: undefined,
  dataTest: "inline-notice",
  actionDataTest: undefined,
});

const emit = defineEmits<InlineNoticeEmits>();

const isError = computed(() => props.variant === "error");
</script>

<template>
  <span
    :role="isError ? 'alert' : 'status'"
    :class="[
      'rounded-default inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 px-2 text-xs',
      isError
        ? 'bg-status-error-bg text-status-error-text'
        : 'bg-status-warning-bg text-status-warning-text',
    ]"
    :data-test="dataTest"
    :data-variant="variant"
  >
    <OIcon
      :name="isError ? 'error-outline' : 'warning-amber'"
      size="xs"
      class="shrink-0"
      aria-hidden="true"
    />
    <OTruncatedText class="min-w-0">{{ text }}</OTruncatedText>
    <button
      v-if="actionLabel"
      type="button"
      class="focus-visible:outline-focus-ring-accent rounded-default shrink-0 cursor-pointer font-medium whitespace-nowrap underline underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
      :data-test="actionDataTest"
      @click="emit('action', $event)"
    >
      {{ actionLabel }}
    </button>
  </span>
</template>
