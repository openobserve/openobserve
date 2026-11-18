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

<!-- "in the last [N] minutes" inside a condition sentence; the number is the alert's look back. -->
<template>
  <i18n-t keypath="alerts.form.window.inTheLast" :plural="shown" tag="span" scope="global">
    <template #n>
      <span class="inline-flex align-middle">
        <OInput
          :model-value="minutes > 0 ? minutes : ''"
          type="number"
          :size="size"
          fit-content
          :min="1"
          :debounce="300"
          :error="!(minutes > 0)"
          :aria-label="t('alerts.form.names.lookBack')"
          :data-test="dataTest"
          @update:model-value="onInput"
        />
      </span>
    </template>
  </i18n-t>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import type { InputSize } from "@/lib/forms/Input/OInput.types";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{ minutes: number; size?: InputSize; dataTest?: string }>(),
  { size: "sm", dataTest: "alert-condition-window-input" },
);
const emit = defineEmits<{ (e: "update:minutes", value: number | ""): void }>();
const { t } = useI18nTyped();
// The plural follows the number the sentence shows; an empty field reads as the plural.
const shown = computed(() => (props.minutes > 0 ? props.minutes : 2));
// A cleared field passes on empty, as Look back's own field does, so its required error shows.
const onInput = (value: unknown) =>
  emit("update:minutes", value === "" || value === null ? "" : Number(value));
</script>
