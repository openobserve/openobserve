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

<template>
  <button
    type="button"
    class="rounded-default text-text-body hover:bg-surface-subtle focus-visible:ring-focus-ring-accent flex min-h-9 w-full min-w-0 cursor-pointer items-start gap-2.5 px-2.5 py-2 text-start text-sm leading-5 transition-colors focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none max-md:min-h-11 pointer-coarse:min-h-11"
    @click="emit('click')"
  >
    <OIcon :name="icon" size="sm" class="text-text-secondary mt-0.5 shrink-0" />
    <span class="min-w-0 flex-1">
      <template v-for="(part, index) in parts" :key="index">
        <code v-if="index % 2 === 1" class="font-mono text-xs">{{ part }}</code>
        <template v-else>{{ part }}</template>
      </template>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { I18nText } from "@/types/i18n";

const props = withDefaults(defineProps<{ label: I18nText; icon?: IconName }>(), {
  icon: assistantGlyph.assistant,
});

const emit = defineEmits<{ (e: "click"): void }>();

// Backticks in a starter mark a stream or org name; odd parts sit between them.
const parts = computed(() => String(props.label).split("`"));
</script>
