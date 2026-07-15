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
  <div
    class="flex py-1 px-1.5 text-xs"
    :class="[
      showBorder
        ? 'border-b border-solid border-card-glass-border'
        : '',
    ]"
    :data-test="dataTest"
  >
    <div
      class="w-25 font-medium text-text-secondary shrink-0"
    >
      {{ label }}:
    </div>
    <div class="flex-1 break-words" :class="valueClass">
      <slot>{{ value }}</slot>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  label: string;
  value?: string | number;
  showBorder?: boolean;
  valueClass?: string;
  dataTest?: string;
}

withDefaults(defineProps<Props>(), {
  value: "",
  showBorder: true,
  valueClass: "",
  dataTest: "",
});
</script>
