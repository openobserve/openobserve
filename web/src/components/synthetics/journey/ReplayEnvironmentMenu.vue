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

<script setup lang="ts">
import { computed } from "vue";
import { useI18nTyped } from "@/types/i18n";
import {
  GLOBAL_ONLY,
  type ReplayEnvironmentOption,
} from "@/components/synthetics/variables/replayInputs";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownSeparator from "@/lib/overlay/Dropdown/ODropdownSeparator.vue";

const props = defineProps<{
  options: ReplayEnvironmentOption[];
  selectedId: string;
  disabled: boolean;
}>();

const emit = defineEmits<{
  "update:selected-id": [id: string];
}>();

const { t } = useI18nTyped();

// One choice is no choice, so the arrow would only add noise.
const visible = computed(() => props.options.length > 1);

const inTest = computed(() => props.options.filter((o) => o.inTest));
const notInTest = computed(() => props.options.filter((o) => !o.inTest));

function itemKey(option: ReplayEnvironmentOption) {
  return option.id === GLOBAL_ONLY ? "global" : option.id;
}
</script>

<template>
  <ODropdown v-if="visible" side="bottom" align="end">
    <template #trigger>
      <OButton
        variant="outline"
        size="sm"
        icon-left="arrow-drop-down"
        :disabled="disabled"
        :aria-label="t('synthetics.journey.replayEnv.menuAria')"
        data-test="synthetics-journey-replay-menu-trigger"
      >
        <OTooltip :content="t('synthetics.journey.replayEnv.menuAria')" side="bottom" />
      </OButton>
    </template>
    <div class="flex flex-col px-3 py-1.5">
      <span class="text-text-heading text-sm font-semibold">
        {{ t("synthetics.journey.replayEnv.menuTitle") }}
      </span>
      <span class="text-text-secondary text-xs">
        {{ t("synthetics.journey.replayEnv.sessionOnly") }}
      </span>
    </div>
    <template
      v-for="group in [
        { options: inTest, label: undefined },
        { options: notInTest, label: t('synthetics.journey.replayEnv.notInTest') },
      ]"
      :key="group.label ?? 'in-test'"
    >
      <template v-if="group.options.length">
        <ODropdownSeparator v-if="group.label" />
        <ODropdownGroup :label="group.label">
          <ODropdownItem
            v-for="option in group.options"
            :key="option.id"
            :data-test="`synthetics-journey-replay-menu-env-${itemKey(option)}`"
            @select="emit('update:selected-id', option.id)"
          >
            <span class="flex min-w-0 flex-col">
              <span :class="{ 'text-accent': option.id === selectedId }">{{ option.name }}</span>
              <span class="text-text-secondary text-xs">{{ option.host }}</span>
            </span>
            <span v-if="option.id === selectedId" class="sr-only">
              {{ t("synthetics.journey.replayEnv.selected") }}
            </span>
            <template v-if="option.id === selectedId" #icon-right>
              <span class="ms-auto inline-flex">
                <OIcon name="check" size="sm" aria-hidden="true" />
              </span>
            </template>
          </ODropdownItem>
        </ODropdownGroup>
      </template>
    </template>
  </ODropdown>
</template>
