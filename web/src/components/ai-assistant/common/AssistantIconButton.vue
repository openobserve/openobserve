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
  <OButton
    :variant="variant"
    :size="size === 'toolbar' ? 'icon-toolbar' : 'icon-sm'"
    :disabled="disabled"
    :loading="loading"
    :focusable-unavailable="unavailable"
    :aria-label="label"
    :aria-pressed="pressed"
    :data-test="dataTest"
    class="max-md:min-h-11 max-md:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    @click="emit('click', $event)"
  >
    <OIcon :name="icon" size="sm" />
    <template v-if="unavailable" #unavailable-reason>{{ disabledReason }}</template>
    <OTooltip :content="tooltip" :shortcut-id="shortcutId" />
  </OButton>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";

import type {
  AssistantIconButtonEmits,
  AssistantIconButtonProps,
} from "./AssistantIconButton.types";

const props = withDefaults(defineProps<AssistantIconButtonProps>(), {
  shortcutId: undefined,
  variant: "ghost",
  size: "sm",
  pressed: undefined,
  loading: false,
  disabled: false,
  disabledReason: undefined,
});

const emit = defineEmits<AssistantIconButtonEmits>();

// A disabled button with a reason stays focusable so keyboard and screen-reader users can reach why.
const unavailable = computed(() => props.disabled && !!props.disabledReason);
const tooltip = computed(() =>
  unavailable.value && props.disabledReason ? props.disabledReason : props.label,
);
</script>
