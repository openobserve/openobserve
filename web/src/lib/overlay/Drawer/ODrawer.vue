<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.

import type { DrawerProps, DrawerEmits, DrawerSlots } from "./ODrawer.types";
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
  inject,
  provide,
  nextTick,
  useAttrs,
  onActivated,
  onDeactivated,
} from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTabs from "@/lib/navigation/Tabs/OTabs.vue";
import OTab from "@/lib/navigation/Tabs/OTab.vue";
import OOverlayFooter from "@/lib/overlay/shared/OOverlayFooter.vue";
import {
  blockMultiFieldEnter,
  outsideInteraction,
  useDismissGuard,
} from "@/lib/overlay/shared/useDismissGuard";
import { useScrollShadow } from "@/lib/overlay/useScrollShadow";
import { FORM_DIRTY_STATE_KEY, FORM_SUBMIT_STATE_KEY } from "@/lib/forms/Form/OForm.types";
import { useI18nTyped } from "@/types/i18n";

const { t } = useI18nTyped();

defineOptions({ inheritAttrs: false });
const $attrs = useAttrs();
// DialogRoot is renderless, so the consumer's data-test is forwarded to the panel by hand.
const parentDataTest = computed(() => $attrs["data-test"] as string | undefined);

const props = withDefaults(defineProps<DrawerProps>(), {
  open: undefined,
  dirty: false,
  persistent: false,
  side: "right",
  size: "md",
  bleed: false,
  showClose: true,
  seamless: false,
  lazy: true,
  portalTarget: undefined,
  anchor: undefined,
  anchorEdge: "top",
  modal: true,
});

const emit = defineEmits<DrawerEmits>();

defineSlots<DrawerSlots>();

const slots = useSlots();

const ESCAPE_KEEPS_OPEN =
  "input, textarea, select, [contenteditable], [data-reka-popper-content-wrapper]";

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
// An inline drawer's DOM moves with its host, so only a portaled one needs hiding.
const shown = computed(() => internalOpen.value && (props.inline || !hostAway.value));

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
  const target = hostAway.value ? null : props.returnFocusTo?.();
  if (target?.isConnected) {
    event.preventDefault();
    awaySinceOpen = false;
    target.scrollIntoView({ block: "nearest" });
    target.focus({ preventScroll: true });
  } else if (!hostAway.value && awaySinceOpen) {
    awaySinceOpen = false;
    if (openedFrom?.isConnected) openedFrom.focus();
  }
  emit("after-close");
}

function setOpen(v: boolean) {
  internalOpen.value = v;
  emit("update:open", v);
}

// Each nested ODrawer stacks one layer higher.
const drawerDepth = inject<number>("o2DrawerDepth", 0);
provide("o2DrawerDepth", drawerDepth + 1);

// A nested OForm linked by `form-id` mirrors its submit and edit state here.
const formSubmitting = ref(false);
provide(FORM_SUBMIT_STATE_KEY, formSubmitting);
const formDirty = ref(false);
provide(FORM_DIRTY_STATE_KEY, formDirty);

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

function handleEscapeKeyDown(e: KeyboardEvent) {
  e.preventDefault();
  const target = e.target instanceof Element ? e.target : null;
  // A non-modal drawer sits beside live controls, so Escape there belongs to the field or open listbox.
  if (!props.modal && target?.closest(ESCAPE_KEEPS_OPEN)) return;
  guard.requestDismiss();
}

function handleInteractOutside(e: Event) {
  e.preventDefault();
  if (!props.modal) return;
  const outside = outsideInteraction(e);
  if (outside === "dismiss") guard.requestDismiss();
  else if (outside === "refocus") refocusInside(e);
}

// Focus code moved out of a modal overlay comes back to its first field, or to the panel itself.
function refocusInside(e: Event) {
  handleOpenAutoFocus(e);
  nextTick(() => {
    const panel = bodyRef.value?.closest<HTMLElement>("[data-o2-drawer]");
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  });
}

const overlayZIndex = computed(() => 5999 + drawerDepth * 1000);
const contentZIndex = computed(() => 6000 + drawerDepth * 1000);

const closeShown = computed(() => props.showClose && !props.persistent);
const hasHeader = computed(
  () =>
    !!slots.header ||
    !!slots["header-left"] ||
    !!slots["header-right"] ||
    !!props.title ||
    closeShown.value,
);
const subtitleInHeader = computed(() => hasHeader.value && !slots.header);
const hasTrigger = computed(() => !!slots.trigger);
const isRight = computed(() => props.side !== "left");
const hasTabs = computed(() => !!props.tabs?.length);

// Fixed widths only (O3); under md a drawer takes the full width (R2).
const sizeClasses: Record<NonNullable<DrawerProps["size"]>, string> = {
  sm: "w-[min(30rem,100vw)]",
  md: "w-[min(40rem,100vw)]",
  lg: "w-[min(50rem,100vw)]",
  xl: "w-[min(60rem,100vw)]",
};

// Contained in `portalTarget`: positioned inside that element's bounds instead of the window.
const isContained = computed(() => !!props.portalTarget);

// Measured, not CSS: the drawer is portaled to <body>, away from its anchor row.
const anchorTop = ref(0);
function measureAnchor() {
  const a = props.anchor;
  const el = typeof a === "string" ? document.querySelector<HTMLElement>(a) : a;
  const rect = el?.getBoundingClientRect();
  anchorTop.value = rect
    ? Math.max(0, Math.round(props.anchorEdge === "bottom" ? rect.bottom : rect.top))
    : 0;
}
watchEffect(
  (cleanup) => {
    if (!shown.value || !props.anchor) {
      anchorTop.value = 0;
      return;
    }
    measureAnchor();
    window.addEventListener("resize", measureAnchor);
    cleanup(() => window.removeEventListener("resize", measureAnchor));
  },
  // The anchor can be swapped in the same tick, so measure only once it is in the DOM.
  { flush: "post" },
);
const anchorStyle = computed(() => {
  const style: Record<string, string> = {};
  if (anchorTop.value > 0) {
    style.top = `${anchorTop.value}px`;
    style.height = `calc(100% - ${anchorTop.value}px)`;
  }
  return style;
});
const overlayStyle = computed(() => ({ zIndex: overlayZIndex.value, ...anchorStyle.value }));
const contentStyle = computed(() => ({ zIndex: contentZIndex.value, ...anchorStyle.value }));

// ── Auto-focus ───────────────────────────────────────────────────────────────
const bodyRef = ref<HTMLElement | null>(null);
const footerRef = ref<InstanceType<typeof OOverlayFooter> | null>(null);
const AUTOFOCUS_TEXT_FIELDS = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([disabled])',
  "textarea:not([disabled])",
].join(", ");
const AUTOFOCUS_COMBOBOX = '[role="combobox"]:not([disabled]):not([aria-disabled="true"])';

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
  // The panel is still translated off-screen by the slide-in, so a scrolling focus would drag a contained portal target sideways.
  nextTick(() => {
    const body = bodyRef.value;
    const target =
      (body && findAutoFocusTarget(body)) ??
      body?.querySelector<HTMLElement>("[autofocus]") ??
      footerRef.value?.initialFocusTarget() ??
      body?.closest<HTMLElement>("[data-o2-drawer]");
    target?.focus({ preventScroll: true });
  });
}

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

const activeTab = computed(() => props.tab ?? props.tabs?.[0]?.value ?? "");
</script>

<template>
  <DialogRoot :open="shown" :modal="modal" @update:open="handleOpenChange">
    <DialogTrigger v-if="hasTrigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal
      v-if="!inline || internalOpen"
      :to="props.portalTarget ?? 'body'"
      :disabled="inline"
      :force-mount="inline ? true : undefined"
    >
      <DialogOverlay
        data-test="o-drawer-overlay"
        :class="[
          isContained ? 'absolute inset-0' : 'fixed inset-0',
          seamless ? 'pointer-events-none bg-transparent' : 'bg-dialog-overlay',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          'data-[state=closed]:animation-duration-(--duration-drawer-out) data-[state=open]:animation-duration-(--duration-drawer-in)',
        ]"
        :style="overlayStyle"
      />

      <DialogContent
        :force-mount="inline ? true : undefined"
        v-bind="subtitle && subtitleInHeader ? {} : { 'aria-describedby': undefined }"
        data-o2-drawer
        :data-o2-drawer-size="size"
        :data-test="parentDataTest || 'o-drawer-panel'"
        :style="contentStyle"
        :class="[
          isContained ? 'absolute inset-y-0' : 'fixed inset-y-0',
          isRight ? 'right-0' : 'left-0',
          isContained ? 'h-full' : 'max-h-screen',
          'flex flex-col overflow-hidden max-md:w-full',
          sizeClasses[size],
          'bg-dialog-bg text-dialog-content-text shadow-dialog border-dialog-border',
          isRight ? 'rounded-s-surface border-s' : 'rounded-e-surface border-e',
          'focus-visible:ring-dialog-focus-ring outline-none focus-visible:ring-2',
          isRight
            ? [
                'data-[state=open]:animate-in data-[state=open]:slide-in-from-right',
                'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right',
              ]
            : [
                'data-[state=open]:animate-in data-[state=open]:slide-in-from-left',
                'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left',
              ],
          'data-[state=open]:animation-duration-(--duration-drawer-in) data-[state=open]:ease-(--ease-out-expo)',
          'data-[state=closed]:animation-duration-(--duration-drawer-out) data-[state=closed]:ease-(--ease-overlay-out)',
        ]"
        @escape-key-down="handleEscapeKeyDown"
        @interact-outside="handleInteractOutside"
        @open-auto-focus="handleOpenAutoFocus"
        @close-auto-focus="handleCloseAutoFocus"
      >
        <DialogTitle class="sr-only absolute">
          {{ ariaLabel ?? title ?? t("common.drawer") }}
        </DialogTitle>

        <div
          v-if="hasHeader"
          :class="[
            'flex shrink-0 items-center gap-2',
            'px-dialog-header-px py-dialog-header-py',
            'bg-dialog-header-bg text-dialog-header-text',
            !hasTabs && 'border-dialog-header-border border-b',
          ]"
        >
          <div v-if="slots.header" class="min-w-0 flex-1">
            <slot name="header" />
          </div>

          <template v-else>
            <!-- Below lg a long subtitle truncates, or it pushes the close button off screen. -->
            <div v-if="title || subtitle" class="min-w-0 shrink-0 max-lg:shrink">
              <OTruncatedText
                v-if="title"
                class="text-dialog-header-text text-title block font-semibold"
                :data-test="titleDataTest"
              >
                {{ title }}
              </OTruncatedText>
              <!-- The visible subtitle is the description, so screen readers meet it once. -->
              <DialogDescription v-if="subtitle" as-child>
                <OTruncatedText
                  class="text-text-secondary text-compact block"
                  :data-test="subtitleDataTest"
                >
                  {{ subtitle }}
                </OTruncatedText>
              </DialogDescription>
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
            :label="t('components.drawer.closeDrawer')"
            :disabled="busy"
            data-test="o-drawer-close-btn"
            @mousedown.prevent
            @click="guard.requestDismiss()"
          />
        </div>

        <div v-if="hasTabs" class="bg-dialog-header-bg shrink-0">
          <OTabs
            :model-value="activeTab"
            size="compact"
            bordered
            data-test="o-drawer-tabs"
            @update:model-value="emit('update:tab', String($event))"
          >
            <OTab
              v-for="item in tabs"
              :key="item.value"
              :name="item.value"
              :label="item.label"
              :count="item.count"
              :data-test="item.dataTest"
            />
          </OTabs>
        </div>

        <!-- The body fills the remaining height, so the footer always sits at the bottom (O6). -->
        <div
          ref="bodyRef"
          :class="[
            'min-h-0 flex-1 overflow-x-hidden overflow-y-auto',
            'text-dialog-content-text',
            !bleed && 'px-dialog-content-px py-dialog-content-py',
            canScrollUp && 'shadow-scroll-top',
            canScrollDown && 'shadow-scroll-bottom',
            canScrollUp && canScrollDown && 'shadow-scroll-both',
          ]"
          @keydown="blockMultiFieldEnter"
        >
          <template v-if="!props.lazy || internalOpen">
            <slot />
          </template>
        </div>

        <OOverlayFooter
          ref="footerRef"
          test-prefix="o-drawer"
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
