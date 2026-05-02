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
import { ref, watch, useSlots, computed } from "vue";

const props = withDefaults(defineProps<DialogProps>(), {
  persistent: false,
  size: "md",
  showClose: true,
  width: undefined,
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
  }
}

function handleInteractOutside(e: Event) {
  if (props.persistent) {
    e.preventDefault();
  }
}

// Header renders when there is a header slot, a title, OR a visible close button.
// This ensures the × always appears even in component-wrapper dialogs with no title.
const hasHeader = computed(
  () =>
    !!slots.header || !!props.title || (!props.persistent && props.showClose),
);
const hasFooter = computed(() => !!slots.footer);
const hasTrigger = computed(() => !!slots.trigger);

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
          <!--
            Content wrapper: flex-1 + min-w-0 ensures the title/slot fills
            available space and can truncate, keeping the close button always visible
            at the right edge regardless of header slot complexity.
          -->
          <div class="tw:flex-1 tw:min-w-0">
            <!-- Custom header slot takes the full available width -->
            <slot v-if="slots.header" name="header" />
            <!-- Plain title prop — use span to avoid browser h2/heading default styles -->
            <span
              v-else-if="title"
              class="tw:text-sm tw:font-semibold tw:text-dialog-header-text tw:truncate tw:block"
            >
              {{ title }}
            </span>
          </div>

          <!-- Close button — shrink-0 so it is never squeezed out by header content -->
          <DialogClose v-if="!persistent && showClose" as-child>
            <button
              type="button"
              aria-label="Close dialog"
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
        <div
          :class="[
            'tw:flex-1 tw:min-h-0 tw:overflow-y-auto tw:overflow-x-hidden',
            'tw:px-(--spacing-dialog-content-px) tw:py-(--spacing-dialog-content-py)',
            'tw:text-dialog-content-text',
          ]"
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
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
