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
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { FilterTokenEmits, FilterTokenPart, FilterTokenProps } from "./OFilterToken.types";

const props = withDefaults(defineProps<FilterTokenProps>(), {
  operator: undefined,
  value: undefined,
  activePart: null,
  armed: false,
  editable: true,
  removable: false,
  removeLabel: undefined,
  dataTest: undefined,
});
const emit = defineEmits<FilterTokenEmits>();

const { t } = useI18nTyped();

const testId = (suffix: string) => (props.dataTest ? `${props.dataTest}-${suffix}` : undefined);

const SEGMENT =
  "inline-flex min-w-0 items-center px-2 py-1 whitespace-nowrap outline-none transition-[filter] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring-accent";

const TONES: Record<FilterTokenPart, string> = {
  field: "bg-badge-default-soft-bg text-badge-default-soft-text font-medium",
  operator: "bg-input-bg text-text-secondary",
  value: "bg-badge-primary-soft-bg text-badge-primary-soft-text font-medium",
};

const lastPart = computed<FilterTokenPart>(() => {
  if (props.value !== undefined) return "value";
  return props.operator !== undefined ? "operator" : "field";
});

const parts = computed<FilterTokenPart[]>(() => {
  const list: FilterTokenPart[] = ["field"];
  if (props.operator !== undefined) list.push("operator");
  if (props.value !== undefined) list.push("value");
  return list;
});

const labels = computed<Record<FilterTokenPart, I18nText | undefined>>(() => ({
  field: props.field,
  operator: props.operator,
  value: props.value,
}));

const segmentClass = (part: FilterTokenPart) => [
  SEGMENT,
  part === lastPart.value && props.removable ? "pe-1" : TONES[part],
  props.editable ? "cursor-pointer hover:brightness-95 dark:hover:brightness-125" : "",
  props.activePart === part ? "ring-focus-ring-accent ring-2 ring-inset" : "",
];

function onSelect(part: FilterTokenPart, event: MouseEvent) {
  if (props.editable) emit("select", part, event.currentTarget as HTMLElement);
}
</script>

<template>
  <span
    class="rounded-default border-badge-default-ol-border divide-badge-default-ol-border inline-flex max-w-full min-w-0 items-stretch divide-x overflow-hidden border text-xs leading-4"
    :class="armed ? 'ring-focus-ring-accent ring-2' : ''"
    :data-test="dataTest"
  >
    <template v-for="part in parts" :key="part">
      <span
        v-if="part === lastPart && removable"
        class="inline-flex min-w-0 items-stretch"
        :class="TONES[part]"
      >
        <button
          type="button"
          :tabindex="editable ? 0 : -1"
          :class="segmentClass(part)"
          :data-test="testId(part)"
          @click.stop="onSelect(part, $event)"
        >
          <OTruncatedText class="max-w-60">{{ labels[part] }}</OTruncatedText>
        </button>
        <button
          type="button"
          :aria-label="removeLabel ?? t('common.remove')"
          class="focus-visible:ring-focus-ring-accent inline-flex cursor-pointer items-center ps-0.5 pe-1.5 outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-inset"
          :data-test="testId('remove')"
          @click.stop="emit('remove')"
        >
          <OIcon name="close" size="xs" />
        </button>
      </span>
      <button
        v-else
        type="button"
        :tabindex="editable ? 0 : -1"
        :class="segmentClass(part)"
        :data-test="testId(part)"
        @click.stop="onSelect(part, $event)"
      >
        <OTruncatedText class="max-w-60">{{ labels[part] }}</OTruncatedText>
      </button>
    </template>
  </span>
</template>
