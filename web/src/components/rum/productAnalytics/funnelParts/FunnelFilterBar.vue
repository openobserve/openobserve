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
    :title="t('rum.analytics.funnel.filterAllTitle')"
    :caption="t('rum.analytics.funnel.filterAllCaption')"
    :stacked="stacked"
    test-id="rum-analytics-funnel-filter-all"
  >
    <template #body>
      <FilterBuilder
        profile="rum-funnel"
        :model-value="def.f ?? []"
        :fields="builderFields"
        :load-values="loadValues"
        :layout="stacked ? 'vertical' : undefined"
        :placeholder="t('rum.analytics.funnel.addFilter')"
        data-test="rum-analytics-funnel-filter-builder"
        @update:model-value="onChange"
      />
      <template v-if="notice">
        <OBanner
          variant="warning"
          dense
          :content="
            t('rum.analytics.funnel.filterNotice', {
              kept: raw(addCommasToNumber(notice.kept)),
              opened: raw(addCommasToNumber(notice.opened)),
              unit: unit,
            })
          "
          data-test="rum-analytics-funnel-filter-notice"
        >
          <template #actions>
            <OButton
              variant="ghost"
              size="xs"
              data-test="rum-analytics-funnel-filter-notice-break-down"
              @click="emit('break-down', notice.field)"
              >{{
                t(
                  def.breakdown
                    ? "rum.analytics.funnel.breakdownReplace"
                    : "rum.analytics.funnel.filterNoticeAction",
                  { field: raw(notice.field) },
                )
              }}</OButton
            >
          </template>
        </OBanner>
        <span>
          <OPopover
            align="start"
            content-class="p-3 w-80 max-w-[calc(100vw-1.5rem)]"
            :aria-label="t('rum.analytics.funnel.filterNoticeWhy')"
          >
            <template #trigger>
              <OButton
                variant="ghost-primary"
                size="xs"
                icon-left="info-outline"
                data-test="rum-analytics-funnel-filter-notice-why"
                >{{ t("rum.analytics.funnel.filterNoticeWhy") }}</OButton
              >
            </template>
            <p class="text-text-body text-sm" data-test="rum-analytics-funnel-filter-notice-reason">
              {{
                t("rum.analytics.funnel.filterNoticeReason", {
                  unit: unit,
                  missing: raw(addCommasToNumber(Math.max(0, notice.opened - notice.carry))),
                  opened: raw(addCommasToNumber(notice.opened)),
                  field: raw(notice.field),
                })
              }}
            </p>
          </OPopover>
        </span>
      </template>
    </template>
  </FunnelSectionRow>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import FunnelSectionRow from "@/components/rum/productAnalytics/funnelParts/FunnelSectionRow.vue";
import {
  filterFieldLabel,
  valuesLoader,
  type FilterNotice,
  type FilterValuesState,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import { toFilterFieldType, type FilterField } from "@/utils/query/filterBar";
import { parseFunnelFilter } from "@/utils/rum/productAnalyticsModel";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { FunnelDef, FunnelFilter } from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "FunnelFilterBar" });

const props = defineProps<{
  def: FunnelDef;
  fields: readonly string[];
  fieldTypes?: Readonly<Record<string, string>>;
  values: FilterValuesState;
  stacked?: boolean;
  /** Shown while an attribute filter keeps fewer than half of step 1's sessions. */
  notice?: FilterNotice | null;
  unitNoun?: I18nText;
}>();
const emit = defineEmits<{
  "update:def": [FunnelDef];
  "filter-values": [string];
  "break-down": [string];
}>();
const { t } = useI18nTyped();

const unit = computed(() => props.unitNoun ?? t("rum.analytics.funnel.sessionNoun"));

const builderFields = computed<FilterField[]>(() =>
  props.fields.map((name) => ({
    name,
    label: filterFieldLabel(t, name),
    type: toFilterFieldType(props.fieldTypes?.[name]),
  })),
);

const loadValues = valuesLoader(
  () => props.values,
  (field) => emit("filter-values", field),
);

// A rule the server would refuse is dropped with a toast, so one bad chip never blocks later edits.
const onChange = (next: unknown) => {
  const all = next as FunnelFilter[];
  const rules = all.filter((rule) => parseFunnelFilter(rule));
  if (rules.length < all.length) {
    toast({ variant: "error", message: t("rum.analytics.funnel.filterRejected") });
  }
  const out: FunnelDef = { ...props.def, f: rules };
  if (!rules.length) delete out.f;
  emit("update:def", out);
};
</script>
