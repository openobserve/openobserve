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

const props = withDefaults(
  defineProps<{
    options: ReplayEnvironmentOption[];
    selectedId: string;
    disabled: boolean;
    /** Stored secrets the journey needs in the selected environment. */
    secretsNeeded?: number;
    secretsEntered?: number;
    /** The last replay failed while it used a typed secret. */
    secretFailed?: boolean;
  }>(),
  { secretsNeeded: 0, secretsEntered: 0, secretFailed: false },
);

const emit = defineEmits<{
  "update:selected-id": [id: string];
  "edit-secrets": [];
}>();

const { t } = useI18nTyped();

const secretCounts = computed(() => ({
  entered: props.secretsEntered,
  needed: props.secretsNeeded,
}));

const selectedName = computed(
  () => props.options.find((o) => o.id === props.selectedId)?.name ?? "",
);

const groups = computed(() =>
  [
    { key: "in-test", label: undefined, options: props.options.filter((o) => o.inTest) },
    {
      key: "not-in-test",
      label: t("synthetics.journey.replayEnv.notInTest"),
      options: props.options.filter((o) => !o.inTest),
    },
  ].filter((group) => group.options.length > 0),
);

function itemKey(option: ReplayEnvironmentOption) {
  return option.id === GLOBAL_ONLY ? "global" : option.id;
}
</script>

<template>
  <ODropdown side="bottom" align="end">
    <template #trigger>
      <OButton
        variant="outline"
        size="xs"
        :disabled="disabled"
        :aria-label="t('synthetics.journey.replayEnv.triggerAria', { environment: selectedName })"
        data-test="synthetics-journey-replay-menu-trigger"
      >
        <!-- First child so it anchors to the whole button rather than a sibling span. -->
        <OTooltip :content="t('synthetics.journey.replayEnv.menuAria')" side="bottom" />
        <OIcon name="dns" size="sm" aria-hidden="true" />
        <span class="text-text-secondary font-normal">
          {{ t("synthetics.journey.replayEnv.inLabel") }}
        </span>
        <span class="max-w-40 truncate">{{ selectedName }}</span>
        <span
          v-if="secretFailed"
          class="bg-status-error-text size-2 shrink-0 rounded-full"
          aria-hidden="true"
          data-test="synthetics-journey-replay-menu-secret-failed"
        />
        <OIcon name="arrow-drop-down" size="sm" aria-hidden="true" />
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
    <template v-for="group in groups" :key="group.key">
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
    <template v-if="secretsNeeded > 0">
      <ODropdownSeparator />
      <ODropdownItem
        icon-left="key"
        :aria-label="
          t('synthetics.journey.replaySecrets.menuAria', {
            environment: selectedName,
            ...secretCounts,
          })
        "
        data-test="synthetics-journey-replay-menu-secrets"
        @select="emit('edit-secrets')"
      >
        <span>{{ t("synthetics.journey.replaySecrets.menuItem", secretCounts) }}</span>
        <template v-if="secretFailed" #icon-right>
          <span class="bg-status-error-text ms-auto size-2 rounded-full" aria-hidden="true" />
        </template>
      </ODropdownItem>
    </template>
  </ODropdown>
</template>
