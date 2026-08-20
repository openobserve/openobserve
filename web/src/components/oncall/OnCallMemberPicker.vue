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

<!--
  An ordered list of people, as one control the width of a name.

  A multi-select's chip row grows a row taller with every person, which turns a
  table of layers into a ragged column. Faces plus "Mei, Jae +1" says the same
  thing in one line — the count is what is read at this size, and the whole list
  is one click away in the dropdown.
-->
<template>
  <OSelect
    :model-value="model"
    :options="options"
    multiple
    searchable
    :placeholder="placeholder"
    :aria-label="ariaLabel"
    size="sm"
    :data-test="dataTest"
    @update:model-value="(value: SelectModelValue) => (model = (value ?? []) as string[])"
  >
    <template #trigger>
      <span class="flex min-w-0 items-center gap-2">
        <span v-if="model.length" class="flex items-center" aria-hidden="true">
          <span
            v-for="(email, index) in faces"
            :key="email"
            :class="index ? '-ms-1.5' : ''"
            class="ring-surface-base rounded-full ring-2"
          >
            <OAvatar :value="email" size="sm" />
          </span>
        </span>
        <span class="truncate text-sm">{{ summary }}</span>
      </span>
    </template>
  </OSelect>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OAvatar from "@/lib/core/Avatar/OAvatar.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectModelValue, SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    options: SelectOption[];
    /** How many names are spelled out before the rest collapse into "+N". */
    named?: number;
    placeholder?: I18nText;
    ariaLabel?: I18nText;
    dataTest?: string;
  }>(),
  { named: 2, placeholder: undefined, ariaLabel: undefined, dataTest: undefined },
);

const model = defineModel<string[]>({ default: () => [] });

const { t } = useI18nTyped();

const faces = computed(() => model.value.slice(0, 3));

/// The part of the address a person answers to. The picker's job here is
/// recognition at a glance, and nobody scans a domain.
function shortName(email: string): string {
  return email.split("@")[0] ?? email;
}

const summary = computed<I18nText>(() => {
  if (!model.value.length) return props.placeholder ?? t("oncall.presetMembersEmpty");
  const names = model.value.slice(0, props.named).map(shortName).join(", ");
  const extra = model.value.length - props.named;
  return extra > 0 ? t("oncall.presetMembersMore", { names, count: extra }) : raw(names);
});
</script>
