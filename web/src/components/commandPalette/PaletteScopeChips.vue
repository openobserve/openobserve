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
import type { PaletteScope } from "./types";

defineProps<{
  scopes: Array<{ id: PaletteScope; label: string }>;
  selected: PaletteScope | null;
}>();

const emit = defineEmits<{
  (e: "select", scope: PaletteScope | null): void;
}>();
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5" role="group" data-test="command-palette-scopes">
    <OButton
      v-for="s in scopes"
      :key="s.id"
      variant="outline"
      size="chip"
      :active="selected === s.id"
      :data-test="`command-palette-scope-${s.id}`"
      @mousedown.prevent
      @click="emit('select', selected === s.id ? null : s.id)"
    >
      {{ s.label }}
    </OButton>
  </div>
</template>
