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
    class="px-1 py-0.5 rounded text-[10px] font-semibold uppercase mr-1.5"
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
      "bg-red-100 text-red-700 border border-solid border-red-300",
    action:
      "bg-blue-100 text-blue-700 border border-solid border-blue-300",
    view: "bg-green-100 text-green-700 border border-solid border-green-300",
    resource:
      "bg-purple-100 text-purple-700 border border-solid border-purple-300",
  };
  return classes[type] || "bg-gray-200 text-gray-500-700";
};
</script>
