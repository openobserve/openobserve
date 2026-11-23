<!-- Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
-->

<!--
  Empty-canvas start scaffold card (Workflows). A DASHED, ghost placeholder that
  stands in for a not-yet-placed node — one per slot (Trigger, Action). Purely
  presentational: the wrapping canvas supplies the click via native @click
  fall-through, so this component just renders the tag / title / hint + tinted
  icon and the "waiting to be filled" dashed frame. Mirrors the reference
  builder's start state so the trigger→action shape reads before anything exists.
-->
<template>
  <button
    type="button"
    :data-test="dataTest"
    class="bg-surface-base border-border-strong hover:border-accent rounded-surface flex w-64 items-center gap-3 border border-dashed px-3 py-3 text-left transition-colors"
  >
    <span :class="tint" class="rounded-default flex size-8 shrink-0 items-center justify-center">
      <OIcon :name="icon" size="md" />
    </span>
    <span class="flex min-w-0 flex-col gap-0.5">
      <span class="text-2xs text-text-secondary font-semibold tracking-wide uppercase">
        {{ tag }}
      </span>
      <span class="text-text-heading text-sm leading-tight font-bold">{{ title }}</span>
      <span class="text-text-secondary text-xs leading-snug">{{ hint }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { I18nText } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

defineProps<{
  /** Small uppercase kind label ("Trigger" / "Action"). */
  tag: I18nText;
  /** Primary line — the call to action ("Choose a Trigger"). */
  title: I18nText;
  /** One-line description of what this slot starts. */
  hint: I18nText;
  /** OIcon glyph for the slot. */
  icon: IconName;
  /** Icon-chip tint classes (soft badge bg + text). */
  tint: string;
  dataTest?: string;
}>();
</script>
