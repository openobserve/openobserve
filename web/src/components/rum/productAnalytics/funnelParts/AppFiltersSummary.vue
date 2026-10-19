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
  <FunnelSectionRow
    v-if="items.length || always"
    :title="t('rum.analytics.exclusions.title', { app: raw(app) })"
    :stacked="stacked"
    :boxed="stacked"
    test-id="rum-analytics-funnel-app-filters"
  >
    <span
      v-if="!items.length"
      class="text-text-secondary text-xs"
      data-test="rum-analytics-funnel-app-filters-none"
      >{{ t("rum.analytics.appFilters.nothingHidden") }}</span
    >
    <template v-if="stacked">
      <span
        v-for="item in items"
        :key="item.id"
        class="text-text-body basis-full"
        :data-test="`rum-analytics-funnel-app-filters-${item.id}`"
        >{{ item.text }}</span
      >
      <span class="basis-full">
        <OSwitch
          :model-value="included"
          :label="t('rum.analytics.appFilters.switchLabel')"
          size="sm"
          :disabled="!included && !canInclude"
          data-test="rum-analytics-funnel-app-filters-switch"
          @update:model-value="(v) => (v ? emit('include') : emit('hide'))"
        />
      </span>
    </template>
    <template v-else>
      <OTag
        v-for="item in items"
        :key="item.id"
        :label="item.text"
        variant="default-soft"
        size="sm"
        :data-test="`rum-analytics-funnel-app-filters-${item.id}`"
      />
    </template>
    <template #trailing>
      <OButton
        v-if="canInclude && !stacked"
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
    </template>
  </FunnelSectionRow>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import FunnelSectionRow from "@/components/rum/productAnalytics/funnelParts/FunnelSectionRow.vue";
import type { AppFilterCounts } from "@/composables/rum/useAppFilterCounts";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";

const props = defineProps<{
  counts: AppFilterCounts | null;
  included: boolean;
  app: string;
  always?: boolean;
  stacked?: boolean;
}>();
const emit = defineEmits<{ include: []; hide: []; edit: [] }>();
const { t } = useI18nTyped();

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
