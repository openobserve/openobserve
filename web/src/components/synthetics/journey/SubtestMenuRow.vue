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
import type { I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

// OButton has no list-row size; these overrides live here only until the ODropdown rebuild.
const ROW_CLASS = "h-auto! justify-start! py-2! text-start whitespace-normal!";

withDefaults(
  defineProps<{
    title: I18nText;
    subtitle?: I18nText;
    disabled?: boolean;
    loading?: boolean;
  }>(),
  { subtitle: undefined, disabled: false, loading: false },
);

const emit = defineEmits<{ select: [] }>();
</script>

<template>
  <OButton
    variant="ghost"
    size="md"
    block
    :class="ROW_CLASS"
    :loading="loading"
    :disabled="disabled"
    @click="emit('select')"
  >
    <span class="flex min-w-0 flex-1 flex-col">
      <OTruncatedText
        class="text-sm"
        :class="{ 'text-text-body': !disabled }"
        data-test="synthetics-subtest-row-title"
        >{{ title }}</OTruncatedText
      >
      <OTruncatedText
        v-if="subtitle"
        class="text-xs font-normal"
        :class="{ 'text-text-secondary': !disabled }"
        data-test="synthetics-subtest-row-subtitle"
      >
        {{ subtitle }}
      </OTruncatedText>
    </span>
  </OButton>
</template>
