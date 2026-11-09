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
  <div
    :class="['relative min-w-0', sweeping ? ASSISTANT_MOTION.sweep : '']"
    data-test="assistant-composer-frame"
    :data-state="state"
  >
    <OTextarea
      ref="textbox"
      v-bind="$attrs"
      :model-value="modelValue"
      :rows="1"
      autogrow
      :max-rows="MAX_ROWS"
      width="full"
      :input-attrs="fieldAttrs"
      :class="[FRAME_CLASS, inert ? INERT_CLASS : '']"
      @update:model-value="(value: string) => emit('update:modelValue', value)"
    >
      <template #header>
        <slot name="strip" />
      </template>
      <template #footer>
        <slot name="bar" />
      </template>
    </OTextarea>
    <span v-if="trailing" class="absolute end-2.5 top-9.5 flex">
      <slot name="trailing" />
    </span>
  </div>
</template>

<script lang="ts">
export interface AssistantComposerFrameProps {
  modelValue: string;
  /** Mirrors the composer's state for styling and specs. */
  state?: string;
  /** Held for a decision: the field reads as unavailable. */
  inert?: boolean;
  /** Shows the trailing slot (the dictation waveform) and keeps the text clear of it. */
  trailing?: boolean;
  /** The panel just opened: one accent light runs round the border once (none under reduced motion). */
  opening?: boolean;
  /** Attributes for the textarea itself; `class` adds to the frame's own. */
  inputAttrs?: Record<string, string | number | boolean | undefined>;
}

export interface AssistantComposerFrameEmits {
  (e: "update:modelValue", value: string): void;
}

/** Six lines, then the field scrolls (K4). */
export const MAX_ROWS = 6;

// OTextarea's bordered box is its only div child here, so the frame styles it from the root until the lib grows a frame variant.
const FRAME_CLASS = [
  "[&>div]:rounded-2xl [&>div]:border-border-default [&>div]:gap-0.5 [&>div]:px-2 [&>div]:pt-1.5 [&>div]:pb-2",
  "[&>div]:focus-within:border-input-border-focus [&>div]:focus-within:ring-3 [&>div]:focus-within:ring-focus-ring-accent",
].join(" ");

const INERT_CLASS = "[&>div]:bg-surface-subtle";

const FIELD_CLASS = "px-1! py-0! my-0.5! min-h-6 max-h-36! text-sm leading-6! basis-auto!";
</script>

<script setup lang="ts">
import { computed, ref } from "vue";

import {
  ASSISTANT_MOTION,
  prefersReducedMotion,
} from "@/components/ai-assistant/common/assistantMotion";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<AssistantComposerFrameProps>(), {
  state: undefined,
  inert: false,
  trailing: false,
  opening: false,
  inputAttrs: () => ({}),
});

const emit = defineEmits<AssistantComposerFrameEmits>();

defineSlots<{
  strip?: () => unknown;
  trailing?: () => unknown;
  bar?: () => unknown;
}>();

// The utility also drops the sweep under reduced motion; skipping the class keeps the frame free of the pseudo-element.
const sweeping = computed(() => props.opening && !prefersReducedMotion());

const textbox = ref<InstanceType<typeof OTextarea> | null>(null);

// The trailing waveform sits over the first line, so the text keeps clear of it.
const fieldAttrs = computed(() => ({
  ...props.inputAttrs,
  class: [FIELD_CLASS, props.trailing ? "pe-24!" : "", props.inputAttrs.class ?? ""].join(" "),
}));

defineExpose({
  focus: (options?: FocusOptions) => textbox.value?.focus(options),
  get textarea(): HTMLTextAreaElement | null {
    return textbox.value?.textarea ?? null;
  },
});
</script>
