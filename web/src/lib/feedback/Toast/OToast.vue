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
import type { ToastProps, ToastEmits } from "./OToast.types"
import { computed } from "vue"
import OIcon from "@/lib/core/Icon/OIcon.vue";
import {
  ToastRoot,
  ToastTitle,
  ToastDescription,
  ToastAction,
  ToastClose,
} from "reka-ui"

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<ToastProps>(), {
  variant: "default",
  position: "bottom-right",
  open: true,
  count: 1,
})

const emit = defineEmits<ToastEmits>()

// ── Variant class maps ───────────────────────────────────────────────────────

const variantClasses: Record<NonNullable<ToastProps["variant"]>, string> = {
  success: [
    "tw:bg-toast-success-bg tw:border tw:border-toast-success-border",
    "tw:text-toast-fg",
  ].join(" "),
  error: [
    "tw:bg-toast-error-bg tw:border tw:border-toast-error-border",
    "tw:text-toast-fg",
  ].join(" "),
  warning: [
    "tw:bg-toast-warning-bg tw:border tw:border-toast-warning-border",
    "tw:text-toast-fg",
  ].join(" "),
  info: [
    "tw:bg-toast-info-bg tw:border tw:border-toast-info-border",
    "tw:text-toast-fg",
  ].join(" "),
  loading: [
    "tw:bg-toast-loading-bg tw:border tw:border-toast-loading-border",
    "tw:text-toast-fg",
  ].join(" "),
  default: [
    "tw:bg-toast-default-bg tw:border tw:border-toast-default-border",
    "tw:text-toast-fg",
  ].join(" "),
}

const iconColorClasses: Record<NonNullable<ToastProps["variant"]>, string> = {
  success: "tw:text-toast-success-icon",
  error: "tw:text-toast-error-icon",
  warning: "tw:text-toast-warning-icon",
  info: "tw:text-toast-info-icon",
  loading: "tw:text-toast-loading-icon",
  default: "tw:text-toast-fg",
}

const badgeColorClasses: Record<NonNullable<ToastProps["variant"]>, string> = {
  success: "tw:bg-toast-success-icon tw:text-white",
  error: "tw:bg-toast-error-icon tw:text-white",
  warning: "tw:bg-toast-warning-icon tw:text-white",
  info: "tw:bg-toast-info-icon tw:text-white",
  loading: "tw:bg-toast-loading-icon tw:text-white",
  default: "tw:bg-toast-default-border tw:text-toast-fg",
}

// ── Computed ─────────────────────────────────────────────────────────────────

const rootRole = computed<"alert" | "status">(() =>
  props.variant === "error" || props.variant === "warning" ? "alert" : "status",
)

const hasIcon = computed(() => props.variant !== "default")

const screenReaderTitle = computed(() =>
  props.title ? props.title : props.message,
)
</script>

<template>
  <ToastRoot
    :open="open"
    :duration="0"
    :class="[
      'tw:relative tw:pointer-events-auto tw:flex tw:gap-3 tw:items-start tw:rounded-lg tw:p-4 tw:shadow-toast',
      // Normal toasts keep the original fixed width; only toasts with an action
      // button grow to fit so the button can sit inline beside short messages.
      action ? 'tw:w-fit tw:min-w-[20rem] tw:max-w-md' : 'tw:w-80 tw:max-w-sm',
      'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0 tw:data-[state=open]:slide-in-from-bottom-4',
      'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:slide-out-to-bottom-4',
      variantClasses[variant ?? 'default'],
    ]"
    :role="rootRole"
    :data-test="`o-toast-${variant ?? 'default'}`"
    :data-test-message="message"
    @update:open="(val) => emit('openChange', val)"
  >
    <!-- Count badge — shown when identical toasts are collapsed together -->
    <span
      v-if="count > 1"
      :class="[
        'tw:absolute tw:-top-2 tw:-right-2 tw:z-10 tw:flex tw:items-center tw:justify-center',
        'tw:min-w-5 tw:h-5 tw:px-1.5 tw:rounded-full tw:text-xs tw:font-semibold tw:shadow',
        badgeColorClasses[variant ?? 'default'],
      ]"
      :data-test="`o-toast-count-${count}`"
      aria-hidden="true"
    >{{ count > 99 ? "99+" : count }}</span>
    <!-- Icon -->
    <div
      v-if="hasIcon"
      :class="['tw:shrink-0 tw:flex tw:items-center tw:h-[1.375em] tw:text-sm tw:leading-snug', iconColorClasses[variant ?? 'default']]"
      aria-hidden="true"
    >
      <OIcon name="autorenew" size="sm" v-if="variant === 'loading'"
        class="tw:size-5 tw:animate-spin" />
      <OIcon name="check-circle" size="sm" v-else-if="variant === 'success'"
        class="tw:size-5" />
      <OIcon name="cancel" size="sm" v-else-if="variant === 'error'"
        class="tw:size-5" />
      <OIcon name="warning" size="sm" v-else-if="variant === 'warning'"
        class="tw:size-5" />
      <OIcon name="info" size="sm" v-else-if="variant === 'info'"
        class="tw:size-5" />
    </div>

    <!-- Content -->
    <div class="tw:flex-1 tw:min-w-0">
      <!-- Title — visible when provided, sr-only otherwise (carries message text for screen readers) -->
      <ToastTitle
        :class="[
          'tw:text-sm tw:font-semibold tw:text-toast-fg tw:leading-snug',
          !title ? 'tw:sr-only' : ''
        ]"
      >
        {{ title ?? screenReaderTitle }}
      </ToastTitle>

      <!-- Message + inline action — the action sits beside short messages and
           wraps below long ones (flex-wrap) -->
      <div
        :class="[
          'tw:flex tw:flex-wrap tw:items-start tw:gap-x-3 tw:gap-y-1.5',
          title ? 'tw:mt-1' : '',
        ]"
      >
        <ToastDescription
          :class="[
            'tw:text-sm tw:leading-snug',
            title ? 'tw:text-toast-fg-secondary' : 'tw:text-toast-fg',
          ]"
          data-test="o-toast-message"
        >
          {{ message }}
        </ToastDescription>

        <!-- Action button -->
        <ToastAction
          v-if="action"
          :alt-text="action.label"
          as-child
        >
          <button
            type="button"
            class="tw:inline-flex tw:items-center tw:justify-center tw:rounded tw:bg-toast-action-text tw:px-2.5 tw:py-0.5 tw:text-xs tw:font-semibold tw:text-white tw:shadow-sm tw:transition-colors tw:hover:bg-toast-action-hover tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-offset-1 tw:focus-visible:ring-toast-action-text"
            @click="action.handler"
          >
            {{ action.label }}
          </button>
        </ToastAction>
      </div>
    </div>

    <!-- Dismiss button -->
    <ToastClose
      class="tw:shrink-0 tw:mt-0.5 tw:rounded tw:p-0.5 tw:text-toast-fg-secondary tw:hover:text-toast-fg tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-toast-info-border"
      aria-label="Dismiss notification"
    >
      <OIcon name="close" size="sm" class="tw:size-4" aria-hidden="true" />
    </ToastClose>
  </ToastRoot>
</template>
