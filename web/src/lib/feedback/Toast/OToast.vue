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
import type { ToastProps, ToastEmits, ToastVariant } from "./OToast.types";
import { computed, ref, onUnmounted } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { pauseTimer, resumeTimer, isPageVisible } from "./useToast";
import { ToastRoot, ToastDescription, ToastClose } from "reka-ui";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<ToastProps>(), {
  variant: "default",
  open: true,
  count: 1,
});

const emit = defineEmits<ToastEmits>();

type ToastKind = "neutral" | "ok" | "error";

// Warning and info results read as neutral; only the outcome of an action earns a colour (K1).
const KIND: Record<ToastVariant, ToastKind> = {
  success: "ok",
  error: "error",
  warning: "neutral",
  info: "neutral",
  loading: "neutral",
  default: "neutral",
};

const KIND_ICON: Record<ToastKind, IconName> = {
  neutral: "info",
  ok: "check-circle",
  error: "cancel",
};

const KIND_ICON_CLASS: Record<ToastKind, string> = {
  neutral: "text-toast-inverse-icon",
  ok: "text-toast-inverse-icon-ok",
  error: "text-toast-inverse-icon-err",
};

const kind = computed(() => KIND[props.variant ?? "default"]);

function onMouseEnter() {
  pauseTimer(props.id);
}

function onMouseLeave() {
  // A mouseleave while the tab is hidden must not restart a timer the visibility listener paused.
  if (isPageVisible.value) resumeTimer(props.id);
}

const rootRole = computed<"alert" | "status">(() =>
  props.variant === "error" || props.variant === "warning" ? "alert" : "status",
);

// Temporary success state for the action button (e.g. "Copied!")
const actionSucceeded = ref(false);
let actionResetTimer: ReturnType<typeof setTimeout> | undefined;

function handleActionClick() {
  if (!props.action) return;
  props.action.handler();
  if (props.action.successLabel) {
    actionSucceeded.value = true;
    clearTimeout(actionResetTimer);
    actionResetTimer = setTimeout(() => {
      actionSucceeded.value = false;
    }, 2000);
  }
}

onUnmounted(() => {
  clearTimeout(actionResetTimer);
});
</script>

<template>
  <ToastRoot
    :open="open"
    :duration="0"
    :class="[
      'rounded-menu shadow-toast bg-toast-inverse-bg text-toast-inverse-text text-compact pointer-events-auto flex min-h-10 w-max max-w-[min(26.25rem,calc(100vw-2rem))] items-center gap-3 py-2 ps-3 pe-2',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4',
      'animation-duration-(--duration-overlay-in) data-[state=closed]:animation-duration-(--duration-overlay-out) ease-(--ease-out-expo) data-[state=closed]:ease-(--ease-overlay-out)',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-4',
    ]"
    :role="rootRole"
    :data-test="`o-toast-${id}`"
    :data-test-variant="variant ?? 'default'"
    :data-test-kind="kind"
    :data-test-message="message"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @update:open="(val) => emit('openChange', val)"
  >
    <span :class="['flex shrink-0', KIND_ICON_CLASS[kind]]" aria-hidden="true">
      <OIcon
        v-if="variant === 'loading'"
        name="autorenew"
        size="sm"
        class="o2-motion-keep animate-spin"
      />
      <OIcon v-else :name="KIND_ICON[kind]" size="sm" />
    </span>

    <ToastDescription class="min-w-0 flex-1" data-test="o-toast-message">
      <OTruncatedText class="block">{{ message }}</OTruncatedText>
    </ToastDescription>

    <span
      v-if="count > 1"
      class="text-toast-inverse-text-secondary shrink-0 text-xs tabular-nums"
      :data-test="`o-toast-count-${count}`"
      >{{ count > 99 ? "99+" : `×${count}` }}</span
    >

    <!-- A plain button, not reka's ToastAction, which wraps ToastClose and so closes on every click. -->
    <button
      v-if="action"
      type="button"
      data-test="o-toast-action-btn"
      class="text-toast-inverse-action hover:bg-toast-inverse-text/10 focus-visible:outline-focus-ring-accent rounded-chip text-compact shrink-0 cursor-pointer px-1.5 py-1 font-semibold whitespace-nowrap transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid"
      @click.stop="handleActionClick"
    >
      {{ actionSucceeded && action.successLabel ? action.successLabel : action.label }}
    </button>

    <ToastClose
      class="text-toast-inverse-text-secondary hover:bg-toast-inverse-text/10 hover:text-toast-inverse-text focus-visible:outline-focus-ring-accent rounded-chip grid size-6 shrink-0 cursor-pointer place-items-center transition-colors outline-none focus-visible:outline-2 focus-visible:outline-solid"
      :aria-label="t('components.toast.dismissNotification')"
      data-test="o-toast-dismiss"
    >
      <OIcon name="close" size="sm" class="size-3.5" aria-hidden="true" />
    </ToastClose>
  </ToastRoot>
</template>
