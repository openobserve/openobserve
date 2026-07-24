<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

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
import {
  ref,
  watch,
  watchEffect,
  useSlots,
  computed,
  nextTick,
  useAttrs,
  inject,
  provide,
} from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { useScrollShadow } from "@/lib/overlay/useScrollShadow";
import { FORM_SUBMIT_STATE_KEY } from "@/lib/forms/Form/OForm.types";
import { isInputFocused } from "@/utils/keyboardShortcuts";

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
// Forward the consumer's `data-test` from <ODialog data-test="…"> onto the
// rendered panel so e2e selectors can scope to the specific dialog instance
// using the pattern: [data-test="<parent>"] [data-test="o-dialog-*-btn"].
// (DialogRoot is renderless, so default attribute inheritance would lose it.)
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

// Stacking support: each nested ODialog gets a higher z-index layer
const dialogDepth = inject<number>("o2DialogDepth", 0);
provide("o2DialogDepth", dialogDepth + 1);

// Auto loading: an OForm nested in the body (linked via `form-id`) mirrors its
// `isSubmitting` into this ref, so the footer Save button shows its spinner
// during an awaited @submit handler — no `:primary-button-loading` needed.
const formSubmitting = ref(false);
provide(FORM_SUBMIT_STATE_KEY, formSubmitting);

const overlayZIndex = computed(() => 5999 + dialogDepth * 1000);
const contentZIndex = computed(() => 6000 + dialogDepth * 1000);

const props = withDefaults(defineProps<DialogProps>(), {
  persistent: false,
  size: "md",
  showClose: true,
  width: undefined,
  maxHeight: undefined,
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
  handleOpenChange(false);
}

// Modal keystroke containment. When focus sits on a non-field element inside
// the dialog (a footer button, the panel itself after clicking empty space),
// a bare printable key would bubble to the window-level shortcut manager and
// fire page shortcuts on top of the open modal (e.g. logs "s" opening Saved
// Views over Saved Functions). Swallow those here. Keys typed in input-like
// elements pass through untouched (the shortcut manager already ignores
// them), as do modifier combos (Ctrl/⌘ shortcuts stay app-wide by design) and
// non-printable keys — Escape must keep reaching reka's dismiss layer.
function handleContentKeydown(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key.length !== 1) return;
  if (isInputFocused(e.target)) return;
  e.stopPropagation();
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

// Size → Tailwind classes
const sizeClasses = computed(() => {
  // When an explicit width is supplied, skip max-w presets (full-screen is the exception)
  if (props.width) {
    return props.size === "full" ? "w-screen h-screen max-w-none rounded-none" : "max-w-none";
  }
  switch (props.size) {
    case "xs":
      return "max-w-[min(320px,calc(100vw-2rem))] w-full";
    case "sm":
      return "max-w-[min(480px,calc(100vw-2rem))] w-full";
    case "md":
      return "max-w-[min(640px,calc(100vw-2rem))] w-full";
    case "lg":
      return "max-w-[min(800px,calc(100vw-2rem))] w-full";
    case "xl":
      return "max-w-[min(1024px,calc(100vw-2rem))] w-full";
    case "full":
      return "w-screen h-screen max-w-none rounded-none";
    default:
      return "max-w-[min(640px,calc(100vw-2rem))] w-full";
  }
});

const isFullSize = computed(() => props.size === "full");

// Inline style for explicit width/maxHeight override
const contentStyle = computed(() => {
  const style: Record<string, string> = {};
  if (props.width != null) style.width = `${props.width}vw`;
  if (props.maxHeight != null) style.maxHeight = `${props.maxHeight}vh`;
  return Object.keys(style).length ? style : undefined;
});

// ── Auto-focus logic ─────────────────────────────────────────────────────────
const bodyRef = ref<HTMLElement | null>(null);
const primaryBtnRef = ref<InstanceType<typeof OButton> | null>(null);

// Text fields take priority; a select/combobox trigger (OSelect listbox
// trigger, reka SelectTrigger) is the second tier so a dialog whose
// only field is a select still keeps keyboard focus on a field — otherwise
// keystrokes land on a plain button and leak to page-level single-letter
// shortcuts (e.g. "s" on logs opening Save View over an open dialog).
const AUTOFOCUS_TEXT_FIELDS = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([disabled])',
  "textarea:not([disabled])",
].join(", ");
const AUTOFOCUS_COMBOBOX = '[role="combobox"]:not([disabled]):not([aria-disabled="true"])';
const AUTOFOCUS_ANY_FIELD = `${AUTOFOCUS_TEXT_FIELDS}, ${AUTOFOCUS_COMBOBOX}`;

function findAutoFocusTarget(root: Element): HTMLElement | null {
  const scan = (selector: string): HTMLElement[] => {
    const nested = Array.from(root.querySelectorAll<HTMLElement>(selector));
    return root.matches(selector) ? [root as HTMLElement, ...nested] : nested;
  };
  const textField = scan(AUTOFOCUS_TEXT_FIELDS).find(
    (el) => !el.closest('.o-select, [role="combobox"], [role="listbox"], [data-no-autofocus]'),
  );
  if (textField) return textField;
  return scan(AUTOFOCUS_COMBOBOX).find((el) => !el.closest("[data-no-autofocus]")) ?? null;
}

function handleOpenAutoFocus(event: Event) {
  event.preventDefault();
  nextTick(() => {
    const body = bodyRef.value;
    const field = body ? findAutoFocusTarget(body) : null;
    if (field) {
      field.focus();
      return;
    }
    // No form field found → focus primary button (confirm dialog pattern)
    const btnEl = (primaryBtnRef.value as any)?.$el as HTMLElement | undefined;
    if (btnEl) {
      btnEl.focus();
    }
  });
}

// ── Focus repair on body content swaps ───────────────────────────────────────
// A v-if/v-else swap inside the body (e.g. a Create/Update toggle replacing an
// input with a select) leaves focus on whatever was clicked — a toggle button
// — or drops it to <body> when the focused field itself was removed. Either
// way the next keystroke bypasses the input-focus guard and fires page-level
// single-letter shortcuts. When a mutation batch both removes and adds fields,
// move focus to the first field of the newly added content — unless the user
// is still focused in a field that survived the swap.
watchEffect((cleanup) => {
  if (!internalOpen.value) return;
  const body = bodyRef.value;
  if (!body) return;

  const containsField = (node: Node): node is Element =>
    node instanceof Element &&
    (node.matches(AUTOFOCUS_ANY_FIELD) || !!node.querySelector(AUTOFOCUS_ANY_FIELD));

  const observer = new MutationObserver((records) => {
    const added = records.flatMap((r) => Array.from(r.addedNodes)).filter(containsField);
    const removedField = records.flatMap((r) => Array.from(r.removedNodes)).some(containsField);
    if (!added.length || !removedField) return;

    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      body.contains(active) &&
      active.matches(AUTOFOCUS_ANY_FIELD)
    ) {
      return;
    }

    nextTick(() => {
      for (const el of added) {
        if (!el.isConnected) continue;
        const field = findAutoFocusTarget(el);
        if (field) {
          field.focus();
          return;
        }
      }
    });
  });
  observer.observe(body, { childList: true, subtree: true });
  cleanup(() => observer.disconnect());
});

// ── Focus-trap workaround for portaled elements ─────────────────────────────
// Same workaround as ODrawer — see the comment block there for full rationale.
// Intercepts both focusin and focusout on document.body so FocusScope's
// document-level handlers never fire when focus moves to/from a portaled
// reka-ui element (ODropdown, OSelect listbox, etc.).
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
    <!-- Trigger slot — omit when controlling exclusively via v-model:open -->
    <DialogTrigger v-if="hasTrigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <!-- Overlay / scrim -->
      <DialogOverlay
        data-test="o-dialog-overlay"
        :style="{ zIndex: overlayZIndex }"
        :class="[
          'fixed inset-0',
          'bg-dialog-overlay',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          'data-[state=closed]:duration-90 data-[state=open]:duration-110',
        ]"
      />

      <!-- Dialog panel -->
      <DialogContent
        data-o2-dialog
        :data-test="parentDataTest || 'o-dialog-panel'"
        :style="[contentStyle, { zIndex: contentZIndex }]"
        :class="[
          // Positioning — centered in viewport.
          // Centering uses the standalone `translate` CSS property (not the
          // `transform`-based -translate utilities) so the zoom animation —
          // which drives `transform` — composes cleanly and the panel scales
          // from true center instead of sliding diagonally.
          'fixed top-1/2 left-1/2 [translate:-50%_-50%]',
          // Layout — flex-col so header/footer stick and only body scrolls
          'flex flex-col overflow-hidden',
          // Size
          sizeClasses,
          // Non-full: cap height so the flex structure actually clips
          !isFullSize && 'max-h-[90vh]',
          // Surface
          'bg-dialog-bg border-dialog-border border',
          !isFullSize && 'rounded-surface',
          'shadow-dialog',
          // Typography
          'text-dialog-content-text',
          // Focus ring
          'focus-visible:ring-dialog-focus-ring outline-none focus-visible:ring-2',
          // Animation — single-direction rise: slides up from ~24px below while
          // fading in, soft ease-out-expo settle (150ms); fades + drops back out
          // (100ms). No scale, so nothing squishes — it just glides into place.
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-6',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-2',
          'data-[state=open]:duration-150 data-[state=open]:ease-[cubic-bezier(0.16,1,0.3,1)]',
          'data-[state=closed]:duration-100 data-[state=closed]:ease-in',
        ]"
        @escape-key-down="handleEscapeKeyDown"
        @interact-outside="handleInteractOutside"
        @open-auto-focus="handleOpenAutoFocus"
        @keydown="handleContentKeydown"
      >
        <!--
          DialogTitle is ALWAYS rendered for accessibility.
          sr-only so Reka never throws an accessibility warning.
          The visible title in the header is a plain <span> to avoid <h2> browser styles.
        -->
        <DialogTitle class="sr-only absolute">
          {{ title ?? "Dialog" }}
        </DialogTitle>

        <!-- Required by Reka; hidden from view -->
        <DialogDescription class="sr-only absolute">
          {{ title ?? "Dialog" }}
        </DialogDescription>

        <!-- ── Header ───────────────────────────────────────── -->
        <div
          v-if="hasHeader"
          :class="[
            'flex shrink-0 items-center gap-2',
            'px-dialog-header-px py-dialog-header-py',
            'bg-dialog-header-bg text-dialog-header-text',
            'border-dialog-header-border border-b',
            !isFullSize && 'rounded-t-surface',
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
              >
                {{ title }}
              </span>
              <span
                v-if="subTitle"
                class="text-dialog-content-text mt-0.5 block truncate text-sm opacity-70"
              >
                {{ subTitle }}
              </span>
            </div>

            <!-- #header-left sub-slot — grows to fill space, content flows left-to-right after title -->
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

          <!-- Close button — shrink-0 so it is never squeezed out by header content -->
          <DialogClose v-if="showClose" as-child>
            <button
              type="button"
              aria-label="Close dialog"
              data-test="o-dialog-close-btn"
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

        <!-- ── Content (default slot) ───────────────────────── -->
        <!-- min-h-0 is required in some browsers for flex children to overflow correctly -->
        <!-- overflow-x-hidden prevents horizontal scrollbar when content is wider than dialog -->
        <!-- full-size: flex-1 so the body fills the remaining viewport height; content manages its own scroll -->
        <!-- non-full: no flex-1 — panel height = content height (capped at max-h), footer flows below body -->
        <div
          ref="bodyRef"
          :class="[
            'min-h-0 overflow-x-hidden',
            isFullSize ? 'flex-1 overflow-hidden p-0' : 'overflow-y-auto',
            !isFullSize && 'px-dialog-content-px py-dialog-content-py',
            'text-dialog-content-text',
            !isFullSize && canScrollUp && '[box-shadow:inset_0_8px_6px_-6px_rgba(0,0,0,0.1)]',
            !isFullSize && canScrollDown && '[box-shadow:inset_0_-8px_6px_-6px_rgba(0,0,0,0.1)]',
            !isFullSize &&
              canScrollUp &&
              canScrollDown &&
              '[box-shadow:inset_0_8px_6px_-6px_rgba(0,0,0,0.1),inset_0_-8px_6px_-6px_rgba(0,0,0,0.1)]',
          ]"
        >
          <slot />
        </div>

        <!-- ── Footer ───────────────────────────────────────── -->
        <div
          v-if="hasFooter"
          :class="[
            'shrink-0',
            'px-dialog-footer-px py-dialog-footer-py',
            'bg-dialog-footer-bg',
            'border-dialog-footer-border border-t',
            !isFullSize && 'rounded-b-surface',
          ]"
        >
          <!-- ── Built-in footer buttons ──────────────────────────────────────── -->
          <div v-if="!slots.footer" class="flex items-center justify-between gap-2">
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
            <div class="flex items-center gap-2">
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
