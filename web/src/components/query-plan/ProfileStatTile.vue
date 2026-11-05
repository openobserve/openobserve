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
  <div class="bg-surface-subtle rounded-default min-w-0 px-2.5 py-2" :data-test="dataTest">
    <div class="text-text-secondary text-2xs">{{ label }}</div>
    <OTruncatedText
      as="div"
      class="text-text-heading text-lg leading-tight font-semibold tabular-nums"
      >{{ value }}</OTruncatedText
    >
    <div v-for="(line, i) in lines" :key="i" class="text-text-secondary text-2xs break-words">
      {{ line }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { I18nText } from "@/types/i18n";

const props = defineProps<{
  label: I18nText;
  value: string | number;
  sub?: I18nText | (I18nText | null)[];
  dataTest?: string;
}>();

const lines = computed(() => [props.sub ?? []].flat().filter((l): l is I18nText => !!l));
</script>
