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
import { raw, type I18nText } from "@/types/i18n";

const props = defineProps<{
  /** What links this field to another; omitted when the line only offers the action. */
  text?: I18nText | null;
  /** Omitted when there is nothing to do from here. */
  action?: I18nText | null;
  /** Joins text and action with a dot, for a phrase rather than a sentence. */
  separated?: boolean;
  /** A setting that does nothing as set: amber, since nothing failed. */
  warning?: boolean;
  dataTest: string;
}>();

const emit = defineEmits<{ (e: "action"): void }>();
const dot = raw("·");
</script>

<template>
  <p
    class="m-0 flex min-h-4 flex-wrap items-center gap-x-1 text-xs"
    :class="props.warning ? 'text-status-warning-text' : 'text-text-secondary'"
    :data-test="props.dataTest"
  >
    <span v-if="props.text" :data-test="`${props.dataTest}-text`">{{ props.text }}</span>
    <span v-if="props.text && props.separated" aria-hidden="true">{{ dot }}</span>
    <OButton
      v-if="props.action"
      variant="link"
      :data-test="`${props.dataTest}-action`"
      @click="emit('action')"
    >
      {{ props.action }}
    </OButton>
  </p>
</template>
