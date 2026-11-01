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
  <OButton
    variant="ghost"
    size="sm"
    block
    role="menuitemradio"
    :aria-checked="selected"
    :class="[
      'h-8! justify-start! gap-2 px-2! text-start max-md:h-11! pointer-coarse:h-11!',
      selected ? 'bg-dropdown-item-hover-bg' : '',
    ]"
    @click="emit('click')"
  >
    <span class="text-text-body min-w-0 flex-1 truncate font-normal">{{ label }}</span>
    <span v-if="meta" class="text-text-secondary shrink-0 text-xs font-normal">{{ meta }}</span>
    <OIcon v-if="selected" :name="assistantGlyph.done" size="xs" class="text-link shrink-0" />
  </OButton>
</template>

<script setup lang="ts">
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { I18nText } from "@/types/i18n";

defineProps<{ label: I18nText; meta?: I18nText; selected?: boolean }>();

const emit = defineEmits<{ (e: "click"): void }>();
</script>
