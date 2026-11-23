<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import { DIALOG_DEPTH_KEY } from "./dialogStacking";
import type { DialogProps, DialogEmits, DialogSlots } from "./ODialog.types";
import {
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
  onActivated,
  onDeactivated,
} from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OOverlayFooter from "@/lib/overlay/shared/OOverlayFooter.vue";
import { blockMultiFieldEnter, useDismissGuard } from "@/lib/overlay/shared/useDismissGuard";
import { useScrollShadow } from "@/lib/overlay/useScrollShadow";
import { FORM_DIRTY_STATE_KEY, FORM_SUBMIT_STATE_KEY } from "@/lib/forms/Form/OForm.types";
import { isInputFocused } from "@/utils/keyboardShortcuts";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
// DialogRoot is renderless, so the consumer's data-test is forwarded to the panel by hand.
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const dialogDepth = inject<number>(DIALOG_DEPTH_KEY, 0);
provide(DIALOG_DEPTH_KEY, dialogDepth + 1);

// A nested OForm linked by `form-id` mirrors its submit and edit state here.
const formSubmitting = ref(false);
provide(FORM_SUBMIT_STATE_KEY, formSubmitting);
const formDirty = ref(false);
provide(FORM_DIRTY_STATE_KEY, formDirty);

const overlayZIndex = computed(() => 5999 + dialogDepth * 1000);
const contentZIndex = computed(() => 6000 + dialogDepth * 1000);

const props = withDefaults(defineProps<DialogProps>(), {
  open: undefined,
  dirty: false,
  persistent: false,
  size: "md",
  showClose: true,
});

const emit = defineEmits<DialogEmits>();

defineSlots<DialogSlots>();

const slots = useSlots();

// An absent `open` would otherwise lock reka in controlled-closed mode, so state lives here.
const internalOpen = ref(props.open ?? false);

watch(
  () => props.open,
  (v) => {
    if (v !== undefined) internalOpen.value = v;
  },
);

// A kept-alive view's portal stays in <body> when the view is away, so it hides then and returns open.
const hostAway = ref(false);
const shown = computed(() => internalOpen.value && !hostAway.value);

// Remounting on return re-records focus from wherever navigation left it, so keep the opener.
let openedFrom: HTMLElement | null = null;
let awaySinceOpen = false;
watch(
  internalOpen,
  (open) => {
    if (!open) return;
    openedFrom = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    awaySinceOpen = false;
  },
  { immediate: true },
);
onDeactivated(() => {
  hostAway.value = true;
  if (internalOpen.value && !shown.value) awaySinceOpen = true;
});
onActivated(() => (hostAway.value = false));

function handleCloseAutoFocus(event: Event) {
  if (hostAway.value || awaySinceOpen) event.preventDefault();
  if (hostAway.value || !awaySinceOpen) return;
  awaySinceOpen = false;
  if (openedFrom?.isConnected) openedFrom.focus();
}

function setOpen(v: boolean) {
  internalOpen.value = v;
  emit("update:open", v);
}

const busy = computed(
  () =>
    formSubmitting.value ||
    !!props.primary?.loading ||
    !!props.secondary?.loading ||
    !!props.extra?.loading,
);

const guard = useDismissGuard({
  dirty: () => props.dirty || formDirty.value,
  locked: () => props.persistent || busy.value,
  close: () => setOpen(false),
});
const asking = guard.asking;

watch(internalOpen, (open) => {
  if (!open) guard.keepEditing();
});

function handleOpenChange(v: boolean) {
  if (v) setOpen(true);
  else guard.requestDismiss();
}

function discardAndClose() {
  emit("discard");
  guard.discard();
}

// Escape pressed inside an open dropdown or select belongs to that popup, not the dialog.
const ESCAPE_OWNED_BY_POPUP = "[data-reka-popper-content-wrapper]";

function handleEscapeKeyDown(e: KeyboardEvent) {
  e.preventDefault();
  const target = e.target instanceof Element ? e.target : null;
  if (target?.closest(ESCAPE_OWNED_BY_POPUP)) return;
  guard.requestDismiss();
}

// A bare printable key on a non-field element would reach page shortcuts behind the modal.
function handleContentKeydown(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Browser autofill dispatches keydown events with no `key`.
  if (typeof e.key !== "string" || e.key.length !== 1) return;
  if (isInputFocused(e.target)) return;
  e.stopPropagation();
}

function handleInteractOutside(e: Event) {
  e.preventDefault();
  // A portaled popup opened from inside the dialog sits outside its DOM but belongs to it.
  const originalEvent = (e as CustomEvent & { detail?: { originalEvent?: PointerEvent } }).detail
    ?.originalEvent;
  const target = originalEvent?.target as Element | null;
  if (target?.closest("[data-reka-popper-content-wrapper]")) return;
  guard.requestDismiss();
}

const closeShown = computed(() => props.showClose && !props.persistent);
const hasHeader = computed(
  () =>
    !!slots.header ||
    !!slots["header-left"] ||
    !!slots["header-right"] ||
    !!props.title ||
    closeShown.value,
);
const hasTrigger = computed(() => !!slots.trigger);

const isFullSize = computed(() => props.size === "full");

const sizeClasses: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "w-[min(25rem,calc(100vw-2rem))]",
  md: "w-[min(35rem,calc(100vw-2rem))]",
  lg: "w-[min(45rem,calc(100vw-2rem))]",
  full: "h-screen w-screen",
};

// ── Auto-focus ───────────────────────────────────────────────────────────────
const bodyRef = ref<HTMLElement | null>(null);
const footerRef = ref<InstanceType<typeof OOverlayFooter> | null>(null);

// A select trigger is the second tier, so a select-only dialog still keeps keystrokes in a field.
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
    footerRef.value?.initialFocusTarget()?.focus();
  });
}

// ── Focus repair on body content swaps ───────────────────────────────────────
// A v-if swap that removes the focused field drops focus to <body>, where keys fire page shortcuts.
function focusStaysInField(body: Element): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    active.matches(AUTOFOCUS_ANY_FIELD) &&
    (body.contains(active) || !!active.closest("[data-reka-popper-content-wrapper]"))
  );
}

watchEffect((cleanup) => {
  if (!shown.value) return;
  const body = bodyRef.value;
  if (!body) return;

  const containsField = (node: Node): node is Element =>
    node instanceof Element &&
    (node.matches(AUTOFOCUS_ANY_FIELD) || !!node.querySelector(AUTOFOCUS_ANY_FIELD));

  const observer = new MutationObserver((records) => {
    const added = records.flatMap((r) => Array.from(r.addedNodes)).filter(containsField);
    const removedField = records.flatMap((r) => Array.from(r.removedNodes)).some(containsField);
    if (!added.length || !removedField) return;

    if (focusStaysInField(body)) return;

    nextTick(() => {
      // A field the swap itself focused (a popover's search box) already holds the edit.
      if (focusStaysInField(body)) return;
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

// ── Focus trap and portaled popups ───────────────────────────────────────────
// reka's FocusScope listens on document; stopping the events at <body> keeps it from stealing focus back.
watchEffect((cleanup) => {
  if (!shown.value) return;

  const isPortalElement = (el: Element | null) =>
    !!el?.closest("[data-reka-popper-content-wrapper]");

  const handleFocusIn = (e: FocusEvent) => {
    if (isPortalElement(e.target as Element | null)) e.stopPropagation();
  };
  const handleFocusOut = (e: FocusEvent) => {
    if (isPortalElement(e.relatedTarget as Element | null)) e.stopPropagation();
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

// The body unmounts while a kept-alive host is away, so its listeners follow what is shown.
watch(shown, (open) => {
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
  <DialogRoot :open="shown" @update:open="handleOpenChange">
    <DialogTrigger v-if="hasTrigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal>
      <DialogOverlay
        data-test="o-dialog-overlay"
        :style="{ zIndex: overlayZIndex }"
        :class="[
          'fixed inset-0',
          'bg-dialog-overlay',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          'data-[state=closed]:duration-(--duration-dialog-out) data-[state=open]:duration-(--duration-dialog-in)',
        ]"
      />

      <!-- A fixed 12vh top (O5): growing content extends downward and never moves the header. -->
      <DialogContent
        data-o2-dialog
        :data-o2-dialog-size="size"
        :data-test="parentDataTest || 'o-dialog-panel'"
        :style="{ zIndex: contentZIndex }"
        :class="[
          isFullSize
            ? 'fixed inset-0'
            : 'rounded-surface fixed top-[12vh] left-1/2 max-h-[76vh] [translate:-50%_0]',
          'flex flex-col overflow-hidden',
          sizeClasses[size],
          'bg-dialog-bg border-dialog-border shadow-dialog border',
          'text-dialog-content-text',
          'focus-visible:ring-dialog-focus-ring outline-none focus-visible:ring-2',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          'data-[state=open]:duration-(--duration-dialog-in) data-[state=open]:ease-(--ease-out-expo)',
          'data-[state=closed]:duration-(--duration-dialog-out) data-[state=closed]:ease-(--ease-overlay-out)',
        ]"
        @escape-key-down="handleEscapeKeyDown"
        @interact-outside="handleInteractOutside"
        @open-auto-focus="handleOpenAutoFocus"
        @close-auto-focus="handleCloseAutoFocus"
        @keydown="handleContentKeydown"
      >
        <DialogTitle class="sr-only absolute">
          {{ title ?? ariaTitle ?? t("common.dialog") }}
        </DialogTitle>
        <DialogDescription class="sr-only absolute">
          {{ subtitle ?? title ?? ariaTitle ?? t("common.dialog") }}
        </DialogDescription>

        <div
          v-if="hasHeader"
          :class="[
            'flex shrink-0 items-center gap-2',
            'px-dialog-header-px py-dialog-header-py',
            'bg-dialog-header-bg text-dialog-header-text',
            'border-dialog-header-border border-b',
          ]"
        >
          <div v-if="slots.header" class="min-w-0 flex-1">
            <slot name="header" />
          </div>

          <template v-else>
            <div v-if="title || subtitle" class="min-w-0">
              <OTruncatedText
                v-if="title"
                class="text-dialog-header-text text-title block font-semibold"
              >
                {{ title }}
              </OTruncatedText>
              <OTruncatedText v-if="subtitle" class="text-text-secondary text-compact block">
                {{ subtitle }}
              </OTruncatedText>
            </div>

            <div
              v-if="slots['header-left']"
              class="flex min-w-0 flex-1 items-center justify-start gap-2"
            >
              <slot name="header-left" />
            </div>
            <div v-else class="flex-1" />

            <div v-if="slots['header-right']" class="flex shrink-0 items-center gap-2">
              <slot name="header-right" />
            </div>
          </template>

          <OButton
            v-if="closeShown"
            variant="ghost"
            size="sm"
            icon="close"
            icon-only
            :label="t('components.dialog.closeDialog')"
            :disabled="busy"
            data-test="o-dialog-close-btn"
            @mousedown.prevent
            @click="guard.requestDismiss()"
          />
        </div>

        <!-- Only the body scrolls (O6); `full` hands the scroll to its content. -->
        <div
          ref="bodyRef"
          :class="[
            'min-h-0 overflow-x-hidden',
            isFullSize
              ? 'flex-1 overflow-hidden p-0'
              : 'px-dialog-content-px py-dialog-content-py overflow-y-auto text-sm',
            'text-dialog-content-text',
            !isFullSize && canScrollUp && 'shadow-scroll-top',
            !isFullSize && canScrollDown && 'shadow-scroll-bottom',
            !isFullSize && canScrollUp && canScrollDown && 'shadow-scroll-both',
          ]"
          @keydown="blockMultiFieldEnter"
        >
          <slot />
        </div>

        <OOverlayFooter
          ref="footerRef"
          test-prefix="o-dialog"
          :primary="primary"
          :secondary="secondary"
          :extra="extra"
          :form-id="formId"
          :form-submitting="formSubmitting"
          :asking="asking"
          @primary="emit('click:primary')"
          @secondary="emit('click:secondary')"
          @extra="emit('click:extra')"
          @keep="guard.keepEditing()"
          @discard="discardAndClose"
        >
          <template v-if="slots.footer" #footer><slot name="footer" /></template>
          <template v-if="slots['footer-left']" #footer-left><slot name="footer-left" /></template>
        </OOverlayFooter>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
