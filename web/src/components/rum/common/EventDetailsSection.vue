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
  <div class="tw:mb-3" :data-test="dataTest">
    <div class="tw:font-bold tw:mb-1 tw:text-sm">{{ title }}</div>
    <div>
      <KeyValueRow
        v-for="(field, index) in visibleFields"
        :key="field.key"
        :label="field.label"
        :value="field.value"
        :show-border="index < visibleFields.length - 1"
        :value-class="field.valueClass"
        :data-test="`${dataTest}-${field.key}`"
      >
        <template v-if="field.slot">
          <slot :name="field.key" :value="field.value"></slot>
        </template>
      </KeyValueRow>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import KeyValueRow from "./KeyValueRow.vue";

interface Field {
  key: string;
  label: string;
  value: any;
  valueClass?: string;
  slot?: boolean;
  condition?: boolean;
}

interface Props {
  title: string;
  fields: Field[];
  dataTest?: string;
}

const props = withDefaults(defineProps<Props>(), {
  dataTest: "",
});

const visibleFields = computed(() => {
  return props.fields.filter((field) => {
    // Show field if condition is not specified or if condition is true
    return field.condition !== false && field.value != null && field.value !== "";
  });
});
</script>
