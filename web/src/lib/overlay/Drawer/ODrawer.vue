<script setup lang="ts">
import type { DrawerProps, DrawerEmits, DrawerSlots } from "./ODrawer.types";
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
import { ref, watch, useSlots, computed, inject, provide } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";

const props = withDefaults(defineProps<DrawerProps>(), {
  persistent: false,
  side: "right",
  size: "md",
  showClose: true,
  width: undefined,
  seamless: false,
  primaryButtonVariant: "primary",
  secondaryButtonVariant: "secondary",
  neutralButtonVariant: "ghost",
  primaryButtonDisabled: false,
  secondaryButtonDisabled: false,
  neutralButtonDisabled: false,
  primaryButtonLoading: false,
  secondaryButtonLoading: false,
  neutralButtonLoading: false,
});

const emit = defineEmits<DrawerEmits>();

defineSlots<DrawerSlots>();

const slots = useSlots();

// Mirrors the same controlled/uncontrolled pattern as ODialog — Vue
// boolean-casts an absent `open` prop to `false`, locking reka-ui into
// controlled-closed mode, so we manage state internally.
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
    return;
  }

  // Prevent the drawer from closing when a pointer-down lands inside a portaled
  // floating element (e.g. a dropdown, select, combobox) that was opened from
  // within the drawer. Those elements are teleported to document.body and
  // therefore sit outside the DrawerContent DOM subtree, so reka-ui's
  // DismissableLayer fires interactOutside for them — which would wrongly dismiss
  // the drawer before the click on the item can register.
  const originalEvent = (
    e as CustomEvent & { detail?: { originalEvent?: PointerEvent } }
  ).detail?.originalEvent;
  const target = originalEvent?.target as Element | null;
  if (
    target?.closest("[data-reka-popper-content-wrapper]") || // reka-ui portals (ODropdown, OSelect, …)
    target?.closest(".q-menu") // Quasar portals (q-select, q-btn-dropdown, …)
  ) {
    e.preventDefault();
  }
}

// Stacking support: each nested ODrawer gets a higher z-index layer
const drawerDepth = inject<number>("o2DrawerDepth", 0);
provide("o2DrawerDepth", drawerDepth + 1);

const overlayZIndex = computed(() => 5999 + drawerDepth * 1000);
const contentZIndex = computed(() => 6000 + drawerDepth * 1000);

// Header renders when there is a header slot, a title, any sub-slot, OR a visible close button.
const hasHeader = computed(
  () =>
    !!slots.header ||
    !!slots["header-left"] ||
    !!slots["header-right"] ||
    !!props.title ||
    (!props.persistent && props.showClose),
);
const hasFooter = computed(
  () =>
    !!slots.footer ||
    !!props.primaryButtonLabel ||
    !!props.secondaryButtonLabel ||
    !!props.neutralButtonLabel,
);
const hasTrigger = computed(() => !!slots.trigger);
const isRight = computed(() => props.side !== "left");

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

// Width preset → CSS class
const sizeClasses = computed(() => {
  if (props.width) return "tw:max-w-none";
  switch (props.size) {
    case "sm":
      return "tw:w-[min(360px,100vw)]";
    case "md":
      return "tw:w-[min(480px,100vw)]";
    case "lg":
      return "tw:w-[min(640px,100vw)]";
    case "xl":
      return "tw:w-[min(800px,100vw)]";
    case "full":
      return "tw:w-screen";
    default:
      return "tw:w-[min(480px,100vw)]";
  }
});

// Explicit vw width override
const contentStyle = computed(() => {
  const style: Record<string, string | number> = {
    zIndex: contentZIndex.value,
  };
  if (props.width != null) style.width = `${props.width}vw`;
  return style;
});
</script>

<template>
  <DialogRoot :open="internalOpen" @update:open="handleOpenChange">
    <!-- Trigger slot — omit when controlling via v-model:open -->
    <DialogTrigger v-if="hasTrigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <!-- Overlay / scrim — same z-index as ODialog -->
      <DialogOverlay
        :class="[
          'tw:fixed tw:inset-0',
          seamless
            ? 'tw:bg-transparent tw:pointer-events-none'
            : 'tw:bg-dialog-overlay',
          'tw:data-[state=open]:animate-in tw:data-[state=open]:fade-in-0',
          'tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0',
          'tw:duration-200',
        ]"
        :style="{ zIndex: overlayZIndex }"
      />

      <!-- Drawer panel -->
      <DialogContent
        data-o2-drawer
        :style="contentStyle"
        :class="[
          // Full-height, anchored to chosen edge
          'tw:fixed tw:inset-y-0',
          isRight ? 'tw:right-0' : 'tw:left-0',
          // Flex column so header/footer are shrink-0 and body scrolls
          // max-h-screen (not h-screen): panel shrinks to content, footer flows below body on short content
          'tw:flex tw:flex-col tw:overflow-hidden tw:max-h-screen',
          sizeClasses,
          // Surface — reuse dialog tokens (same visual language)
          'tw:bg-dialog-bg tw:text-dialog-content-text',
          isRight
            ? 'tw:border-s tw:border-dialog-border'
            : 'tw:border-e tw:border-dialog-border',
          'tw:shadow-xl',
          // Focus ring
          'tw:outline-none tw:focus-visible:ring-2 tw:focus-visible:ring-dialog-focus-ring',
          // Slide-in animation — direction matches side
          isRight
            ? [
                'tw:data-[state=open]:animate-in tw:data-[state=open]:slide-in-from-right',
                'tw:data-[state=closed]:animate-out tw:data-[state=closed]:slide-out-to-right',
              ]
            : [
                'tw:data-[state=open]:animate-in tw:data-[state=open]:slide-in-from-left',
                'tw:data-[state=closed]:animate-out tw:data-[state=closed]:slide-out-to-left',
              ],
          'tw:duration-300',
        ]"
        @escape-key-down="handleEscapeKeyDown"
        @interact-outside="handleInteractOutside"
      >
        <!-- Accessibility: hidden title required by Reka UI -->
        <DialogTitle class="tw:sr-only tw:absolute">
          {{ title ?? "Drawer" }}
        </DialogTitle>
        <DialogDescription class="tw:sr-only tw:absolute">
          {{ title ?? "Drawer" }}
        </DialogDescription>

        <!-- ── Header ───────────────────────────────────────── -->
        <div
          v-if="hasHeader"
          :class="[
            'tw:flex tw:items-center tw:gap-2 tw:shrink-0',
            'tw:px-(--spacing-dialog-header-px) tw:py-(--spacing-dialog-header-py)',
            'tw:bg-dialog-header-bg tw:text-dialog-header-text',
            'tw:border-b tw:border-dialog-header-border',
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

            <!-- #header-left sub-slot — grows to fill space if present -->
            <div v-if="slots['header-left']" class="tw:flex-1 tw:min-w-0">
              <slot name="header-left" />
            </div>

            <!-- #header-right sub-slot — grows to fill space if present -->
            <div v-if="slots['header-right']" class="tw:flex-1 tw:min-w-0">
              <slot name="header-right" />
            </div>

            <!-- Spacer — when no sub-slots, push close button to right edge (preserves current layout) -->
            <div v-if="!slots['header-left'] && !slots['header-right']" class="tw:flex-1" />
          </template>

          <!-- Close button — always shrink-0 at the far right -->
          <DialogClose v-if="!persistent && showClose" as-child>
            <button
              type="button"
              aria-label="Close drawer"
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

        <!-- ── Content (scrollable body) ───────────────────── -->
        <!-- min-h-0 is required for flex children to overflow correctly -->
        <!-- No flex-1: panel shrinks to content, footer flows below body (not pinned to bottom) -->
        <div
          :class="[
            'tw:min-h-0 tw:overflow-y-auto tw:overflow-x-hidden',
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
                :variant="secondaryButtonVariant"
                size="sm-action"
                :disabled="secondaryEffectivelyDisabled"
                :loading="secondaryButtonLoading"
                @click="emit('click:secondary')"
              >
                {{ secondaryButtonLabel }}
              </OButton>
              <OButton
                v-if="primaryButtonLabel"
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
