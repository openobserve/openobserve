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

<!-- One start-picker option: its conditions plus its meta line. -->
<template>
  <span class="flex w-full min-w-0 items-center gap-2" :data-test="dataTest">
    <!-- First child: a child-mode tooltip binds to its previous sibling, so here it binds to the whole row. -->
    <OTooltip v-if="conditions.length" side="left">
      <template #content>
        <span class="flex flex-col" :data-test="dataTest ? `${dataTest}-tooltip` : undefined">
          <span v-for="item in conditions" :key="item.name">{{ raw(lineOf(item)) }}</span>
        </span>
      </template>
    </OTooltip>
    <OnCallFitChips v-if="conditions.length" :items="conditions" class="flex-1">
      <template #item="{ item }">
        <ODimensionChip :dim-key="item.name" :key-label="item.label" :value="item.value" />
      </template>
    </OnCallFitChips>
    <OTruncatedText v-else class="min-w-0 flex-1">{{ option.label }}</OTruncatedText>
    <OText v-if="meta" variant="meta" class="shrink-0 whitespace-nowrap">{{ meta }}</OText>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OnCallFitChips from "@/components/oncall/OnCallFitChips.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { fieldLabel } from "@/utils/oncall";

interface StartCondition {
  name: string;
  label: string;
  value: string;
  prefix: boolean;
}

const props = withDefaults(
  defineProps<{
    /** The picker option; reads its `dimensions` and its `meta` line. */
    option: SelectOption;
    aliases?: { id: string; display?: string }[];
    dataTest?: string;
  }>(),
  { aliases: () => [], dataTest: undefined },
);

const { t } = useI18nTyped();

const dimensions = computed<Record<string, string>>(() => {
  const value = props.option.dimensions;
  return value && typeof value === "object" ? (value as Record<string, string>) : {};
});

const meta = computed<I18nText | undefined>(() =>
  typeof props.option.meta === "string" && props.option.meta ? raw(props.option.meta) : undefined,
);

/// A trailing `*` is the engine's prefix claim, so it reads as "starts with" rather than a literal star.
const conditions = computed<StartCondition[]>(() =>
  Object.keys(dimensions.value)
    .sort()
    .map((name) => {
      const value = String(dimensions.value[name] ?? "");
      const field = fieldLabel(name, props.aliases);
      const prefix = value.endsWith("*");
      return {
        name,
        label: prefix ? String(t("oncall.ruleChipStartsWith", { field: raw(field) })) : field,
        value: prefix ? value.slice(0, -1) : value,
        prefix,
      };
    }),
);

function lineOf(item: StartCondition): string {
  return item.prefix ? `${item.label} ${item.value}` : `${item.label} = ${item.value}`;
}
</script>
