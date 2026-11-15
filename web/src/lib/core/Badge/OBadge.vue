<script setup lang="ts">
import type { BadgeProps, BadgeEmits, BadgeSlots, ChipTone, ChipSize } from "./OBadge.types";
import { CHIP_STATUS_TONES } from "./OBadge.types";
import { CHIP_TONE_CLASSES } from "./chipClasses";
import { computed, useSlots } from "vue";
import { useI18nTyped } from "@/types/i18n";
import OIcon from "../Icon/OIcon.vue";
import { iconRegistry } from "../Icon/OIcon.icons";

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<BadgeProps>(), {
  tone: "neutral",
  size: "sm",
  dot: undefined,
  mono: false,
  toggle: false,
  pressed: false,
  disabled: false,
  removable: false,
});

const emit = defineEmits<BadgeEmits>();

defineSlots<BadgeSlots>();

const slots = useSlots();
const { t } = useI18nTyped();

const hasIcon = computed(() => !!slots.icon || !!props.icon);

const isOIcon = computed<boolean>(() =>
  Boolean(props.icon && (props.icon as keyof typeof iconRegistry) in iconRegistry),
);

const showDot = computed(() => {
  if (props.dot !== undefined) return props.dot;
  if (props.toggle || hasIcon.value) return false;
  return (CHIP_STATUS_TONES as readonly ChipTone[]).includes(props.tone);
});

// A removable toggle stays a <span>: the ✕ is a nested button, and buttons cannot nest.
const tag = computed(() => (props.toggle && !props.removable ? "button" : "span"));

const sizeClasses: Record<ChipSize, string> = {
  sm: "h-5 px-1.5",
  md: "h-control-xs px-2",
};

// An unpressed toggle keeps a non-neutral tone, so a status chip that opens its details stays readable.
const toggleClasses = computed(() => [
  "h-control-xs px-2 cursor-pointer",
  "focus-visible:ring-badge-focus-ring focus-visible:ring-2 focus-visible:outline-none",
  props.pressed
    ? "border-badge-primary-ol-border bg-badge-primary-soft-bg text-badge-primary-soft-text"
    : props.tone === "neutral"
      ? "border-border-default bg-surface-base text-text-secondary hover:border-border-strong hover:text-text-heading"
      : [CHIP_TONE_CLASSES[props.tone], "hover:border-current/50"],
]);

// A removable toggle is a span, so it takes the button role and keys itself.
const spanToggle = computed(() => props.toggle && props.removable);

const classes = computed(() => [
  "rounded-chip inline-flex max-w-full items-center gap-1 border whitespace-nowrap",
  "text-xs leading-none font-medium transition-colors duration-(--duration-control) ease-(--ease-control)",
  props.mono && "font-mono",
  props.toggle ? toggleClasses.value : [CHIP_TONE_CLASSES[props.tone], sizeClasses[props.size]],
  props.disabled && "pointer-events-none opacity-40",
]);

function handleClick(e: MouseEvent): void {
  if (!props.toggle || props.disabled) return;
  emit("click", e);
}

function handleKeydown(e: KeyboardEvent): void {
  if (!spanToggle.value || props.disabled || e.target !== e.currentTarget) return;
  if (e.key !== "Enter" && e.key !== " ") return;
  e.preventDefault();
  (e.currentTarget as HTMLElement).click();
}

// Inside a toggle chip, the ✕ must not also toggle it.
function handleRemove(e: MouseEvent): void {
  if (props.disabled) return;
  e.stopPropagation();
  emit("remove", e);
}
</script>

<template>
  <component
    :is="tag"
    :type="tag === 'button' ? 'button' : undefined"
    :aria-pressed="toggle ? pressed : undefined"
    :role="spanToggle ? 'button' : undefined"
    :tabindex="spanToggle && !disabled ? 0 : undefined"
    :disabled="tag === 'button' && disabled ? true : undefined"
    :aria-disabled="disabled || undefined"
    :class="classes"
    v-bind="$attrs"
    @click="handleClick"
    @keydown="handleKeydown"
  >
    <span v-if="showDot" class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />

    <template v-if="hasIcon">
      <slot name="icon">
        <OIcon v-if="icon && isOIcon" :name="icon as any" size="xs" class="shrink-0" />
        <span
          v-else
          class="material-icons-outlined shrink-0 text-xs leading-none"
          aria-hidden="true"
          >{{ icon }}</span
        >
      </slot>
    </template>

    <slot />

    <span
      v-if="slots.trailing"
      class="shrink-0 border-s border-current/25 ps-1 leading-none tabular-nums opacity-75"
    >
      <slot name="trailing" />
    </span>

    <button
      v-if="removable"
      type="button"
      :disabled="disabled || undefined"
      :aria-label="removeLabel ?? t('common.remove')"
      :class="[
        'rounded-chip -me-0.5 inline-grid size-3.5 shrink-0 cursor-pointer place-items-center opacity-70',
        'hover:bg-current/12 hover:opacity-100',
        'focus-visible:ring-badge-focus-ring focus-visible:ring-2 focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-40',
      ]"
      data-test="o2-badge-remove"
      @click="handleRemove"
    >
      <OIcon name="close" size="xs" class="size-2.5!" />
    </button>
  </component>
</template>
