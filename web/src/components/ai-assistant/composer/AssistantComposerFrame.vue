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
    ref="root"
    :class="['relative min-w-0', sweeping ? ASSISTANT_MOTION.sweep : '']"
    data-test="assistant-composer-frame"
    :data-state="state"
    :data-listening="listening ? '' : undefined"
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
      :class="[FRAME_CLASS, inert ? INERT_CLASS : '', listening ? LISTENING_CLASS : '']"
      @update:model-value="(value: string) => emit('update:modelValue', value)"
    >
      <template #header>
        <div v-if="$slots.strip" class="min-w-0">
          <slot name="strip" />
        </div>
      </template>
      <template #footer>
        <slot name="bar" />
      </template>
    </OTextarea>
  </div>
</template>

<script lang="ts">
export interface AssistantComposerFrameProps {
  modelValue: string;
  /** Mirrors the composer's state for styling and specs. */
  state?: string;
  /** Held for a decision: the field reads as unavailable. */
  inert?: boolean;
  /** The panel just opened: one accent light runs round the border once (none under reduced motion). */
  opening?: boolean;
  /** Attributes for the textarea itself; `class` adds to the frame's own. */
  inputAttrs?: Record<string, string | number | boolean | undefined>;
  /** The mic is live: the border turns the recording colour so nobody misses it. */
  listening?: boolean;
}

export interface AssistantComposerFrameEmits {
  (e: "update:modelValue", value: string): void;
}

/** One line at rest, six as it grows, then the field scrolls (K4). */
export const MAX_ROWS = 6;

// OTextarea's bordered box is its only div child here, so the frame styles it from the root until the lib grows a frame variant.
const FRAME_CLASS = [
  "[&>div]:rounded-surface [&>div]:border-border-default [&>div]:gap-2 [&>div]:px-2.5 [&>div]:pt-3 [&>div]:pb-2.5",
  "[&>div]:ring-offset-0 [&>div]:motion-reduce:transition-none [&>div]:focus-within:border-input-border-focus [&>div]:focus-within:ring-1 [&>div]:focus-within:ring-focus-ring-accent",
].join(" ");

const INERT_CLASS = "[&>div]:bg-surface-subtle";

const LISTENING_CLASS =
  "[&>div]:border-status-error-text! [&>div]:ring-1 [&>div]:ring-status-error-text! [&>div]:focus-within:border-status-error-text! [&>div]:focus-within:ring-status-error-text!";

const FIELD_CLASS = "px-1.5! py-0! my-1! min-h-6 max-h-36! text-sm leading-6! basis-auto!";
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import {
  ASSISTANT_MOTION,
  prefersReducedMotion,
} from "@/components/ai-assistant/common/assistantMotion";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<AssistantComposerFrameProps>(), {
  state: undefined,
  inert: false,
  opening: false,
  inputAttrs: () => ({}),
  listening: false,
});

const emit = defineEmits<AssistantComposerFrameEmits>();

defineSlots<{
  strip?: () => unknown;
  bar?: () => unknown;
}>();

// The utility also drops the sweep under reduced motion; skipping the class keeps the frame free of the pseudo-element.
const sweeping = computed(() => props.opening && !prefersReducedMotion());

const textbox = ref<InstanceType<typeof OTextarea> | null>(null);

const fieldAttrs = computed(() => ({
  ...props.inputAttrs,
  class: [FIELD_CLASS, props.inputAttrs.class ?? ""].join(" "),
}));

const root = ref<HTMLElement | null>(null);

// The field is one line tall, so a tap on the box that is not a control lands in it; Tab reaches the field itself.
function focusFromFrame(event: MouseEvent): void {
  const control = (event.target as Element | null)?.closest("button, a, input, textarea, [role]");
  if (control && root.value?.contains(control)) return;
  textbox.value?.focus();
}

onMounted(() => root.value?.addEventListener("click", focusFromFrame));
onBeforeUnmount(() => root.value?.removeEventListener("click", focusFromFrame));

defineExpose({
  focus: (options?: FocusOptions) => textbox.value?.focus(options),
  get textarea(): HTMLTextAreaElement | null {
    return textbox.value?.textarea ?? null;
  },
});
</script>
