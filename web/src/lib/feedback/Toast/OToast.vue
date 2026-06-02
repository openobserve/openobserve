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
import { computed, ref } from "vue"
import OIcon from "@/lib/core/Icon/OIcon.vue"
import { pauseTimer, resumeTimer, isPageVisible } from "./useToast"
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

const progressBarColorClasses: Record<NonNullable<ToastProps["variant"]>, string> = {
  success: "tw:bg-toast-success-icon",
  error: "tw:bg-toast-error-icon",
  warning: "tw:bg-toast-warning-icon",
  info: "tw:bg-toast-info-icon",
  loading: "tw:bg-toast-loading-icon",
  default: "tw:bg-toast-default-border",
}

const isHovered = ref(false)

// isPaused drives the CSS progress-bar animation. It is a computed so it is
// always derived from the two independent pause sources: hover AND page
// visibility. A plain ref could fall out of sync; a computed never can.
const isPaused = computed(() => isHovered.value || !isPageVisible.value)

function onMouseEnter() {
  isHovered.value = true
  pauseTimer(props.id)
}

function onMouseLeave() {
  isHovered.value = false
  // Only resume if the page is actually visible right now; if the user somehow
  // triggered mouseleave while the tab was backgrounded (unlikely but safe),
  // we must not restart the timer.
  if (isPageVisible.value) {
    resumeTimer(props.id)
  }
}

// ── Computed ─────────────────────────────────────────────────────────────────

const rootRole = computed<"alert" | "status">(() =>
  props.variant === "error" || props.variant === "warning" ? "alert" : "status",
)

const hasIcon = computed(() => props.variant !== "default")

const screenReaderTitle = computed(() =>
  props.title ? props.title : props.message,
)

const isTopPosition = computed(() =>
  props.position.startsWith("top-"),
)
</script>

<template>
  <ToastRoot
    :open="open"
    :duration="0"
    :class="[
      'tw:relative tw:pointer-events-auto',
      'tw:w-fit tw:min-w-[18rem] tw:max-w-[calc(100vw-2rem)]',
      'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0',
      isTopPosition ? 'tw:data-[state=open]:slide-in-from-top-4' : 'tw:data-[state=open]:slide-in-from-bottom-4',
      'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0',
      isTopPosition ? 'tw:data-[state=closed]:slide-out-to-top-4' : 'tw:data-[state=closed]:slide-out-to-bottom-4',
    ]"
    :role="rootRole"
    :data-test="`o-toast-${id}`"
    :data-test-variant="variant ?? 'default'"
    :data-test-message="message"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @update:open="(val) => emit('openChange', val)"
  >
    <!-- Count badge — outside the clipped inner shell so it is never cut off -->
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

    <!-- Inner shell: carries all visual styling + overflow-hidden to clip the progress bar -->
    <div
      :class="[
        'tw:relative tw:flex tw:gap-2 tw:rounded-lg tw:overflow-hidden tw:p-3 tw:shadow-toast tw:w-full',
        title ? 'tw:items-start' : 'tw:items-center',
        variantClasses[variant ?? 'default'],
      ]"
    >
      <!-- Icon -->
      <div
        v-if="hasIcon"
        :class="['tw:shrink-0 tw:flex tw:items-center', iconColorClasses[variant ?? 'default']]"
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

        <!-- Message + inline action -->
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
        :class="['tw:shrink-0 tw:flex tw:items-center tw:rounded tw:p-0.5 tw:text-toast-fg-secondary tw:hover:text-toast-fg tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-toast-info-border', title ? 'tw:self-start' : 'tw:self-center']"
        aria-label="Dismiss notification"
      >
        <OIcon name="close" size="sm" class="tw:size-4" aria-hidden="true" />
      </ToastClose>

      <!-- Timeout progress bar — clipped by parent overflow-hidden + rounded-lg -->
      <div
        v-if="timeout > 0"
        class="tw:absolute tw:bottom-0 tw:left-0 tw:right-0 tw:h-0.5"
        aria-hidden="true"
      >
        <div
          :class="['tw:h-full tw:w-full tw:origin-left toast-progress-fill', progressBarColorClasses[variant ?? 'default']]"
          :style="{
            animationDuration: `${timeout}ms`,
            animationPlayState: isPaused ? 'paused' : 'running',
          }"
        />
      </div>
    </div>
  </ToastRoot>
</template>

<style scoped>
.toast-progress-fill {
  animation: toast-shrink linear forwards;
}

@keyframes toast-shrink {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}
</style>
