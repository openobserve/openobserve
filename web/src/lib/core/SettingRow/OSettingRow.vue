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
  One labelled setting inside a settings card: name and one line of description on the left, the
  control on the right, hairline rule between rows.

  It exists so a card of settings is a list of these rather than a stack of hand-tuned flex divs —
  the divider, the gap, and the label/description typography are decisions made once. The last row
  drops its own rule, so a card needs no per-row conditionals.

  Pair it with OFormSection, which supplies the card.
-->
<template>
  <div
    class="border-border-default flex items-center justify-between gap-4 border-b py-3 last:border-b-0"
    :class="disabled && 'opacity-60'"
    :data-test="dataTest"
  >
    <div class="min-w-0">
      <div class="text-text-heading text-sm font-medium">{{ label }}</div>
      <div v-if="description" class="text-text-secondary mt-0.5 text-xs">
        {{ description }}
      </div>
    </div>
    <div class="flex shrink-0 items-center justify-end">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SettingRowProps } from "./OSettingRow.types";

defineProps<SettingRowProps>();
</script>
