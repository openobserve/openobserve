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
  <div class="flex flex-col gap-0.5" data-test="autoresolve-remember">
    <OCheckbox
      :model-value="modelValue"
      :label="t('autoresolve.correction.remember', { name: raw(name) })"
      :disabled="disabled"
      data-test="autoresolve-remember-checkbox"
      @update:model-value="(value) => emit('update:modelValue', value === true)"
    />
    <p class="text-text-secondary m-0 ps-6 text-xs">
      {{ t("autoresolve.correction.rememberHelp") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import { raw, useI18nTyped } from "@/types/i18n";

defineProps<{
  modelValue: boolean;
  /** The saved AutoResolve whose later runs read the note. */
  name: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const { t } = useI18nTyped();
</script>
