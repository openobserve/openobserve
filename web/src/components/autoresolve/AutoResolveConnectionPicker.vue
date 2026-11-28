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
  <div class="flex flex-col gap-2">
    <div
      :class="[
        'flex items-start gap-x-3 gap-y-2 max-md:flex-col max-md:items-stretch',
        inlineChips ? '' : 'flex-wrap',
      ]"
    >
      <OSkeleton
        v-if="loading"
        :class="['h-8.5 min-w-0', inlineChips ? 'w-field-width-xs max-md:w-full' : 'w-full flex-1']"
        :data-test="`${testPrefix}-connections-loading`"
      />
      <OFormSelect
        v-else-if="name"
        :name="name"
        v-bind="selectProps"
        :class="selectClass"
        :data-test="`${testPrefix}-connections`"
      >
        <!-- The chosen MCPs are listed as chips with a remove button, so the trigger only adds. -->
        <template #trigger>
          <span class="text-select-placeholder flex-1 text-start text-sm">
            {{ t("autoresolve.saved.form.connectionsPlaceholder") }}
          </span>
        </template>
      </OFormSelect>
      <OSelect
        v-else
        :model-value="[...modelValue]"
        v-bind="selectProps"
        :class="selectClass"
        :data-test="`${testPrefix}-connections`"
        @update:model-value="(ids) => emit('update:modelValue', (ids ?? []) as string[])"
      >
        <template #trigger>
          <span class="text-select-placeholder flex-1 text-start text-sm">
            {{ t("autoresolve.saved.form.connectionsPlaceholder") }}
          </span>
        </template>
      </OSelect>
      <ul
        v-if="chips.length"
        :class="[
          'm-0 flex list-none flex-wrap items-center gap-1.5 p-0',
          inlineChips ? 'min-h-8.5 min-w-0 flex-1 max-md:min-h-0 max-md:flex-none' : 'w-full',
        ]"
        :aria-label="label"
        :data-test="`${testPrefix}-connection-chips`"
      >
        <li v-for="chip in chips" :key="chip.id" class="max-w-full">
          <AutoResolveRemovedConnection
            v-if="chip.removed"
            :name="chip.name"
            size="md"
            :removable="!disabled"
            @remove="remove(chip.id)"
          />
          <OTag
            v-else
            variant="default-soft"
            size="md"
            :label="raw(chip.name)"
            :removable="!disabled"
            :remove-label="t('autoresolve.connection.removeConnection', { name: raw(chip.name) })"
            :data-test="`${testPrefix}-connection-chip`"
            @remove="remove(chip.id)"
          />
        </li>
      </ul>
      <slot name="beside" />
    </div>
    <slot />
    <p
      v-if="help"
      class="text-text-secondary m-0 text-xs"
      :data-test="`${testPrefix}-connections-help`"
    >
      {{ help }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import AutoResolveRemovedConnection from "@/components/autoresolve/AutoResolveRemovedConnection.vue";
import type { AutoResolveConnectionRef } from "@/services/autoresolve";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** The chosen connection ids; inside an OForm the field named `name` holds them too. */
    modelValue: readonly string[];
    /** Every connection that can be chosen, plus chosen ones since removed (by last known name). */
    connections: readonly AutoResolveConnectionRef[];
    label: I18nText;
    /** The label names the field for assistive tech only. */
    hideLabel?: boolean;
    /** Binds the select to this OForm field, so the form validates it. */
    name?: string;
    /** Chosen ids known to be removed although `connections` does not mark them. */
    removedIds?: readonly string[];
    /** At this many chosen, the other options are disabled. */
    max?: number;
    inlineChips?: boolean;
    /** The connections are still loading: a skeleton holds the select's place. */
    loading?: boolean;
    help?: I18nText | null;
    required?: boolean;
    disabled?: boolean;
    testPrefix: string;
  }>(),
  {
    hideLabel: false,
    name: undefined,
    removedIds: () => [],
    max: undefined,
    inlineChips: false,
    loading: false,
    help: null,
    required: false,
    disabled: false,
  },
);

const emit = defineEmits<{ "update:modelValue": [ids: string[]] }>();

const { t } = useI18nTyped();

const chosen = computed(() => new Set(props.modelValue));
const atCap = computed(() => props.max !== undefined && props.modelValue.length >= props.max);

const options = computed(() =>
  props.connections.map((c) => ({
    label: raw(c.name),
    value: c.id,
    disabled: atCap.value && !chosen.value.has(c.id),
  })),
);

const selectClass = computed(() =>
  props.inlineChips ? "shrink-0 max-md:w-full" : "min-w-0 flex-1",
);

const selectProps = computed(() => ({
  label: props.hideLabel ? undefined : props.label,
  "aria-label": props.hideLabel ? props.label : undefined,
  options: options.value,
  width: props.inlineChips ? ("xs" as const) : undefined,
  dropdownStyle: props.inlineChips
    ? { minWidth: "min(var(--spacing-field-width-lg), calc(100vw - 2rem))" }
    : undefined,
  multiple: true,
  searchable: true,
  required: props.required,
  disabled: props.disabled,
}));

const chips = computed(() => {
  const byId = new Map(props.connections.map((c) => [c.id, c]));
  const removed = new Set(props.removedIds);
  return props.modelValue.map((id) => ({
    id,
    name: byId.get(id)?.name ?? "",
    removed: byId.get(id)?.removed === true || removed.has(id),
  }));
});

const remove = (id: string) =>
  emit(
    "update:modelValue",
    props.modelValue.filter((v) => v !== id),
  );
</script>
