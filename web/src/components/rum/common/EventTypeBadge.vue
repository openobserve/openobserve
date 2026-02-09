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
    class="tw:px-1 tw:py-0.5 tw:rounded tw:text-[10px] tw:font-semibold tw:uppercase tw:mr-1.5"
    :class="getEventTypeClass(type)"
    :data-test="dataTest"
  >
    {{ type }}
  </div>
</template>

<script setup lang="ts">
interface Props {
  type: string;
  dataTest?: string;
}

withDefaults(defineProps<Props>(), {
  dataTest: "",
});

const getEventTypeClass = (type: string) => {
  const classes: { [key: string]: string } = {
    error:
      "tw:bg-red-100 tw:text-red-700 tw:border tw:border-solid tw:border-red-300",
    action:
      "tw:bg-blue-100 tw:text-blue-700 tw:border tw:border-solid tw:border-blue-300",
    view: "tw:bg-green-100 tw:text-green-700 tw:border tw:border-solid tw:border-green-300",
    resource:
      "tw:bg-purple-100 tw:text-purple-700 tw:border tw:border-solid tw:border-purple-300",
  };
  return classes[type] || "tw:bg-grey-100 tw:text-grey-700";
};
</script>
