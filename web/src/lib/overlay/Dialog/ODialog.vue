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

const hasHeader = computed(() => !!slots.header || !!props.title);
const hasFooter = computed(() => !!slots.footer);
const hasTrigger = computed(() => !!slots.trigger);

// Size → Tailwind classes
const sizeClasses = computed(() => {
  switch (props.size) {
    case "xs":
      return "tw:max-w-[320px] tw:w-full";
    case "sm":
      return "tw:max-w-[480px] tw:w-full";
    case "md":
      return "tw:max-w-[640px] tw:w-full";
    case "lg":
      return "tw:max-w-[800px] tw:w-full";
    case "xl":
      return "tw:max-w-[1024px] tw:w-full";
    case "full":
      return "tw:w-screen tw:h-screen tw:max-w-none tw:rounded-none";
    default:
      return "tw:max-w-[640px] tw:w-full";
  }
});

const isFullSize = computed(() => props.size === "full");
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
          'tw:fixed tw:inset-0 tw:z-[5999]',
          'tw:bg-dialog-overlay',
          'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0',
          'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0',
          'tw:duration-200',
        ]"
      />

      <!-- Dialog panel -->
      <DialogContent
        data-o2-dialog
        :class="[
          // Positioning — centered in viewport
          'tw:fixed tw:left-1/2 tw:top-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2',
          // Stacking — above Quasar header (2000) and drawer (3000)
          'tw:z-[6000]',
          // Layout
          'tw:flex tw:flex-col',
          // Size
          sizeClasses,
          // Non-full: max height with scroll
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
          When the header slot is used it is visually hidden (sr-only).
          When neither header slot nor title prop are provided it is also hidden.
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
            'tw:flex tw:items-center tw:justify-between tw:shrink-0',
            'tw:px-(--spacing-dialog-header-px) tw:py-(--spacing-dialog-header-py)',
            'tw:bg-dialog-header-bg tw:text-dialog-header-text',
            'tw:border-b tw:border-dialog-header-border',
            !isFullSize && 'tw:rounded-t-xl',
          ]"
        >
          <!-- Custom header slot or title prop -->
          <slot v-if="slots.header" name="header" />
          <DialogTitle
            v-else
            class="tw:text-base tw:font-semibold tw:text-dialog-header-text"
          >
            {{ title }}
          </DialogTitle>

          <!-- Close button (not shown in persistent mode) -->
          <DialogClose v-if="!persistent && showClose" as-child>
            <button
              type="button"
              aria-label="Close dialog"
              :class="[
                'tw:ml-auto tw:flex tw:items-center tw:justify-center',
                'tw:h-7 tw:w-7 tw:rounded-md',
                'tw:text-dialog-close-text',
                'tw:hover:bg-dialog-close-hover-bg',
                'tw:active:bg-dialog-close-active-bg',
                'tw:transition-colors tw:duration-150',
                'tw:focus-visible:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-dialog-focus-ring',
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
        <div
          :class="[
            'tw:flex-1 tw:overflow-y-auto',
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
