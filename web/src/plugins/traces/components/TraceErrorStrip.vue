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
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { useI18nTyped } from "@/types/i18n";
import type { ErrorSpanSummary } from "../utils/traceErrorSummary";
import { useErrorSpanLabel } from "./useErrorSpanLabel";

const props = defineProps<{ errors: ErrorSpanSummary[] }>();
const emit = defineEmits<{ (e: "select", spanId: string): void }>();

const { t } = useI18nTyped();
const spanLabel = useErrorSpanLabel();

const deepest = computed(() => props.errors[0]);
const position = computed(() =>
  t("traces.errorStrip.position", { count: props.errors.length }, props.errors.length),
);
</script>

<template>
  <div
    v-if="deepest"
    class="bg-status-error-bg text-status-error-text border-border-default shrink-0 border-b px-4 py-1.5 text-xs"
  >
    <OButton
      variant="cell"
      data-test="trace-details-error-strip"
      @click="emit('select', deepest.spanId)"
    >
      <span class="flex min-w-0 items-center gap-2">
        <OIcon name="error" size="sm" class="shrink-0" />
        <OTruncatedText class="flex-1">
          <i18n-t
            :keypath="
              deepest.message ? 'traces.errorStrip.deepest' : 'traces.errorStrip.deepestNoMessage'
            "
            tag="span"
          >
            <template #span>
              <span class="text-text-heading font-semibold">{{ spanLabel(deepest) }}</span>
            </template>
            <template #message>{{ deepest.message }}</template>
            <template #position>{{ position }}</template>
          </i18n-t>
        </OTruncatedText>
      </span>
    </OButton>
  </div>
</template>
