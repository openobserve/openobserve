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
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import type { I18nText } from "@/types/i18n";

defineProps<{ label: I18nText; help: I18nText }>();
</script>

<template>
  <OSettingRow control-at="end" :label="label">
    <template #description>
      {{ help }}
      <slot name="line" />
    </template>
    <div class="flex w-full min-w-0 flex-col items-start gap-1.5">
      <slot />
    </div>
  </OSettingRow>
</template>
