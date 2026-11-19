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

<!-- "in the last [N] minutes" inside a condition sentence: the alert's one look back field.
     The row below prints its error, so the field keeps only its red ring. -->
<template>
  <i18n-t :keypath="keypath" :plural="shown" tag="span" scope="global">
    <template #n>
      <span class="inline-flex align-middle">
        <OFormInput
          name="trigger_condition.period"
          type="number"
          :size="size"
          fit-content
          min="1"
          :debounce="300"
          :aria-label="t('alerts.form.names.lookBack')"
          :data-test="dataTest"
          @update:model-value="onInput"
        >
          <template #error />
        </OFormInput>
      </span>
    </template>
  </i18n-t>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import type { InputSize } from "@/lib/forms/Input/OInput.types";
import { useI18nTyped, type I18nKey } from "@/types/i18n";

const props = withDefaults(
  defineProps<{ minutes: number; size?: InputSize; dataTest?: string; keypath?: I18nKey }>(),
  { size: "sm", dataTest: "alert-settings-period-input", keypath: "alerts.form.window.inTheLast" },
);
const emit = defineEmits<{ (e: "update:minutes", value: number | ""): void }>();
const { t } = useI18nTyped();
// The plural follows the number the sentence shows; an empty field reads as the plural.
const shown = computed(() => (props.minutes > 0 ? props.minutes : 2));
const onInput = (value: unknown) =>
  emit("update:minutes", value === "" || value === null ? "" : Number(value));
</script>
