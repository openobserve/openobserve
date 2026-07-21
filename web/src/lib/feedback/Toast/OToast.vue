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
import { computed, ref, onUnmounted } from "vue"
import OIcon from "@/lib/core/Icon/OIcon.vue"
import OTag from "@/lib/core/Badge/OTag.vue"
import { pauseTimer, resumeTimer, isPageVisible } from "./useToast"
import {
  ToastRoot,
  ToastTitle,
  ToastDescription,
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
    "bg-toast-success-bg border border-toast-success-border",
    "text-toast-fg",
  ].join(" "),
  error: [
    "bg-toast-error-bg border border-toast-error-border",
    "text-toast-fg",
  ].join(" "),
  warning: [
    "bg-toast-warning-bg border border-toast-warning-border",
    "text-toast-fg",
  ].join(" "),
  info: [
    "bg-toast-info-bg border border-toast-info-border",
    "text-toast-fg",
  ].join(" "),
  loading: [
    "bg-toast-loading-bg border border-toast-loading-border",
    "text-toast-fg",
  ].join(" "),
  default: [
    "bg-toast-default-bg border border-toast-default-border",
    "text-toast-fg",
  ].join(" "),
}

const iconColorClasses: Record<NonNullable<ToastProps["variant"]>, string> = {
  success: "text-toast-success-icon",
  error: "text-toast-error-icon",
  warning: "text-toast-warning-icon",
  info: "text-toast-info-icon",
  loading: "text-toast-loading-icon",
  default: "text-toast-fg",
}

const badgeColorClasses: Record<NonNullable<ToastProps["variant"]>, string> = {
  success: "bg-toast-success-icon text-white",
  error: "bg-toast-error-icon text-white",
  warning: "bg-toast-warning-icon text-white",
  info: "bg-toast-info-icon text-white",
  loading: "bg-toast-loading-icon text-white",
  default: "bg-toast-default-border text-toast-fg",
}

const progressBarColorClasses: Record<NonNullable<ToastProps["variant"]>, string> = {
  success: "bg-toast-success-icon",
  error: "bg-toast-error-icon",
  warning: "bg-toast-warning-icon",
  info: "bg-toast-info-icon",
  loading: "bg-toast-loading-icon",
  default: "bg-toast-default-border",
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

const detailsExpanded = ref(false)

// Temporary success state for the action button (e.g. "Copied!")
const actionSucceeded = ref(false)
let actionResetTimer: ReturnType<typeof setTimeout> | undefined

function handleActionClick() {
  if (!props.action) return
  props.action.handler()
  if (props.action.successLabel) {
    actionSucceeded.value = true
    clearTimeout(actionResetTimer)
    actionResetTimer = setTimeout(() => {
      actionSucceeded.value = false
    }, 2000)
  }
}

onUnmounted(() => {
  clearTimeout(actionResetTimer)
})
</script>

<template>
  <ToastRoot
    :open="open"
    :duration="0"
    :class="[
      'relative pointer-events-auto',
      details && details.length > 0 ? 'w-[28rem]' : 'w-[22rem]',
      'max-w-[calc(100vw-2rem)]',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0',
      isTopPosition ? 'data-[state=open]:slide-in-from-top-4' : 'data-[state=open]:slide-in-from-bottom-4',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
      isTopPosition ? 'data-[state=closed]:slide-out-to-top-4' : 'data-[state=closed]:slide-out-to-bottom-4',
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
        'absolute -top-2 -right-2 z-10 flex items-center justify-center',
        'min-w-5 h-5 px-1.5 rounded-full text-xs font-semibold shadow',
        badgeColorClasses[variant ?? 'default'],
      ]"
      :data-test="`o-toast-count-${count}`"
      aria-hidden="true"
    >{{ count > 99 ? "99+" : count }}</span>

    <!-- Inner shell: carries all visual styling + overflow-hidden to clip the progress bar -->
    <div
      :class="[
        'relative flex gap-2 rounded-default overflow-hidden p-3 shadow-toast w-full',
        title ? 'items-start' : 'items-center',
        variantClasses[variant ?? 'default'],
      ]"
    >
      <!-- Icon -->
      <div
        v-if="hasIcon"
        :class="['shrink-0 flex items-center', iconColorClasses[variant ?? 'default']]"
        aria-hidden="true"
      >
        <OIcon name="autorenew" size="sm" v-if="variant === 'loading'"
          class="size-5 animate-spin" />
        <OIcon name="check-circle" size="sm" v-else-if="variant === 'success'"
          class="size-5" />
        <OIcon name="cancel" size="sm" v-else-if="variant === 'error'"
          class="size-5" />
        <OIcon name="warning" size="sm" v-else-if="variant === 'warning'"
          class="size-5" />
        <OIcon name="info" size="sm" v-else-if="variant === 'info'"
          class="size-5" />
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <!-- Title row: text + optional count badge side-by-side -->
        <div
          :class="[
            'flex items-center gap-2',
            !title ? 'sr-only' : '',
          ]"
        >
          <ToastTitle class="text-sm font-semibold text-toast-fg leading-snug">
            {{ title ?? screenReaderTitle }}
          </ToastTitle>
          <OTag
            v-if="title && titleCount !== undefined"
            type="countChip"
            value="errorstrong"
          >{{ titleCount }}</OTag>
        </div>

        <!-- Message + inline action -->
        <div
          :class="[
            'flex flex-wrap items-start gap-x-3 gap-y-1.5',
            title ? 'mt-1' : '',
          ]"
        >
          <ToastDescription
            :class="[
              'text-sm leading-snug',
              title ? 'text-toast-fg-secondary' : 'text-toast-fg',
            ]"
            data-test="o-toast-message"
          >
            {{ message }}
          </ToastDescription>

          <!-- Action button — plain <button>, NOT wrapped in ToastAction.
               reka-ui's ToastAction wraps ToastClose internally, which means
               any click on a ToastAction automatically dismisses the toast.
               Using a plain button preserves click behaviour without closing. -->
          <button
            v-if="action"
            type="button"
            :class="[
              'inline-flex items-center gap-1 justify-center rounded-default px-2.5 py-0.5 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
              actionSucceeded
                ? 'bg-toast-success-icon text-white focus-visible:ring-toast-success-icon'
                : 'bg-toast-action-text text-white hover:bg-toast-action-hover focus-visible:ring-toast-action-text',
            ]"
            @click.stop="handleActionClick"
          >
            <OIcon v-if="actionSucceeded" name="check" size="sm" class="size-3.5" aria-hidden="true" />
            {{ actionSucceeded && action.successLabel ? action.successLabel : action.label }}
          </button>
        </div>

        <!-- Expandable affected-sections list -->
        <div
          v-if="details && details.length > 0"
          class="mt-2 w-full"
          data-test="o-toast-details"
        >
          <button
            type="button"
            class="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-toast-fg-secondary hover:text-toast-fg transition-colors cursor-pointer"
            :aria-expanded="detailsExpanded"
            data-test="o-toast-details-toggle"
            @click.stop="detailsExpanded = !detailsExpanded"
          >
            <OIcon
              :name="detailsExpanded ? 'expand-less' : 'expand-more'"
              size="sm"
              class="size-3.5"
              aria-hidden="true"
            />
            Affected Sections
          </button>
          <ul
            v-if="detailsExpanded"
            class="mt-1.5 space-y-1.5"
            data-test="o-toast-details-list"
          >
            <li
              v-for="detail in details"
              :key="detail.url"
              class="flex items-baseline justify-between gap-2 text-xs"
            >
              <span class="font-medium text-toast-fg shrink-0">{{ detail.label }}</span>
              <span
                class="text-toast-fg-secondary truncate font-mono text-right"
                :title="detail.url"
              >{{ detail.url }}</span>
            </li>
          </ul>
        </div>
      </div>

      <!-- Dismiss button -->
      <ToastClose
        :class="['shrink-0 flex items-center rounded-default p-0.5 text-toast-fg-secondary hover:text-toast-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-toast-info-border', title ? 'self-start' : 'self-center']"
        aria-label="Dismiss notification"
      >
        <OIcon name="close" size="sm" class="size-4" aria-hidden="true" />
      </ToastClose>

      <!-- Timeout progress bar — clipped by parent overflow-hidden + rounded-default.
           :key on the outer div ensures Vue remounts it (restarting the CSS animation)
           whenever timerKey increments (i.e. a duplicate toast resets the timer). -->
      <div
        v-if="(timeout ?? 0) > 0"
        :key="timerKey"
        class="absolute bottom-0 left-0 right-0 h-0.5"
        aria-hidden="true"
      >
        <div
          :class="['toast-progress-bar h-full w-full origin-left', progressBarColorClasses[variant ?? 'default']]"
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
/* keep(keyframes): the auto-dismiss progress bar is used only by this toast. The
   `animation` shorthand is declared here, not as a template `[animation:…]`
   utility, so Vue's scoped compiler renames the keyframe and this reference
   together. Duration and play-state stay as inline `:style` longhands because
   they are runtime values (per-toast timeout, pause-on-hover) — inline longhands
   override this shorthand's initial values, so the pairing is intentional. */
.toast-progress-bar {
  animation: shrink linear forwards;
}

@keyframes shrink {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}
</style>

