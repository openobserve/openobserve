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

<!-- Owns the rule and the padding so the two cells read as one row, not two half-width rows. -->
<template>
  <div class="border-border-default border-b px-3 py-3 last:border-b-0" :data-test="dataTest">
    <div class="grid grid-cols-[45%_45%] gap-x-[10%] max-md:grid-cols-1 max-md:gap-y-3">
      <slot />
    </div>
    <div v-if="$slots.footer" class="mt-1">
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { provide } from "vue";

import { SETTING_ROW_PAIR_KEY } from "./OSettingRow.types";
import type { SettingRowPairProps, SettingRowPairSlots } from "./OSettingRowPair.types";

defineProps<SettingRowPairProps>();
defineSlots<SettingRowPairSlots>();

provide(SETTING_ROW_PAIR_KEY, true);
</script>
