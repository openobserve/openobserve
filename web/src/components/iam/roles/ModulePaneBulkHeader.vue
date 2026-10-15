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

<!-- An action column's header on All Modules: the column name with a box that ticks it on every listed module. -->
<template>
  <div class="flex items-center gap-1.5 py-1">
    <!-- The table clips header content to its box; vertical padding keeps the focus ring visible, with no side padding so the box lines up with the rows. -->
    <OCheckbox
      :model-value="state"
      :disabled="disabled"
      :aria-label="hint"
      :title="hint"
      :data-test="`edit-role-module-pane-bulk-${action}`"
      @update:model-value="emit('toggle')"
    />
    <span>{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";

const props = defineProps<{
  action: string;
  label: I18nText;
  state: boolean | "indeterminate";
  disabled: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();

const { t } = useI18nTyped();

const hint = computed(() => t("iam.editRole.bulkSelectColumn", { action: props.label }));
</script>
