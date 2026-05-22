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
    class="o-field-label tw:flex tw:items-center tw:gap-[0.375rem] tw:min-w-0 tw:flex-1 tw:py-[0.25rem]"
  >
    <OIcon
      v-if="showTypeIcon"
      :name="getTypeIcon(field.type)"
      size="xs"
      class="tw:flex-shrink-0 tw:opacity-60 tw:text-field-list-label-icon"
    />
    <span
      class="tw:truncate tw:flex-1 tw:min-w-0 tw:leading-relaxed tw:text-[0.82rem] tw:text-field-list-label-text"
    >
      {{ field.label ?? field.name }}
    </span>
  </div>
</template>

<script setup lang="ts">
import OIcon from "@/lib/core/Icon/OIcon.vue";

interface Props {
  field: { name: string; label?: string; type?: string };
  showTypeIcon?: boolean;
}

withDefaults(defineProps<Props>(), {
  showTypeIcon: false,
});

function getTypeIcon(type: string | undefined): string {
  if (!type) return "text-fields";
  switch (type.toLowerCase()) {
    case "utf8":
    case "string":
    case "text":
      return "text-fields";
    case "boolean":
    case "bool":
      return "toggle-off";
    case "int64":
    case "float64":
    case "int":
    case "float":
    case "number":
      return "tag";
    default:
      return "text-fields";
  }
}
</script>
