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
  <div
    v-if="items.length || always"
    class="text-text-secondary flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs"
    data-test="rum-analytics-funnel-app-filters"
  >
    <span v-if="!items.length" data-test="rum-analytics-funnel-app-filters-none">{{
      t("rum.analytics.appFilters.nothingHidden")
    }}</span>
    <span v-else>{{ t("rum.analytics.appFilters.hiddenLabel") }}</span>
    <template v-for="(item, i) in items" :key="item.id">
      <span v-if="i > 0" aria-hidden="true">{{ separator }}</span>
      <span :data-test="`rum-analytics-funnel-app-filters-${item.id}`">{{ item.text }}</span>
    </template>
    <span v-if="items.length" aria-hidden="true">{{ separator }}</span>
    <OButton
      v-if="canInclude"
      variant="ghost-primary"
      size="xs"
      data-test="rum-analytics-funnel-app-filters-include"
      @click="emit('include')"
      >{{ t("rum.analytics.appFilters.includeHidden") }}</OButton
    >
    <OButton
      variant="ghost-primary"
      size="xs"
      data-test="rum-analytics-funnel-app-filters-edit"
      @click="emit('edit')"
      >{{ t("rum.analytics.appFilters.edit") }}</OButton
    >
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { AppFilterCounts } from "@/composables/rum/useAppFilterCounts";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";

const props = defineProps<{
  counts: AppFilterCounts | null;
  included: boolean;
  always?: boolean;
}>();
const emit = defineEmits<{ include: []; edit: [] }>();
const { t } = useI18nTyped();
const separator = raw("·");

// Included rule traffic is no longer removed from the view, so only synthetic sessions stay listed.
const items = computed<{ id: string; text: I18nText }[]>(() => {
  const c = props.counts;
  if (!c) return [];
  const n = (v: number) => addCommasToNumber(v);
  return [
    ...(!props.included && c.builtin
      ? [{ id: "builtin", text: t("rum.analytics.appFilters.builtin", { count: n(c.builtin) }) }]
      : []),
    ...(!props.included && c.rules
      ? [{ id: "rules", text: t("rum.analytics.appFilters.rules", { count: n(c.rules) }) }]
      : []),
    ...(c.synthetic > 0
      ? [
          {
            id: "synthetic",
            text: t("rum.analytics.appFilters.synthetic", { count: n(c.synthetic) }),
          },
        ]
      : []),
  ];
});

const canInclude = computed(
  () =>
    !props.included &&
    !!props.counts &&
    (props.counts.builtin ?? 0) + (props.counts.rules ?? 0) > 0,
);
</script>
