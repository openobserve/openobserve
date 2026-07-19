<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OTag — THE badge component for the whole app. It is a superset of OBadge:
// OBadge is the low-level renderer and is used ONLY inside OTag; application
// code should always reach for <OTag>.
//
// Two ways to use it:
//
//   1. Semantic (registry-driven) — pass a `type` group + raw `value`; colour /
//      icon / dot / label / size / shape are resolved from badgeGroups.ts:
//        <OTag type="alertType"   value="realtime" />   → blue + bolt icon
//        <OTag type="alertStatus" value="active"   />   → green + leading dot
//        <OTag value="whatever" />                       → generic semantic map
//
//   2. Manual (OBadge passthrough) — no `type`; drive it with `variant`, slots,
//      `count`, etc.:
//        <OTag variant="default-soft">Steps</OTag>
//        <OTag variant="primary-soft" :count="12" />
//        <OTag variant="teal-soft"><template #icon>…</template> Label </OTag>
//
// Per-call props (`label`, `variant`, `icon`, `dot`, `size`, `shape`) win over
// the registry. Default size is "sm" for semantic (typed) badges and "md" for
// manual badges.
//
// Label precedence (most → least specific):
//   1. default slot      — arbitrary child content (spinner, tooltip, …)
//   2. `label` prop      — dynamic / runtime text (e.g. `v${row.version}`)
//   3. registry labelKey — i18n key, translated here via t()
//   4. registry label    — static literal in badgeGroups.ts
//   5. humanised value   — "real_time" → "Real Time"

import { computed, useSlots } from "vue";
import OBadge from "./OBadge.vue";
import type { BadgeVariant, BadgeSize, BadgeShape } from "./OBadge.types";
import { resolveBadge, normalizeKey, type BadgeGroupName } from "./badgeGroups";
import { translateBadgeLabel } from "./badgeI18n";

// Two possible roots (empty dash vs OBadge), so attr auto-inheritance is off —
// forward $attrs explicitly to whichever renders (class, data-test, …).
defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    /** Registry group (e.g. "alertType"). Omit for a manual / generic badge. */
    type?: BadgeGroupName | string;
    /** Raw value (string | boolean | number). Optional for manual badges. */
    value?: unknown;
    size?: BadgeSize;
    /** Override the corner shape: pill, rounded, or square. */
    shape?: BadgeShape;
    /** Override the resolved label with dynamic/runtime text. */
    label?: string;
    /** Override the resolved colour variant. */
    variant?: BadgeVariant;
    /** Override the resolved icon (OIcon name). Pass "" to suppress. */
    icon?: string;
    /** Override the leading dot. */
    dot?: boolean;
    /** Trailing numeric count segment (OBadge passthrough). */
    count?: number;
    /** Suppress the trailing segment when count is 0 (OBadge passthrough). */
    hideZeroCount?: boolean;
    /** Make the badge interactive (OBadge passthrough). */
    clickable?: boolean;
    /** Mute + disable interaction (OBadge passthrough). */
    disabled?: boolean;
    /** Text shown when a typed value is empty. Default "—". */
    emptyLabel?: string;
  }>(),
  // `dot` MUST default to undefined (not Vue's Boolean-absent→false coercion) so
  // `props.dot ?? resolved.dot` falls back to the registry's dot when the caller
  // doesn't pass it. Without this, every dot-mode group silently loses its dot.
  { emptyLabel: "—", dot: undefined },
);

const emit = defineEmits<{ click: [e: MouseEvent | KeyboardEvent] }>();

const slots = useSlots();

const resolved = computed(() => resolveBadge(props.type, props.value));

// Any manual content present → never fall back to the empty dash.
const hasManualContent = computed(
  () =>
    !!slots.default ||
    props.count !== undefined ||
    props.label !== undefined ||
    props.variant !== undefined,
);
// The "—" dash is for a SEMANTIC badge whose value is missing.
const isEmpty = computed(
  () => !hasManualContent.value && normalizeKey(props.value) === "",
);

const variant = computed<BadgeVariant>(() => {
  if (props.variant) return props.variant;
  // Manual badge with neither a registry type nor a value → "default" variant so
  // a plain passthrough doesn't shift colour.
  if (!props.type && normalizeKey(props.value) === "") return "default";
  return resolved.value.variant;
});
// Size precedence: prop → registry → "sm".
const size = computed<BadgeSize>(
  () => props.size ?? resolved.value.size ?? "sm",
);
// Shape precedence: prop → registry group → "pill".
const shape = computed<BadgeShape>(
  () => props.shape ?? resolved.value.shape ?? "pill",
);
// Label precedence: prop → labelKey (i18n) → registry label → humanised value.
const label = computed(() => {
  if (props.label !== undefined) return props.label;
  const key = resolved.value.labelKey;
  return key ? translateBadgeLabel(key) : resolved.value.label;
});
const icon = computed(() =>
  props.icon !== undefined ? props.icon || undefined : resolved.value.icon,
);
// Dot precedence: explicit prop → registry dot for a TYPED group → false.
// Manual badges (no `type`) must NOT inherit the generic fallback's dot, or
// every passthrough chip (counts, metric chips) would sprout a leading dot.
const dot = computed(() =>
  props.dot ?? (props.type ? resolved.value.dot : false),
);
</script>

<template>
  <!-- Empty typed value: a plain dash in PRIMARY text (never the disabled grey). -->
  <span v-if="isEmpty" class="text-text-body" v-bind="$attrs">{{ emptyLabel }}</span>
  <OBadge
    v-else
    :variant="variant"
    :size="size"
    :shape="shape"
    :class="resolved.class"
    :dot="dot"
    :icon="icon"
    :count="count"
    :hide-zero-count="hideZeroCount"
    :clickable="clickable"
    :disabled="disabled"
    v-bind="$attrs"
    @click="emit('click', $event)"
  >
    <template v-if="slots.icon" #icon><slot name="icon" /></template>
    <slot>{{ label }}</slot>
    <template v-if="slots.trailing" #trailing><slot name="trailing" /></template>
  </OBadge>
</template>
