<script setup lang="ts">
import type { DialogProps, DialogEmits, DialogSlots } from "./ODialog.types";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "reka-ui";
import { ref, watch, useSlots, computed, nextTick, useAttrs } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useScrollShadow } from "@/lib/overlay/useScrollShadow";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
// Forward the consumer's `data-test` from <ODialog data-test="…"> onto the
// rendered panel so e2e selectors can scope to the specific dialog instance
// using the audit pattern: [data-test="<parent>"] [data-test="o-dialog-*-btn"].
// (DialogRoot is renderless, so default attribute inheritance would lose it.)
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const props = withDefaults(defineProps<DialogProps>(), {
  persistent: false,
  size: "md",
  showClose: true,
  width: undefined,
  primaryButtonVariant: "primary",
  secondaryButtonVariant: "outline",
  neutralButtonVariant: "ghost",
  primaryButtonDisabled: false,
  secondaryButtonDisabled: false,
  neutralButtonDisabled: false,
  primaryButtonLoading: false,
  secondaryButtonLoading: false,
  neutralButtonLoading: false,
});

const emit = defineEmits<DialogEmits>();

defineSlots<DialogSlots>();

const slots = useSlots();

// Vue boolean-casts absent `open` prop to `false`, which would lock
// DialogRoot into controlled-closed mode. We manage state ourselves
// so reka-ui stays responsive in both uncontrolled and controlled usage.
const internalOpen = ref(props.open ?? false);

watch(
  () => props.open,
  (v) => {
    if (v !== undefined) internalOpen.value = v;
  },
);

function handleOpenChange(v: boolean) {
  internalOpen.value = v;
  emit("update:open", v);
}

function handleEscapeKeyDown(e: KeyboardEvent) {
  if (props.persistent) {
    e.preventDefault();
    return;
  }
  clearBodyValidation();
}

function handleInteractOutside(e: Event) {
  if (props.persistent) {
    e.preventDefault();
    return;
  }

  // Prevent the dialog from closing when a pointer-down lands inside a portaled
  // floating element (e.g. a dropdown, select, combobox, date-picker) that was
  // opened from within the dialog. Those elements are teleported to document.body
  // and therefore sit outside the DialogContent DOM subtree, so reka-ui's
  // DismissableLayer fires interactOutside for them — which would wrongly dismiss
  // the dialog before the click on the item can register.
  const originalEvent = (
    e as CustomEvent & { detail?: { originalEvent?: PointerEvent } }
  ).detail?.originalEvent;
  const target = originalEvent?.target as Element | null;
  if (
    target?.closest("[data-reka-popper-content-wrapper]") || // reka-ui portals (ODropdown, OSelect, …)
    target?.closest(".q-menu") // Quasar portals (q-select, q-btn-dropdown, …)
  ) {
    e.preventDefault();
    return;
  }
  clearBodyValidation();
}

// Header renders when there is a header slot, a title, any sub-slot, OR a visible close button.
// This ensures the × always appears even in component-wrapper dialogs with no title.
const hasHeader = computed(
  () =>
    !!slots.header ||
    !!slots["header-left"] ||
    !!slots["header-right"] ||
    !!props.title ||
    props.showClose,
);
const hasFooter = computed(
  () =>
    !!slots.footer ||
    !!props.primaryButtonLabel ||
    !!props.secondaryButtonLabel ||
    !!props.neutralButtonLabel,
);
const hasTrigger = computed(() => !!slots.trigger);

// Auto-disable all buttons when any one of them is loading
const anyButtonLoading = computed(
  () =>
    props.primaryButtonLoading ||
    props.secondaryButtonLoading ||
    props.neutralButtonLoading,
);

const primaryEffectivelyDisabled = computed(
  () => props.primaryButtonDisabled || anyButtonLoading.value,
);
const secondaryEffectivelyDisabled = computed(
  () => props.secondaryButtonDisabled || anyButtonLoading.value,
);
const neutralEffectivelyDisabled = computed(
  () => props.neutralButtonDisabled || anyButtonLoading.value,
);

// Size → Tailwind classes
const sizeClasses = computed(() => {
  // When an explicit width is supplied, skip max-w presets (full-screen is the exception)
  if (props.width) {
    return props.size === "full"
      ? "tw:w-screen tw:h-screen tw:max-w-none tw:rounded-none"
      : "tw:max-w-none";
  }
  switch (props.size) {
    case "xs":
      return "tw:max-w-[min(320px,calc(100vw-2rem))] tw:w-full";
    case "sm":
      return "tw:max-w-[min(480px,calc(100vw-2rem))] tw:w-full";
    case "md":
      return "tw:max-w-[min(640px,calc(100vw-2rem))] tw:w-full";
    case "lg":
      return "tw:max-w-[min(800px,calc(100vw-2rem))] tw:w-full";
    case "xl":
      return "tw:max-w-[min(1024px,calc(100vw-2rem))] tw:w-full";
    case "full":
      return "tw:w-screen tw:h-screen tw:max-w-none tw:rounded-none";
    default:
      return "tw:max-w-[min(640px,calc(100vw-2rem))] tw:w-full";
  }
});

const isFullSize = computed(() => props.size === "full");

// Inline style for explicit width override (number 1-100 → vw)
const contentStyle = computed(() =>
  props.width != null ? { width: `${props.width}vw` } : undefined,
);

// ── Validation reset on cancel-path close ───────────────────────────────────
/** Reset Quasar q-field validation for every field in the body slot so that
 *  cancel-path closes (Cancel button, ×, Escape, overlay click) never surface
 *  lazy-rules validation errors to the user. */
function clearBodyValidation() {
  const body = bodyRef.value;
  if (!body) return;
  body.querySelectorAll<HTMLElement>('.q-field').forEach((el) => {
    const vm = (el as any).__vueParentComponent;
    if (vm?.ctx?.resetValidation) {
      vm.ctx.resetValidation();
    } else if (typeof vm?.exposed?.resetValidation === 'function') {
      vm.exposed.resetValidation();
    }
  });
}

/** When focus moves to a non-form element inside the body (e.g. an action
 *  button), reset all field validation so sibling fields never show
 *  premature errors before the user clicks Save. */
function handleBodyFocusIn(e: FocusEvent) {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const isFormField =
    target.matches('input, textarea, select') ||
    !!target.closest('.q-field, .q-input, .q-select');
  if (!isFormField) {
    clearBodyValidation();
  }
}

// ── Auto-focus logic ─────────────────────────────────────────────────────────
const bodyRef = ref<HTMLElement | null>(null);
const primaryBtnRef = ref<InstanceType<typeof OButton> | null>(null);

function handleOpenAutoFocus(event: Event) {
  event.preventDefault();
  nextTick(() => {
    const body = bodyRef.value;
    if (body) {
      const candidates = body.querySelectorAll<HTMLElement>(
        [
          'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([disabled])',
          'textarea:not([disabled])',
        ].join(', ')
      );
      const firstField = Array.from(candidates).find(
        (el) => !el.closest('.q-select, .o-select, [role="combobox"], [role="listbox"], [data-no-autofocus]')
      );
      if (firstField) {
        firstField.focus();
        return;
      }
    }
    // No form field found → focus primary button (confirm dialog pattern)
    const btnEl = (primaryBtnRef.value as any)?.$el as HTMLElement | undefined;
    if (btnEl) {
      btnEl.focus();
    }
  });
}

// ── Scroll shadow ────────────────────────────────────────────────────────────
const { canScrollUp, canScrollDown, update: updateShadow, attach: attachShadow, detach: detachShadow } = useScrollShadow(bodyRef);

watch(internalOpen, (open) => {
  if (open) {
    nextTick(() => {
      attachShadow();
      updateShadow();
    });
  } else {
    detachShadow();
  }
});
</script>

<template>
  <DialogRoot :open="internalOpen" @update:open="handleOpenChange">
    <!-- Trigger slot — omit when controlling exclusively via v-model:open -->
    <DialogTrigger v-if="hasTrigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <!-- Overlay / scrim -->
      <DialogOverlay
        :class="[
          'tw:fixed tw:inset-0 tw:z-5999',
          'tw:bg-dialog-overlay',
          'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0',
          'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0',
          'tw:duration-200',
        ]"
      />

      <!-- Dialog panel -->
      <DialogContent
        data-o2-dialog
        :data-test="parentDataTest || 'o-dialog-panel'"
        :style="contentStyle"
        :class="[
          // Positioning — centered in viewport
          'tw:fixed tw:left-1/2 tw:top-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2',
          // Stacking — above Quasar header (2000) and drawer (3000)
          'tw:z-6000',
          // Layout — flex-col so header/footer stick and only body scrolls
          'tw:flex tw:flex-col tw:overflow-hidden',
          // Size
          sizeClasses,
          // Non-full: cap height so the flex structure actually clips
          !isFullSize && 'tw:max-h-[90vh]',
          // Surface
          'tw:bg-dialog-bg tw:border tw:border-dialog-border',
          !isFullSize && 'tw:rounded-xl',
          'tw:shadow-dialog',
          // Typography
          'tw:text-dialog-content-text',
          // Focus ring
          'tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-dialog-focus-ring',
          // Animation
          'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0 tw:data-[state=open]:zoom-in-95',
          'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:zoom-out-95',
          'tw:duration-200',
        ]"
        @escape-key-down="handleEscapeKeyDown"
        @interact-outside="handleInteractOutside"
        @open-auto-focus="handleOpenAutoFocus"
      >
        <!--
          DialogTitle is ALWAYS rendered for accessibility.
          sr-only so Reka never throws an accessibility warning.
          The visible title in the header is a plain <span> to avoid <h2> browser styles.
        -->
        <DialogTitle class="tw:sr-only tw:absolute">
          {{ title ?? "Dialog" }}
        </DialogTitle>

        <!-- Required by Reka; hidden from view -->
        <DialogDescription class="tw:sr-only tw:absolute">
          {{ title ?? "Dialog" }}
        </DialogDescription>

        <!-- ── Header ───────────────────────────────────────── -->
        <div
          v-if="hasHeader"
          :class="[
            'tw:flex tw:items-center tw:gap-2 tw:shrink-0',
            'tw:px-(--spacing-dialog-header-px) tw:py-(--spacing-dialog-header-py)',
            'tw:bg-dialog-header-bg tw:text-dialog-header-text',
            'tw:border-b tw:border-dialog-header-border',
            !isFullSize && 'tw:rounded-t-xl',
          ]"
        >
          <!-- CASE 1: Full override — backward compat, sub-slots are ignored -->
          <div v-if="slots.header" class="tw:flex-1 tw:min-w-0">
            <slot name="header" />
          </div>

          <!-- CASE 2: Default / structured layout -->
          <template v-else>
            <!-- Title + subtitle block — fixed width, never grows -->
            <div v-if="title || subTitle" class="tw:shrink-0 tw:min-w-0">
              <span
                v-if="title"
                class="tw:text-lg tw:font-semibold tw:text-dialog-header-text tw:truncate tw:block"
              >
                {{ title }}
              </span>
              <span
                v-if="subTitle"
                class="tw:text-sm tw:text-dialog-content-text tw:opacity-70 tw:truncate tw:block tw:mt-0.5"
              >
                {{ subTitle }}
              </span>
            </div>

            <!-- #header-left sub-slot — grows to fill space, content flows left-to-right after title -->
            <div v-if="slots['header-left']" class="tw:flex-1 tw:min-w-0 tw:flex tw:items-center tw:justify-start tw:gap-2">
              <slot name="header-left" />
            </div>

            <!-- #header-right sub-slot — grows to fill space, content flows right-to-left before close button -->
            <div v-if="slots['header-right']" class="tw:flex-1 tw:min-w-0 tw:flex tw:items-center tw:justify-end tw:gap-2">
              <slot name="header-right" />
            </div>

            <!-- Spacer — when no sub-slots, push close button to right edge (preserves current layout) -->
            <div v-if="!slots['header-left'] && !slots['header-right']" class="tw:flex-1" />
          </template>

          <!-- Close button — shrink-0 so it is never squeezed out by header content -->
          <DialogClose v-if="showClose" as-child>
            <button
              type="button"
              aria-label="Close dialog"
              data-test="o-dialog-close-btn"
              @mousedown.prevent
              :class="[
                'tw:shrink-0 tw:flex tw:items-center tw:justify-center',
                'tw:h-7 tw:w-7 tw:rounded-md',
                'tw:text-dialog-close-text',
                'tw:hover:bg-dialog-close-hover-bg',
                'tw:active:bg-dialog-close-active-bg',
                'tw:transition-colors tw:duration-150',
                'tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-dialog-focus-ring',
                'tw:cursor-pointer',
              ]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </DialogClose>
        </div>

        <!-- ── Content (default slot) ───────────────────────── -->
        <!-- min-h-0 is required in some browsers for flex children to overflow correctly -->
        <!-- overflow-x-hidden prevents horizontal scrollbar when content is wider than dialog -->
        <!-- No flex-1: panel height = content height (capped at max-h), footer flows below body -->
        <div
          ref="bodyRef"
          :class="[
            'tw:min-h-0 tw:overflow-y-auto tw:overflow-x-hidden',
            'tw:px-(--spacing-dialog-content-px) tw:py-(--spacing-dialog-content-py)',
            'tw:text-dialog-content-text',
            canScrollUp && 'tw:[box-shadow:inset_0_8px_6px_-6px_rgba(0,0,0,0.1)]',
            canScrollDown && 'tw:[box-shadow:inset_0_-8px_6px_-6px_rgba(0,0,0,0.1)]',
            canScrollUp && canScrollDown && 'tw:[box-shadow:inset_0_8px_6px_-6px_rgba(0,0,0,0.1),inset_0_-8px_6px_-6px_rgba(0,0,0,0.1)]',
          ]"
          @focusin="handleBodyFocusIn"
        >
          <slot />
        </div>

        <!-- ── Footer ───────────────────────────────────────── -->
        <div
          v-if="hasFooter"
          :class="[
            'tw:shrink-0',
            'tw:px-(--spacing-dialog-footer-px) tw:py-(--spacing-dialog-footer-py)',
            'tw:bg-dialog-footer-bg',
            'tw:border-t tw:border-dialog-footer-border',
            !isFullSize && 'tw:rounded-b-xl',
          ]"
        >
          <!-- ── Built-in footer buttons ──────────────────────────────────────── -->
          <div
            v-if="!slots.footer"
            class="tw:flex tw:items-center tw:justify-between tw:gap-2"
          >
            <!-- Left: neutral button -->
            <div>
              <OButton
                v-if="neutralButtonLabel"
                data-test="o-dialog-neutral-btn"
                :variant="neutralButtonVariant"
                size="sm-action"
                :disabled="neutralEffectivelyDisabled"
                :loading="neutralButtonLoading"
                @click="emit('click:neutral')"
              >
                {{ neutralButtonLabel }}
              </OButton>
            </div>

            <!-- Right: secondary + primary -->
            <div class="tw:flex tw:items-center tw:gap-2">
              <OButton
                v-if="secondaryButtonLabel"
                data-test="o-dialog-secondary-btn"
                :variant="secondaryButtonVariant"
                size="sm-action"
                :disabled="secondaryEffectivelyDisabled"
                :loading="secondaryButtonLoading"
                @mousedown.prevent
                @click="emit('click:secondary')"
              >
                {{ secondaryButtonLabel }}
              </OButton>
              <OButton
                v-if="primaryButtonLabel"
                ref="primaryBtnRef"
                data-test="o-dialog-primary-btn"
                :variant="primaryButtonVariant"
                size="sm-action"
                :disabled="primaryEffectivelyDisabled"
                :loading="primaryButtonLoading"
                @click="emit('click:primary')"
              >
                {{ primaryButtonLabel }}
              </OButton>
            </div>
          </div>

          <!-- Custom footer slot (takes over entirely when provided) -->
          <slot v-else name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
