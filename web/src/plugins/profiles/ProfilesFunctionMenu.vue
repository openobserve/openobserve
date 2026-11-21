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

<!-- Row menu (⋮) for a function in the Profiles tables: the same actions as the flame graph frame menu. -->
<template>
  <ODropdown v-model:open="open" side="bottom" align="start">
    <template #trigger>
      <OButton
        variant="ghost"
        size="icon-chip"
        icon-left="more-vert"
        class="shrink-0"
        :aria-label="t('profiles.functionActions', { name })"
        :data-test="`${dataTest}-menu`"
        @click.stop
      />
    </template>
    <FlameFunctionMenuItems
      :name="name"
      :test-ids="testIds"
      @copy="emit('copy', $event)"
      @search="emit('search', $event)"
      @details="emit('details', $event)"
      @sandwich="emit('sandwich', $event)"
    >
      <ODropdownItem icon-left="flame" :data-test="`${dataTest}-show`" @select="emit('show')">{{
        focusable ? t("profiles.focusInFlameGraph") : t("profiles.showInFlameGraph")
      }}</ODropdownItem>
    </FlameFunctionMenuItems>
  </ODropdown>
</template>

<script setup lang="ts">
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import FlameFunctionMenuItems from "@/components/common/FlameFunctionMenuItems.vue";
import { computed, ref } from "vue";
import { useI18nTyped } from "@/types/i18n";

const props = defineProps<{
  name: string;
  /** A Call Tree row is one call path, so the flame graph can focus on it; a Top Table row is a whole function. */
  focusable?: boolean;
  dataTest: string;
}>();
const emit = defineEmits<{
  copy: [name: string];
  search: [name: string];
  show: [];
  sandwich: [name: string];
  details: [name: string];
}>();

const { t } = useI18nTyped();
const open = ref(false);
const testIds = computed(() => ({
  copy: `${props.dataTest}-copy`,
  search: `${props.dataTest}-search`,
  details: `${props.dataTest}-details`,
  sandwich: `${props.dataTest}-sandwich`,
}));
</script>
