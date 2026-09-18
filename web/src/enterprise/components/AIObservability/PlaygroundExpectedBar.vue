<!-- Copyright 2026 OpenObserve Inc.

  The golden answer, pinned under the bench.

  It sits with the OUTPUTS, not with the `{{variable}}` fields above, because it
  is not an input: the run request never carries it, `renderTemplate` refuses to
  bind `{{expected_output}}`, and the Create Experiment handoff drops it. Its one
  consumer is scoring — so it belongs beside the scores it explains.

  The caption says what it is FOR, not that it is withheld from the model. Down
  here nobody assumes it is part of the prompt, so denying it would raise the
  doubt rather than settle it — and the one place that assumption is possible,
  a message containing `{{expected_output}}`, is warned about where it happens.

  Full width and outside the bench's horizontal scroller: one golden answer
  serves every column, so it must not scroll away with them.
-->
<template>
  <div
    class="border-border-default bg-surface-panel flex shrink-0 items-start gap-2 border-t px-4 py-2.5"
    data-test="ai-playground-expected-bar"
  >
    <div class="flex shrink-0 flex-col pt-1">
      <span class="text-text-heading text-2xs font-semibold">
        {{ t("aiObservability.playground.expectedLabel") }}
      </span>
      <span class="text-text-tertiary text-3xs">
        {{ t("aiObservability.playground.expectedHint") }}
      </span>
    </div>

    <!-- Wrapper ref, not `$el`: OTextarea is fragment-rooted, so the component
         instance has no single element to query.

         It also carries the flash. A focus outline alone changes nothing the eye
         was looking at, because the notice that sends you here is at the far
         corner of the page — but the ring marks the FIELD, not the whole strip,
         so it points at the thing to type in. `ring-transparent` is always
         present, so lighting it never reflows the row. -->
    <div
      ref="fieldRef"
      class="rounded-default min-w-0 flex-1 ring-2 transition-colors duration-300 motion-reduce:transition-none"
      :class="flashing ? 'ring-accent' : 'ring-transparent'"
      :data-flashing="flashing || undefined"
      data-test="ai-playground-expected-field"
    >
      <OTextarea
        :model-value="expected ?? ''"
        :placeholder="t('aiObservability.playground.expectedPlaceholder')"
        :rows="1"
        :max-rows="3"
        size="sm"
        autogrow
        data-test="ai-playground-expected-input"
        @update:model-value="(value: string) => emit('set-expected', value)"
      />
    </div>

    <!-- Clearing is only offered when nothing depends on it; otherwise the user
         would silently re-break the scoring they just fixed. -->
    <OButton
      v-if="expected && !required"
      variant="ghost-muted"
      size="icon-xs"
      icon-left="close"
      class="mt-0.5 shrink-0"
      :title="t('aiObservability.playground.removeExpected')"
      data-test="ai-playground-remove-expected"
      @click="emit('set-expected', null)"
    />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";

defineProps<{
  expected: string | null;
  /** A selected scorer compares against it, so it cannot be cleared away. */
  required?: boolean;
}>();

const emit = defineEmits<{ "set-expected": [value: string | null] }>();

const { t } = useI18nTyped();

const fieldRef = ref<HTMLElement | null>(null);
const flashing = ref(false);

/** Long enough to be caught out of the corner of the eye, short enough not to
 *  linger as if it were a permanent error state. */
const FLASH_MS = 1200;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Visual cue only — no keyboard focus move. Called when a sample lands: the
 *  field earns a glance, but the user's actual focus can be anywhere else on
 *  the page at that moment and must stay there. */
function flash() {
  flashing.value = true;
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flashing.value = false), FLASH_MS);
}

/** Called by the Score panel's warning, so the notice and its fix are one
 *  gesture — that link is a deliberate "take me there" click, unlike a
 *  sample landing passively, so this is the one seam allowed to move focus. */
function focus() {
  flash();
  void nextTick(() => fieldRef.value?.querySelector("textarea")?.focus());
}

onBeforeUnmount(() => {
  if (flashTimer) clearTimeout(flashTimer);
});

defineExpose({ focus, flash });
</script>
