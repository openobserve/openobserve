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
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw, type I18nText } from "@/types/i18n";
import type { AlertLineNote } from "./alertFormContext";

const props = defineProps<{
  /** A field error as the form reports it; outranks the note and the help. */
  error?: string | null;
  errorDataTest?: string;
  /** Amber when it warns, neutral otherwise, with an optional fix. */
  note?: AlertLineNote | null;
  /** Neutral help held while nothing is wrong. */
  help?: I18nText | null;
  dataTest: string;
}>();
</script>

<!-- One fixed line, held from first paint, so a message appearing never moves the rows below. -->
<template>
  <div class="flex h-4 min-w-0 items-center gap-1 text-xs" :data-test="props.dataTest">
    <span
      v-if="props.error"
      class="text-input-error-text flex min-w-0"
      role="alert"
      :data-test="props.errorDataTest"
    >
      <OTruncatedText as="span">{{ raw(props.error) }}</OTruncatedText>
    </span>
    <span
      v-else-if="props.note"
      class="flex min-w-0 items-center gap-1"
      :class="props.note.warning ? 'text-status-warning-text' : 'text-text-secondary'"
      :data-test="props.note.dataTest"
    >
      <span class="flex min-w-0" :data-test="`${props.note.dataTest}-text`">
        <OTruncatedText as="span">{{ props.note.text }}</OTruncatedText>
      </span>
      <OButton
        v-if="props.note.action"
        variant="link"
        class="shrink-0"
        :data-test="`${props.note.dataTest}-action`"
        @click="props.note.run?.()"
      >
        {{ props.note.action }}
      </OButton>
    </span>
    <span v-else-if="props.help" class="text-text-secondary flex min-w-0">
      <OTruncatedText as="span">{{ props.help }}</OTruncatedText>
    </span>
  </div>
</template>
