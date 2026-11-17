<script setup lang="ts">
// Copyright 2026 OpenObserve Inc.
//
// OAvatar — a person as a circle of initials. There is no image source: the
// product stores none, and a silhouette placeholder says less than two letters.
//
// The tone is DERIVED from the identity, not passed in, so the same person is
// the same colour on every screen without anybody threading a colour through.
// The ramp is the soft badge palette, which is already tuned for both themes —
// a saturated fill with white text would need a light-only text colour.

import { computed } from "vue";

import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw } from "@/types/i18n";

import type { AvatarProps } from "./OAvatar.types";

const props = withDefaults(defineProps<AvatarProps>(), { size: "md", tooltip: true });

/** Soft badge tones, in the order the hash walks them. */
const TONES = [
  "bg-badge-primary-soft-bg text-badge-primary-soft-text",
  "bg-badge-teal-soft-bg text-badge-teal-soft-text",
  "bg-badge-blue-soft-bg text-badge-blue-soft-text",
  "bg-badge-purple-soft-bg text-badge-purple-soft-text",
  "bg-badge-amber-soft-bg text-badge-amber-soft-text",
  "bg-badge-cyan-soft-bg text-badge-cyan-soft-text",
  "bg-badge-indigo-soft-bg text-badge-indigo-soft-text",
  "bg-badge-orange-soft-bg text-badge-orange-soft-text",
];

const SIZES: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-5 w-5 text-3xs",
  md: "h-6 w-6 text-2xs",
  lg: "h-8 w-8 text-xs",
};

const identity = computed(() => String(props.value ?? "").trim());

/** The name if we have one, else the local part of the email. */
const source = computed(() => {
  const name = props.name?.trim();
  if (name) return name;
  const at = identity.value.indexOf("@");
  return at > 0 ? identity.value.slice(0, at) : identity.value;
});

/// Two letters: the first of each of the first two words, or the first two
/// characters of a single word. `.`, `_` and `-` are word breaks so
/// `mei.tanaka@…` reads as MT rather than ME.
const initials = computed(() => {
  const words = source.value.split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
});

/** The address under the name, only when it says something the name does not. */
const secondLine = computed(() => {
  const name = props.name?.trim();
  return name && name !== identity.value ? identity.value : "";
});

const tone = computed(() => {
  let hash = 0;
  for (const char of identity.value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
});
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 items-center justify-center rounded-full font-medium select-none',
      SIZES[props.size],
      tone,
    ]"
    :aria-label="identity"
    >{{ initials
    }}<OTooltip v-if="props.tooltip && identity" side="bottom">
      <template #content>
        <span class="flex flex-col">
          <span>{{ raw(props.name?.trim() || identity) }}</span>
          <span v-if="secondLine" class="text-text-secondary font-normal">{{
            raw(secondLine)
          }}</span>
        </span>
      </template>
    </OTooltip></span
  >
</template>
