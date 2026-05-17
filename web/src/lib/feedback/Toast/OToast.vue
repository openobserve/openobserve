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
      'tw:flex tw:gap-3 tw:items-start tw:w-80 tw:max-w-sm tw:rounded-lg tw:p-4 tw:shadow-toast',
      'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0 tw:data-[state=open]:slide-in-from-bottom-4',
      'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:slide-out-to-bottom-4',
      variantClasses[variant ?? 'default'],
    ]"
    :role="rootRole"
    @update:open="(val) => emit('openChange', val)"
  >
    <!-- Icon -->
    <div
      v-if="hasIcon"
      :class="['tw:mt-0.5 tw:shrink-0', iconColorClasses[variant ?? 'default']]"
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
      <!-- Title (always present for screen readers) -->
      <ToastTitle
        :class="[
          'tw:text-sm tw:font-semibold tw:text-toast-fg tw:leading-snug',
          !title ? 'tw:sr-only' : ''
        ]"
      >
        {{ title ?? screenReaderTitle }}
      </ToastTitle>

      <!-- Message (visible; hidden from SR when title is absent since title carries the text) -->
      <ToastDescription
        v-if="title"
        class="tw:text-sm tw:text-toast-fg-secondary tw:mt-1 tw:leading-snug"
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
          class="tw:mt-2 tw:text-sm tw:font-medium tw:text-toast-action-text tw:hover:text-toast-action-hover tw:focus-visible:outline-none tw:focus-visible:underline"
          @click="action.handler"
        >
          {{ action.label }}
        </button>
      </ToastAction>
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
