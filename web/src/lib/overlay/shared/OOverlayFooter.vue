<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { computed, nextTick, ref, useSlots, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import type { OverlayAction, OverlayFooterEmits, OverlayFooterProps } from "./overlayFooter.types";

const props = defineProps<OverlayFooterProps>();
const emit = defineEmits<OverlayFooterEmits>();
defineSlots<{ footer?: () => unknown; "footer-left"?: () => unknown }>();

const slots = useSlots();
const { t } = useI18nTyped();

const primaryLoading = computed(() => !!props.primary?.loading || !!props.formSubmitting);
const anyLoading = computed(
  () => primaryLoading.value || !!props.secondary?.loading || !!props.extra?.loading,
);

// Any busy action freezes the others, so a second click cannot race the first.
const isDisabled = (action: OverlayAction | undefined, loading: boolean) =>
  !!action?.disabled || (anyLoading.value && !loading);

const keepRef = ref<InstanceType<typeof OButton> | null>(null);
const primaryRef = ref<InstanceType<typeof OButton> | null>(null);
const secondaryRef = ref<InstanceType<typeof OButton> | null>(null);

const elOf = (r: typeof keepRef) => (r.value as unknown as { $el?: HTMLElement } | null)?.$el;

// Keep editing is the safe default, so Enter right after the question keeps the edits.
watch(
  () => props.asking,
  (asking) => {
    if (asking) nextTick(() => elOf(keepRef)?.focus());
  },
);

/** The footer button a field-less overlay focuses on open; a destructive primary yields to Cancel. */
function initialFocusTarget(): HTMLElement | undefined {
  const safe = props.primary?.variant === "danger" ? secondaryRef : primaryRef;
  return elOf(safe) ?? elOf(primaryRef) ?? elOf(secondaryRef);
}

const hasBuiltIn = computed(
  () => !!(props.primary?.label || props.secondary?.label || props.extra?.label),
);
const rendered = computed(
  () => props.asking || !!slots.footer || !!slots["footer-left"] || hasBuiltIn.value,
);

defineExpose({ initialFocusTarget, rendered });
</script>

<template>
  <div
    v-if="rendered"
    :class="[
      'border-dialog-footer-border px-dialog-footer-px py-dialog-footer-py shrink-0 border-t',
      asking ? 'bg-banner-warning-bg' : 'bg-dialog-footer-bg',
    ]"
  >
    <div
      v-if="asking"
      role="alert"
      class="flex items-center gap-2"
      :data-test="`${testPrefix}-discard-row`"
    >
      <span class="text-banner-warning-text text-compact min-w-0 flex-1 font-medium">
        {{ t("components.dialog.discardChanges") }}
      </span>
      <OButton ref="keepRef" :data-test="`${testPrefix}-keep-editing-btn`" @click="emit('keep')">
        {{ t("components.dialog.keepEditing") }}
      </OButton>
      <OButton variant="danger" :data-test="`${testPrefix}-discard-btn`" @click="emit('discard')">
        {{ t("components.dialog.discard") }}
      </OButton>
    </div>
    <slot v-else-if="$slots.footer" name="footer" />
    <div v-else class="flex items-center gap-2">
      <slot name="footer-left" />
      <OButton
        v-if="extra?.label"
        :data-test="extra.dataTest ?? `${testPrefix}-neutral-btn`"
        :variant="extra.variant ?? 'ghost'"
        :disabled="isDisabled(extra, !!extra.loading)"
        :disabled-reason="extra.disabled ? extra.disabledReason : undefined"
        :loading="extra.loading"
        @click="emit('extra')"
      >
        {{ extra.label }}
      </OButton>
      <span class="min-w-0 flex-1" />
      <OButton
        v-if="secondary?.label"
        ref="secondaryRef"
        :data-test="secondary.dataTest ?? `${testPrefix}-secondary-btn`"
        :variant="secondary.variant ?? 'secondary'"
        :disabled="isDisabled(secondary, !!secondary.loading)"
        :disabled-reason="secondary.disabled ? secondary.disabledReason : undefined"
        :loading="secondary.loading"
        @mousedown.prevent
        @click="emit('secondary')"
      >
        {{ secondary.label }}
      </OButton>
      <OButton
        v-if="primary?.label"
        ref="primaryRef"
        :data-test="primary.dataTest ?? `${testPrefix}-primary-btn`"
        :variant="primary.variant ?? 'primary'"
        :type="formId ? 'submit' : 'button'"
        :form="formId || undefined"
        :disabled="isDisabled(primary, primaryLoading)"
        :disabled-reason="primary.disabled ? primary.disabledReason : undefined"
        :loading="primaryLoading"
        @click="!formId && emit('primary')"
      >
        {{ primary.label }}
      </OButton>
    </div>
  </div>
</template>
