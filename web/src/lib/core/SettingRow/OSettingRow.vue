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

<!-- The last row drops its own rule, so a card needs no per-row conditionals. -->
<template>
  <div
    :class="[
      atEnd
        ? '@container flex flex-wrap items-center gap-x-6 gap-y-2'
        : 'flex items-center gap-6 max-md:flex-col max-md:items-stretch max-md:gap-2',
      'border-border-default border-b px-3 py-3 last:border-b-0',
      disabled && 'opacity-60',
    ]"
    data-o-setting-row
    :data-test="dataTest"
    :aria-busy="loading ? 'true' : undefined"
  >
    <div
      class="min-w-0"
      :class="atEnd ? 'flex-1 @max-2xl:basis-full' : 'w-[22.5%] shrink-0 max-md:w-full'"
    >
      <div class="text-text-heading text-sm font-medium">{{ label }}</div>
      <div
        v-if="shownError"
        :id="errorId"
        role="alert"
        class="text-input-error-text mt-0.5 flex items-start gap-1 text-xs"
      >
        <OIcon name="error-outline" size="xs" class="mt-0.5 shrink-0" />
        <span class="min-w-0" :data-test="errorTestId">{{ shownError }}</span>
      </div>
      <div v-else-if="description || $slots.description" class="text-text-secondary mt-0.5 text-xs">
        <slot name="description">{{ description }}</slot>
      </div>
      <!-- Holds the line an error will take, so a row without help does not grow. -->
      <div v-else-if="reservesLine" class="mt-0.5 min-h-4" aria-hidden="true"></div>
    </div>
    <div
      class="flex items-center"
      :class="
        atEnd
          ? 'w-75 shrink-0 justify-start @max-2xl:w-full'
          : 'shrink-0 justify-end max-md:min-w-0 max-md:justify-start'
      "
    >
      <OSkeleton
        v-if="loading"
        animation="none"
        aria-hidden="true"
        class="h-8.5"
        :class="atEnd ? 'w-full' : 'w-40'"
      />
      <ControlSlot v-else :render="$slots.default" :described-by="describedBy" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { cloneVNode, Comment, computed, inject, provide, Text, useId } from "vue";
import type { FunctionalComponent, VNode } from "vue";

import { raw } from "@/types/i18n";

import OIcon from "../Icon/OIcon.vue";
import OSkeleton from "../../feedback/Skeleton/OSkeleton.vue";
import { visibleFieldError } from "../../forms/Form/fieldError";
import { FORM_CONTEXT_KEY, SETTING_ROW_ERROR_KEY } from "../../forms/Form/OForm.types";
import type { SettingRowProps, SettingRowSlots } from "./OSettingRow.types";

const props = withDefaults(defineProps<SettingRowProps>(), { controlAt: "label" });
defineSlots<SettingRowSlots>();

const form = inject(FORM_CONTEXT_KEY, null);
const errorId = useId();

const atEnd = computed(() => props.controlAt === "end");

const fieldErrors = form?.useStore((s: any) =>
  props.name ? s.fieldMeta?.[props.name]?.errors : undefined,
);

const shownError = computed(() => {
  if (props.error) return props.error;
  if (!form || !props.name) return undefined;
  const state = { meta: { errors: fieldErrors?.value ?? [] } };
  const message = visibleFieldError(form, { name: props.name, state }).message;
  return message === undefined ? undefined : raw(message);
});

const reservesLine = computed(() => props.name !== undefined || props.error !== undefined);
const describedBy = computed(() => (shownError.value ? errorId : undefined));
const errorTestId = computed(
  () => props.errorDataTest ?? (props.dataTest ? `${props.dataTest}-error` : undefined),
);

provide(SETTING_ROW_ERROR_KEY, {
  get name() {
    return props.name;
  },
  errorId,
});

type ControlSlotProps = {
  render?: SettingRowSlots["default"];
  describedBy?: string;
};

// A lone control gets the error's id as an attr; its wrapper forwards attrs to the focusable element.
const ControlSlot: FunctionalComponent<ControlSlotProps> = ({ render, describedBy: id }) => {
  const nodes = (render?.({ describedBy: id }) ?? []) as VNode[];
  const controls = nodes.filter((n) => n.type !== Comment && n.type !== Text);
  if (!id || controls.length !== 1 || typeof controls[0].type === "symbol") return nodes;
  const own = controls[0].props?.["aria-describedby"];
  const merged = cloneVNode(controls[0], { "aria-describedby": own ? `${own} ${id}` : id });
  return nodes.map((n) => (n === controls[0] ? merged : n));
};
ControlSlot.props = ["render", "describedBy"];
</script>
