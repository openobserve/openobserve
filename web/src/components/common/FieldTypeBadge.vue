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
  <span
    v-if="info"
    data-test="common-field-type-badge"
    class="inline-flex items-center justify-center w-4 h-4 rounded-[0.2rem] text-[0.6rem] font-bold mr-[0.3rem] shrink-0 align-middle"
    :style="{ backgroundColor: info.color, color: info.textColor }"
    :title="dataType"
  >{{ info.label }}</span>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  dataType?: string;
}>();

const info = computed(() => {
  const t = (props.dataType || "").toLowerCase();
  if (!t) return null;
  if (t === "boolean")
    return {
      label: "B",
      color: "var(--o2-field-type-boolean-bg)",
      textColor: "var(--o2-field-type-boolean-text)",
    };
  if (t.includes("float"))
    return {
      label: "~",
      color: "var(--o2-field-type-float-bg)",
      textColor: "var(--o2-field-type-float-text)",
    };
  if (t.includes("int") || t.includes("uint"))
    return {
      label: "#",
      color: "var(--o2-field-type-number-bg)",
      textColor: "var(--o2-field-type-number-text)",
    };
  if (
    t.includes("timestamp") ||
    t === "date32" ||
    t === "date64" ||
    t === "date"
  )
    return {
      label: "T",
      color: "var(--o2-field-type-timestamp-bg)",
      textColor: "var(--o2-field-type-timestamp-text)",
    };
  return {
    label: "S",
    color: "var(--o2-field-type-string-bg)",
    textColor: "var(--o2-field-type-string-text)",
  };
});
</script>

