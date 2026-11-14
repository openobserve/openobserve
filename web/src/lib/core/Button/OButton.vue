<script setup lang="ts">
import type {
  ButtonProps,
  ButtonEmits,
  ButtonSlots,
  ButtonSize,
  ButtonVariant,
  ButtonVariantLook,
} from "./OButton.types";
import { BUTTON_GROUP_SIZE } from "./OButton.types";
import {
  computed,
  getCurrentInstance,
  inject,
  ref,
  onMounted,
  onBeforeUnmount,
  resolveComponent,
  useAttrs,
  useId,
  type Component,
} from "vue";
import { UNNAMED_ICON_ONLY_DELAY_MS, warnIfUnnamedIconOnly } from "./iconOnlyName";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useFeatureLock } from "@/composables/useFeatureLock";
import { useDelayedFlag } from "@/composables/shared/useDelayedFlag";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";
import { activates } from "./activation";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<ButtonProps>(), {
  variant: "secondary",
  size: undefined,
  type: "button",
  disabled: false,
  loading: false,
  iconOnly: false,
  pressed: undefined,
  stale: false,
  block: false,
  as: "button",
});

const emit = defineEmits<ButtonEmits>();
defineSlots<ButtonSlots>();

const attrs = useAttrs();
const id = useId();
const { locked } = useFeatureLock();
const groupSize = inject(BUTTON_GROUP_SIZE, null);
const size = computed<ButtonSize>(() => props.size ?? groupSize?.value ?? "md");

const isDisabled = computed(() => props.disabled || locked.value);
// Resolved from the app's router plugin, not imported: many specs mock vue-router without RouterLink.
const routerLink: Component | string | null =
  props.to !== undefined ? resolveComponent("RouterLink") : null;
// A blocked link renders as a bare anchor: RouterLink would navigate before a click guard runs.
const tag = computed(() => {
  if (routerLink && props.to !== undefined && !isDisabled.value) return routerLink;
  if (props.href !== undefined || props.to !== undefined) return "a";
  return props.as;
});
const isNativeButton = computed(() => tag.value === "button");
// Only the attributes the rendered element owns: an undefined href would override RouterLink's own.
const elementAttrs = computed(() => {
  if (routerLink && tag.value === routerLink) return { to: props.to };
  if (tag.value === "a") return isDisabled.value ? {} : { href: props.href };
  if (isNativeButton.value) return { type: props.type, disabled: nativeDisabled.value };
  return {};
});
const hasReason = computed(() => isDisabled.value && !!props.disabledReason);
// Busy and reasoned-disabled buttons keep focus (no native disabled) so a reader reaches them.
const inactive = computed(
  () => props.loading || hasReason.value || (isDisabled.value && !isNativeButton.value),
);
const nativeDisabled = computed(() => isNativeButton.value && isDisabled.value && !hasReason.value);
const showSpinner = useDelayedFlag(() => props.loading, LOADER_DELAY_MS);
const reasonId = `${id}-reason`;

const rootRef = ref<{ $el?: Element } | Element | null>(null);
let nameCheckTimer: ReturnType<typeof setTimeout> | undefined;
onMounted(() => {
  if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
  nameCheckTimer = setTimeout(() => {
    const root = rootRef.value;
    warnIfUnnamedIconOnly(root instanceof Element ? root : root?.$el);
  }, UNNAMED_ICON_ONLY_DELAY_MS);
});
onBeforeUnmount(() => clearTimeout(nameCheckTimer));

const FILLED_DISABLED = "bg-surface-subtle text-text-disabled border-transparent";
const BARE_DISABLED = "bg-transparent text-text-disabled border-transparent";
// Inside a hovered table row a neutral hover fill would match the row fill, so it steps up to the row-action fill.
const ROW_STEP = "group-hover/row:hover:not-active:bg-table-row-action-hover-bg";

const looks: Record<ButtonVariant, ButtonVariantLook> = {
  primary: {
    base: "bg-button-primary text-button-primary-foreground border-transparent",
    interactive: "hover:bg-button-primary-hover active:bg-button-primary-active",
    pressed: "bg-button-primary-active text-button-primary-foreground border-transparent",
    disabled: FILLED_DISABLED,
  },
  secondary: {
    base: "bg-button-secondary text-button-outline-text border-button-outline-border",
    interactive: `hover:bg-surface-subtle active:bg-surface-subtle-hover ${ROW_STEP}`,
    pressed: "bg-surface-accent-hover text-accent-on-tint border-button-outline-hover-border",
    disabled: FILLED_DISABLED,
  },
  ghost: {
    base: "bg-transparent text-text-secondary border-transparent",
    interactive: `hover:bg-surface-subtle hover:text-text-heading active:bg-surface-subtle-hover active:text-text-heading ${ROW_STEP}`,
    pressed: "bg-surface-accent-hover text-accent-on-tint border-transparent",
    disabled: BARE_DISABLED,
  },
  "accent-ghost": {
    base: "bg-transparent text-text-link border-transparent",
    // Link ink drops under 4.5:1 on the accent fills, so a filled state takes the on-tint ink.
    interactive: `hover:bg-surface-accent-hover hover:text-accent-on-tint active:bg-surface-accent-active active:text-accent-on-tint ${ROW_STEP}`,
    pressed: "bg-surface-accent-active text-accent-on-tint border-transparent",
    disabled: BARE_DISABLED,
  },
  danger: {
    base: "bg-button-destructive text-button-destructive-foreground border-transparent",
    interactive: "hover:bg-button-destructive-hover active:bg-button-destructive-hover",
    pressed: "bg-button-destructive-hover text-button-destructive-foreground border-transparent",
    disabled: FILLED_DISABLED,
  },
  "danger-ghost": {
    base: "bg-transparent text-button-ghost-destructive-text border-transparent",
    interactive:
      "hover:bg-button-ghost-destructive-hover-bg active:bg-button-ghost-destructive-active-bg",
    pressed: "bg-button-ghost-destructive-active-bg text-button-ghost-destructive-text",
    disabled: BARE_DISABLED,
  },
  link: {
    base: "bg-transparent text-text-link border-transparent",
    interactive: "hover:text-text-link-hover hover:underline",
    pressed: "bg-transparent text-text-link-hover border-transparent underline",
    disabled: BARE_DISABLED,
  },
};

const textSizes: Record<ButtonSize, string> = {
  xs: "h-control-xs min-w-control-xs px-2 gap-1 text-xs rounded-chip",
  sm: "h-control-sm min-w-control-sm px-2.5 gap-1.5 text-compact rounded-default",
  md: "h-control-md min-w-control-md px-3 gap-1.5 text-compact rounded-default",
  lg: "h-control-lg min-w-control-lg px-4 gap-1.5 text-sm rounded-default",
};

// shrink-0: a tight flex row would otherwise squash the square to its glyph width.
const iconOnlySizes: Record<ButtonSize, string> = {
  xs: "size-control-xs shrink-0 p-0 rounded-chip",
  sm: "size-control-sm shrink-0 p-0 rounded-default",
  md: "size-control-md shrink-0 p-0 rounded-default",
  lg: "size-control-lg shrink-0 p-0 rounded-default",
};

const linkSizes: Record<ButtonSize, string> = {
  xs: "gap-1 text-xs rounded-chip",
  sm: "gap-1 text-compact rounded-chip",
  md: "gap-1.5 text-compact rounded-chip",
  lg: "gap-1.5 text-sm rounded-chip",
};

// Untyped callers (a v-bind object, a script value) can still hand in a retired name; it renders as the default.
const look = computed(() => looks[props.variant] ?? looks.secondary);

const stateClasses = computed(() => {
  if (isDisabled.value) return `${look.value.disabled} cursor-not-allowed`;
  if (props.pressed) return look.value.pressed;
  if (props.loading) return `${look.value.base} cursor-progress`;
  return `${look.value.base} ${look.value.interactive} cursor-pointer`;
});

const sizeClasses = computed(() => {
  if (props.variant === "link") return `h-auto min-w-0 p-0 ${linkSizes[size.value]}`;
  return props.iconOnly ? iconOnlySizes[size.value] : textSizes[size.value];
});

const classes = computed(() => [
  props.block ? "flex w-full" : "inline-flex",
  "relative box-border items-center justify-center border whitespace-nowrap select-none",
  "font-medium leading-none transition-[color,background-color,border-color,box-shadow] duration-(--duration-control) ease-(--ease-control)",
  props.variant === "link" ? "" : "no-underline hover:no-underline",
  // An offset outline stays visible on accent fills, where a hugging ring would vanish.
  "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-focus-ring-accent",
  sizeClasses.value,
  stateClasses.value,
]);

const iconClass = computed(() => (size.value === "xs" ? "size-3.5!" : undefined));
const ariaLabel = computed(
  () => (attrs["aria-label"] as string | undefined) ?? (props.iconOnly ? props.label : undefined),
);
const tooltipContent = computed(() => {
  if (hasReason.value) return props.disabledReason;
  if (props.iconOnly || props.shortcut) return props.label;
  return undefined;
});
const describedBy = computed(
  () =>
    [attrs["aria-describedby"] as string | undefined, hasReason.value ? reasonId : undefined]
      .filter(Boolean)
      .join(" ") || undefined,
);

const instance = getCurrentInstance();
const ACTION_LISTENERS = ["onClick", "onPointerdown", "onMousedown", "onPointerup"];

// A plain button with no listener does nothing on click, so a child tooltip may claim the click to open.
function isInert(): boolean {
  if (!isNativeButton.value || props.type !== "button") return false;
  if (attrs["aria-haspopup"] !== undefined || attrs["aria-expanded"] !== undefined) return false;
  const vnodeProps = instance?.vnode.props ?? {};
  return !ACTION_LISTENERS.some((name) => vnodeProps[name]);
}

function handleKeydown(event: KeyboardEvent): void {
  if (inactive.value && activates(event)) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}

function handleClick(event: MouseEvent): void {
  if (isDisabled.value || props.loading) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  emit("click", event);
}
</script>

<template>
  <component
    :is="tag"
    ref="rootRef"
    :class="classes"
    :aria-disabled="isDisabled || loading || undefined"
    :aria-busy="loading || undefined"
    :aria-pressed="pressed === undefined ? undefined : String(pressed)"
    data-o2-btn
    :data-o2-variant="variant"
    :data-o2-size="size"
    :data-o2-inert="isInert() || undefined"
    :data-o2-stale="stale || undefined"
    v-bind="{ ...elementAttrs, ...$attrs }"
    :aria-label="ariaLabel"
    :aria-describedby="describedBy"
    @keydown.capture="handleKeydown"
    @click="handleClick"
  >
    <OTooltip v-if="tooltipContent" :content="tooltipContent" :shortcut="shortcut" />
    <span
      v-if="loading && showSpinner"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
      aria-hidden="true"
    >
      <OIcon
        name="progress-activity"
        size="sm"
        :class="['o2-motion-keep animate-spin', iconClass]"
      />
    </span>
    <!-- display:contents while loading too: a wrapper that loses its box strands a child OTooltip at (0,0). -->
    <span
      :class="loading && showSpinner ? 'contents text-transparent [&>*]:opacity-0' : 'contents'"
    >
      <slot name="icon">
        <OIcon
          v-if="icon"
          :name="icon"
          size="sm"
          :class="[iconClass, icon === 'lock' ? 'lock-chip' : undefined]"
        />
      </slot>
      <slot>
        <template v-if="!iconOnly && label">{{ label }}</template>
      </slot>
      <span
        v-if="count !== undefined && !iconOnly"
        :class="[
          'text-2xs rounded-full px-1.25 leading-4 font-semibold tabular-nums',
          variant === 'primary'
            ? 'text-button-primary-foreground bg-white/20'
            : 'bg-surface-subtle text-text-secondary',
        ]"
        >{{ count }}</span
      >
      <slot name="icon-end">
        <OIcon
          v-if="iconEnd"
          :name="iconEnd"
          size="sm"
          :class="[iconClass, iconEnd === 'lock' ? 'lock-chip' : undefined]"
        />
      </slot>
    </span>
    <span v-if="hasReason" :id="reasonId" class="sr-only" aria-hidden="true">{{
      disabledReason
    }}</span>
    <span
      v-if="stale"
      class="bg-warning-500 ring-button-primary pointer-events-none absolute end-1.25 top-1.25 size-1.5 rounded-full ring-2"
      aria-hidden="true"
    />
  </component>
</template>
