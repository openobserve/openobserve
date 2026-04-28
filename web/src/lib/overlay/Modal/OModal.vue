<script setup lang="ts">
import type { ModalProps, ModalEmits, ModalSlots } from "./OModal.types";
import {
  DialogRoot,
  DialogTrigger,
  DialogPortal,
  DialogOverlay,
  DialogContent,
} from "reka-ui";
import { computed } from "vue";

const props = withDefaults(defineProps<ModalProps>(), {
  variant: "modal",
  size: "md",
  persistent: false,
});

const emit = defineEmits<ModalEmits>();

defineSlots<ModalSlots>();

function handleEscapeKeyDown(event: KeyboardEvent) {
  if (props.persistent) event.preventDefault();
}

function handleInteractOutside(event: Event) {
  if (props.persistent) event.preventDefault();
}

type ModalSizeKey = NonNullable<ModalProps["size"]>;

const MODAL_SIZE_CLASSES: Record<ModalSizeKey, string> = {
  sm: "tw:w-full tw:max-w-sm",
  md: "tw:w-full tw:max-w-lg",
  lg: "tw:w-full tw:max-w-2xl",
  xl: "tw:w-full tw:max-w-4xl",
  full: "tw:w-[calc(100vw-2rem)] tw:h-[calc(100vh-2rem)]",
};

const DRAWER_SIZE_CLASSES: Record<ModalSizeKey, string> = {
  sm: "tw:w-80",
  md: "tw:w-96",
  lg: "tw:w-[560px] tw:max-w-full",
  xl: "tw:w-[720px] tw:max-w-full",
  full: "tw:w-full",
};

const contentClasses = computed<string[]>(() => {
  const size = props.size ?? "md";

  if (props.variant === "drawer") {
    return [
      "tw:z-[10000]",
      "tw:fixed tw:inset-y-0 tw:end-0",
      "tw:bg-modal-bg tw:border-s tw:border-modal-border tw:shadow-xl",
      "tw:flex tw:flex-col tw:overflow-hidden tw:outline-none",
      DRAWER_SIZE_CLASSES[size],
      "tw:data-[state=open]:animate-in tw:data-[state=open]:slide-in-from-right",
      "tw:data-[state=closed]:animate-out tw:data-[state=closed]:slide-out-to-right",
      "tw:duration-300",
    ];
  }

  return [
    "tw:z-[10000]",
    "tw:fixed tw:left-1/2 tw:top-1/2 tw:-translate-x-1/2 tw:-translate-y-1/2",
    "tw:bg-modal-bg tw:rounded-xl tw:shadow-xl",
    "tw:flex tw:flex-col tw:overflow-hidden tw:outline-none",
    "tw:max-h-[calc(100vh-4rem)]",
    MODAL_SIZE_CLASSES[size],
    "tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0 tw:data-[state=open]:zoom-in-95",
    "tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=closed]:zoom-out-95",
    "tw:duration-200",
  ];
});
</script>

<template>
  <DialogRoot
    :open="open"
    @update:open="(v) => emit('update:open', v)"
  >
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay
        :class="[
          'tw:fixed tw:inset-0 tw:z-[9999] tw:bg-black/50',
          'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0',
          'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0',
          'tw:duration-200',
        ]"
      />
      <DialogContent
        :class="contentClasses"
        @escape-key-down="handleEscapeKeyDown"
        @interact-outside="handleInteractOutside"
      >
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
