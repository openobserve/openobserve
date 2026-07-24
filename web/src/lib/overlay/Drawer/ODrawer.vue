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
import {
  ref,
  watch,
  watchEffect,
  useSlots,
  computed,
  inject,
  provide,
  nextTick,
  useAttrs,
} from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useScrollShadow } from "@/lib/overlay/useScrollShadow";
import { FORM_SUBMIT_STATE_KEY } from "@/lib/forms/Form/OForm.types";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
// Forward the consumer's `data-test` from <ODrawer data-test="…"> onto the
// rendered panel so e2e selectors can scope to the specific drawer instance via
// [data-test="<parent>"] [data-test="o-drawer-*-btn"].
// (DialogRoot is renderless, so default attribute inheritance would lose it.)
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const props = withDefaults(defineProps<DrawerProps>(), {
  persistent: false,
  side: "right",
  size: "md",
  bleed: false,
  showClose: true,
  width: undefined,
  seamless: false,
  primaryButtonVariant: "primary",
  secondaryButtonVariant: "outline",
  neutralButtonVariant: "ghost",
  primaryButtonDisabled: false,
  secondaryButtonDisabled: false,
  neutralButtonDisabled: false,
  primaryButtonLoading: false,
  secondaryButtonLoading: false,
  neutralButtonLoading: false,
  lazy: true,
  portalTarget: undefined,
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
    return;
  }
  handleOpenChange(false);
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
  const originalEvent = (e as CustomEvent & { detail?: { originalEvent?: PointerEvent } }).detail
    ?.originalEvent;
  const target = originalEvent?.target as Element | null;
  if (
    target?.closest("[data-reka-popper-content-wrapper]") // reka-ui portals (ODropdown, OSelect, …)
  ) {
    e.preventDefault();
    return;
  }
}

// Stacking support: each nested ODrawer gets a higher z-index layer
const drawerDepth = inject<number>("o2DrawerDepth", 0);
provide("o2DrawerDepth", drawerDepth + 1);

// Auto loading: an OForm nested in the body (linked via `form-id`) mirrors its
// `isSubmitting` into this ref, so the footer Save button shows its spinner
// during an awaited @submit handler — no `:primary-button-loading` needed.
const formSubmitting = ref(false);
provide(FORM_SUBMIT_STATE_KEY, formSubmitting);

const overlayZIndex = computed(() => 5999 + drawerDepth * 1000);
const contentZIndex = computed(() => 6000 + drawerDepth * 1000);

// Header renders when there is a header slot, a title, any sub-slot, OR a visible close button.
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
const isRight = computed(() => props.side !== "left");

// Fixed body inset (same token as ODialog's body) unless `bleed` is set. One
// value app-wide → every drawer's content aligns identically. See the `bleed` prop.
const bodyPaddingClass = computed(() =>
  props.bleed ? "" : "px-dialog-content-px py-dialog-content-py",
);

// The primary button is loading when the consumer says so OR a nested OForm is
// mid-submit (auto). Kept as a computed so the disabled logic below picks it up.
const primaryLoading = computed(() => props.primaryButtonLoading || formSubmitting.value);

// Auto-disable all buttons when any one of them is loading
const anyButtonLoading = computed(
  () => primaryLoading.value || props.secondaryButtonLoading || props.neutralButtonLoading,
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
  if (props.width) return "max-w-none";
  switch (props.size) {
    case "sm":
      return "w-[min(360px,100vw)]";
    case "md":
      return "w-[min(480px,100vw)]";
    case "lg":
      return "w-[min(640px,100vw)]";
    case "xl":
      return "w-[min(800px,100vw)]";
    case "full":
      return "w-screen";
    default:
      return "w-[min(480px,100vw)]";
  }
});

// When portaled into a specific container, use absolute positioning scoped to that element.
const isContained = computed(() => !!props.portalTarget);

// Explicit width override — vw when full-viewport, % when container-scoped
const contentStyle = computed(() => {
  const style: Record<string, string | number> = {
    zIndex: contentZIndex.value,
  };
  if (props.width != null) {
    style.width = isContained.value ? `${props.width}%` : `${props.width}vw`;
  }
  return style;
});

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
          "textarea:not([disabled])",
        ].join(", "),
      );
      const firstField = Array.from(candidates).find(
        (el) => !el.closest('.o-select, [role="combobox"], [role="listbox"], [data-no-autofocus]'),
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

// ── Focus-trap workaround for portaled elements ─────────────────────────────
// reka-ui's modal DialogContent wraps content in a FocusScope that listens for
// both `focusin` AND `focusout` on `document` (bubble phase) and pulls focus
// back whenever it moves outside the DrawerContent DOM. reka-ui portals
// (ODropdown, OSelect listbox, …) are teleported to <body> and therefore sit
// outside the FocusScope container.
//
// The `focusout` handler fires FIRST (when focus leaves the dialog) and checks
// `relatedTarget` — if it's outside the container it immediately steals focus
// back, so the `focusin` on the portal element never even gets a chance.
//
// Fix: while the drawer is open, intercept both events on `document.body` and
// call `stopPropagation()` for events involving a known portal wrapper.  Since
// body is below document in the DOM, this prevents the events from reaching
// FocusScope's document-level handlers.
watchEffect((cleanup) => {
  if (!internalOpen.value) return;

  function isPortalElement(el: Element | null): boolean {
    return !!el?.closest("[data-reka-popper-content-wrapper]");
  }

  const handleFocusIn = (e: FocusEvent) => {
    if (isPortalElement(e.target as Element | null)) {
      e.stopPropagation();
    }
  };

  // focusout fires when focus LEAVES an element; relatedTarget is where
  // focus is moving TO.  If it's heading to a portal, stop propagation so
  // FocusScope's handleFocusOut doesn't steal it back.
  const handleFocusOut = (e: FocusEvent) => {
    if (isPortalElement(e.relatedTarget as Element | null)) {
      e.stopPropagation();
    }
  };

  document.body.addEventListener("focusin", handleFocusIn);
  document.body.addEventListener("focusout", handleFocusOut);
  cleanup(() => {
    document.body.removeEventListener("focusin", handleFocusIn);
    document.body.removeEventListener("focusout", handleFocusOut);
  });
});

// ── Scroll shadow ────────────────────────────────────────────────────────────
const {
  canScrollUp,
  canScrollDown,
  update: updateShadow,
  attach: attachShadow,
  detach: detachShadow,
} = useScrollShadow(bodyRef);

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
    <!-- Trigger slot — omit when controlling via v-model:open -->
    <DialogTrigger v-if="hasTrigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal :to="props.portalTarget ?? 'body'">
      <!-- Overlay / scrim — same z-index as ODialog -->
      <DialogOverlay
        data-test="o-drawer-overlay"
        :class="[
          isContained ? 'absolute inset-0' : 'fixed inset-0',
          seamless ? 'pointer-events-none bg-transparent' : 'bg-dialog-overlay',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          'data-[state=closed]:duration-120 data-[state=open]:duration-120',
        ]"
        :style="{ zIndex: overlayZIndex }"
      />

      <!-- Drawer panel -->
      <DialogContent
        data-o2-drawer
        :data-test="parentDataTest || 'o-drawer-panel'"
        :style="contentStyle"
        :class="[
          // Full-height, anchored to chosen edge
          isContained ? 'absolute inset-y-0' : 'fixed inset-y-0',
          isRight ? 'right-0' : 'left-0',
          // Flex column so header/footer are shrink-0 and body scrolls
          isContained
            ? 'flex h-full flex-col overflow-hidden'
            : 'flex max-h-screen flex-col overflow-hidden',
          sizeClasses,
          // Surface — reuse dialog tokens (same visual language)
          'bg-dialog-bg text-dialog-content-text',
          isRight
            ? 'border-dialog-border border-s border-t'
            : 'border-dialog-border border-e border-t',
          'shadow-lg',
          // Focus ring
          'focus-visible:ring-dialog-focus-ring outline-none focus-visible:ring-2',
          // Slide-in animation — direction matches side.
          // Strong decel curve so it shoots in (170ms) and settles; exit is quicker (120ms).
          isRight
            ? [
                'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
                'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
              ]
            : [
                'data-[state=open]:animate-in data-[state=open]:slide-in-from-left',
                'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left',
              ],
          'data-[state=open]:duration-170 data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)]',
          'data-[state=closed]:duration-120 data-[state=closed]:ease-in',
        ]"
        @escape-key-down="handleEscapeKeyDown"
        @interact-outside="handleInteractOutside"
        @open-auto-focus="handleOpenAutoFocus"
      >
        <!-- Accessibility: hidden title required by Reka UI -->
        <DialogTitle class="sr-only absolute">
          {{ title ?? "Drawer" }}
        </DialogTitle>
        <DialogDescription class="sr-only absolute">
          {{ title ?? "Drawer" }}
        </DialogDescription>

        <!-- ── Header ───────────────────────────────────────── -->
        <div
          v-if="hasHeader"
          :class="[
            'flex shrink-0 items-center gap-2',
            'px-dialog-header-px py-dialog-header-py',
            'bg-dialog-header-bg text-dialog-header-text',
            'border-dialog-header-border border-b',
          ]"
        >
          <!-- CASE 1: Full override — backward compat, sub-slots are ignored -->
          <div v-if="slots.header" class="min-w-0 flex-1">
            <slot name="header" />
          </div>

          <!-- CASE 2: Default / structured layout -->
          <template v-else>
            <!-- Title + subtitle block — fixed width, never grows -->
            <div v-if="title || subTitle" class="min-w-0 shrink-0">
              <span
                v-if="title"
                class="text-dialog-header-text block truncate text-base font-semibold"
                :data-test="titleDataTest"
              >
                {{ title }}
                <!-- Full title on hover (styled), so a truncated title is never lost. -->
                <OTooltip :content="title" />
              </span>
              <span
                v-if="subTitle"
                class="text-dialog-content-text mt-0.5 block truncate text-xs opacity-70"
              >
                {{ subTitle }}
              </span>
            </div>

            <!-- #header-left sub-slot — grows to fill space if present -->
            <div
              v-if="slots['header-left']"
              class="flex min-w-0 flex-1 items-center justify-start gap-2"
            >
              <slot name="header-left" />
            </div>

            <!-- Spacer — fills gap when #header-left is absent; pushes header-right toward the close button -->
            <div v-if="!slots['header-left']" class="flex-1" />

            <!-- #header-right sub-slot — shrinks to content width, anchored just before the close button -->
            <div v-if="slots['header-right']" class="flex shrink-0 items-center gap-2">
              <slot name="header-right" />
            </div>
          </template>

          <!-- Close button — always shrink-0 at the far right -->
          <DialogClose v-if="showClose" as-child>
            <button
              type="button"
              :aria-label="t('components.drawer.closeDrawer')"
              data-test="o-drawer-close-btn"
              @mousedown.prevent
              :class="[
                'flex shrink-0 items-center justify-center',
                'rounded-default h-7 w-7',
                'text-dialog-close-text',
                'hover:bg-dialog-close-hover-bg',
                'active:bg-dialog-close-active-bg',
                'transition-colors duration-150',
                'focus-visible:ring-dialog-focus-ring focus-visible:ring-2 focus-visible:outline-none',
                'cursor-pointer',
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
        <!-- flex-1 + min-h-0: body fills remaining height so the footer always sticks to the bottom -->
        <div
          ref="bodyRef"
          :class="[
            'min-h-0 flex-1 overflow-x-hidden overflow-y-auto',
            'text-dialog-content-text',
            bodyPaddingClass,
            canScrollUp && '[box-shadow:inset_0_8px_6px_-6px_rgba(0,0,0,0.1)]',
            canScrollDown && '[box-shadow:inset_0_-8px_6px_-6px_rgba(0,0,0,0.1)]',
            canScrollUp &&
              canScrollDown &&
              '[box-shadow:inset_0_8px_6px_-6px_rgba(0,0,0,0.1),inset_0_-8px_6px_-6px_rgba(0,0,0,0.1)]',
          ]"
        >
          <template v-if="!props.lazy || internalOpen">
            <slot />
          </template>
        </div>

        <!-- ── Footer ───────────────────────────────────────── -->
        <div
          v-if="hasFooter"
          :class="[
            'shrink-0',
            'px-dialog-footer-px py-dialog-footer-py',
            'bg-dialog-footer-bg',
            'border-dialog-footer-border border-t',
            'border-dialog-footer-border border-b',
          ]"
        >
          <!-- ── Built-in footer buttons ──────────────────────────────────────── -->
          <div v-if="!slots.footer" class="flex items-center justify-between gap-2">
            <!-- Left: neutral button -->
            <div>
              <OButton
                v-if="neutralButtonLabel"
                data-test="o-drawer-neutral-btn"
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
            <div class="flex items-center gap-2">
              <OButton
                v-if="secondaryButtonLabel"
                data-test="o-drawer-secondary-btn"
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
                data-test="o-drawer-primary-btn"
                :variant="primaryButtonVariant"
                size="sm-action"
                :type="formId ? 'submit' : 'button'"
                :form="formId || undefined"
                :disabled="primaryEffectivelyDisabled"
                :loading="primaryLoading"
                @click="!formId && emit('click:primary')"
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
