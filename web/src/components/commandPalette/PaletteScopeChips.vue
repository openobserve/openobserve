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

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import { useI18nTyped } from "@/types/i18n";
import type { PaletteScope } from "./types";

defineProps<{
  scopes: Array<{ id: PaletteScope; label: string }>;
  selected: PaletteScope[];
  /** Index of the chip the keyboard is on, or null when the keyboard is in the list. */
  cursor: number | null;
}>();

const emit = defineEmits<{
  (e: "toggle", scope: PaletteScope): void;
  (e: "clear"): void;
}>();

const { t } = useI18nTyped();
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5" role="group" data-test="command-palette-scopes">
    <OButton
      v-for="(s, i) in scopes"
      :key="s.id"
      variant="outline"
      size="chip"
      :active="selected.includes(s.id)"
      :class="cursor === i ? 'ring-focus-ring-accent ring-2' : ''"
      :aria-pressed="selected.includes(s.id)"
      :data-test="`command-palette-scope-${s.id}`"
      @mousedown.prevent
      @click="emit('toggle', s.id)"
    >
      {{ s.label }}
    </OButton>
    <OButton
      v-if="selected.length > 0"
      variant="ghost"
      size="chip"
      icon-left="close"
      data-test="command-palette-scope-clear"
      @mousedown.prevent
      @click="emit('clear')"
    >
      {{ t("palette.clearScopes") }}
    </OButton>
  </div>
</template>
