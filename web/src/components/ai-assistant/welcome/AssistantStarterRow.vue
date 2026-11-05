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
    variant="ghost-primary"
    size="sm"
    class="h-auto! min-h-7 justify-start! px-0! py-0.5 text-start font-normal whitespace-normal! max-md:min-h-11 pointer-coarse:min-h-11"
    @click="emit('click')"
  >
    <span>
      <template v-for="(part, index) in parts" :key="index">
        <code v-if="index % 2 === 1" class="font-mono text-xs">{{ part }}</code>
        <template v-else>{{ part }}</template>
      </template>
    </span>
  </OButton>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import type { I18nText } from "@/types/i18n";

const props = defineProps<{ label: I18nText }>();

const emit = defineEmits<{ (e: "click"): void }>();

// Backticks in a starter mark a stream or org name; odd parts sit between them.
const parts = computed(() => String(props.label).split("`"));
</script>
