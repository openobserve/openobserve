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
  <div class="flex shrink-0 items-center gap-2">
    <span data-test="edit-role-permissions-count" class="text-sm font-bold">
      {{ t("iam.editRole.permissionCountSingular", { count }) }}
    </span>
    <OToggleGroup
      data-test="edit-role-permissions-ui-type-toggle"
      :model-value="modelValue"
      @update:model-value="(value) => emit('update:modelValue', value as string)"
    >
      <OToggleGroupItem value="table" size="sm" data-test="edit-role-permissions-show-table-btn">
        {{ t("iam.editRole.table") }}
      </OToggleGroupItem>
      <OToggleGroupItem value="json" size="sm" data-test="edit-role-permissions-show-json-btn">
        {{ t("iam.editRole.json") }}
      </OToggleGroupItem>
    </OToggleGroup>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";

defineProps<{ count: number; modelValue: string }>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { t } = useI18nTyped();
</script>
