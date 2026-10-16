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
  <ODropdown v-model:open="open" side="bottom" align="start">
    <template #trigger>
      <OButton
        size="icon-xs"
        variant="ghost"
        class="h-5! min-h-5! w-5! min-w-5! p-0!"
        :aria-label="t('profiles.rowActions')"
        :data-test="`${testId}-menu-trigger`"
        @click.stop
      >
        <OIcon name="more-vert" size="sm" />
      </OButton>
    </template>
    <ODropdownItem :data-test="`${testId}-copy`" @select="emit('copy')">
      {{ t("profiles.copyFunctionName") }}
    </ODropdownItem>
    <ODropdownItem v-if="showFocus" :data-test="`${testId}-focus`" @select="emit('focus')">
      {{ t("profiles.focusBlock") }}
    </ODropdownItem>
    <ODropdownItem :data-test="`${testId}-details`" @select="emit('details')">
      {{ t("profiles.functionDetails") }}
    </ODropdownItem>
  </ODropdown>
</template>

<script setup lang="ts">
import { ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import { useI18nTyped } from "@/types/i18n";

withDefaults(
  defineProps<{
    testId: string;
    showFocus?: boolean;
  }>(),
  { showFocus: true },
);

const emit = defineEmits<{
  copy: [];
  focus: [];
  details: [];
}>();

const { t } = useI18nTyped();
const open = ref(false);
</script>
