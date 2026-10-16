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
    :boxed="!!def.f?.length"
    test-id="rum-analytics-funnel-filter-all"
  >
    <span
      v-for="(r, i) in def.f ?? []"
      :key="r.field"
      class="flex min-w-0 items-center gap-1.5"
      :class="stacked ? 'basis-full' : ''"
    >
      <span class="text-text-secondary shrink-0 text-xs">{{
        i === 0 ? t("rum.analytics.funnel.filterWhere") : t("rum.analytics.funnel.filterAnd")
      }}</span>
      <OTag
        :label="chipLabel(r)"
        variant="primary-outline"
        size="sm"
        clickable
        removable
        class="max-w-full min-w-0"
        :remove-label="t('rum.analytics.funnel.removeFilter')"
        :data-test="`rum-analytics-funnel-filter-${r.field}`"
        @click="edit(r.field)"
        @remove="emit('update:def', removeFilter(def, r.field))"
      >
        <span class="min-w-0 truncate">{{ chipLabel(r) }}</span>
        <OTooltip :content="chipLabel(r)" />
      </OTag>
    </span>
    <template v-if="notice" #body>
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
              t("rum.analytics.funnel.filterNoticeAction", { field: raw(notice.field) })
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
    <template #action>
      <OPopover
        :open="open"
        :side="stacked ? 'right' : 'bottom'"
        align="start"
        content-class="p-3 w-96 max-w-[calc(100vw-1.5rem)]"
        @update:open="setOpen"
      >
        <template #trigger>
          <span>
            <OButton
              v-if="stacked"
              variant="ghost"
              size="icon-sm"
              icon-left="add"
              :active="open"
              :disabled="!!blocked"
              :aria-label="t('rum.analytics.funnel.addFilter')"
              data-test="rum-analytics-funnel-add-filter-btn"
              @click="editing = null"
              ><OTooltip :content="blocked ?? t('rum.analytics.funnel.addFilter')"
            /></OButton>
            <template v-else>
              <OButton
                variant="ghost-primary"
                size="sm"
                icon-left="add"
                :active="open"
                :disabled="!!blocked"
                data-test="rum-analytics-funnel-add-filter-btn"
                @click="editing = null"
                >{{ t("rum.analytics.funnel.addFilter") }}</OButton
              >
              <OTooltip v-if="blocked" :content="blocked" />
            </template>
          </span>
        </template>
        <SessionFieldPicker
          v-if="open"
          :key="editing ?? '+'"
          :fields="pickable"
          :field-types="fieldTypes"
          :values="values"
          :initial="editing ? filterOn(def, editing) : undefined"
          :lock-field="!!editing"
          @load="(f) => emit('filter-values', f)"
          @apply="apply"
          @cancel="open = false"
        />
      </OPopover>
    </template>
  </FunnelSectionRow>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import FunnelSectionRow from "@/components/rum/productAnalytics/funnelParts/FunnelSectionRow.vue";
import SessionFieldPicker from "@/components/rum/productAnalytics/funnelParts/SessionFieldPicker.vue";
import {
  conditionOf,
  filterFieldLabel,
  filterOn,
  removeFilter,
  setFilter,
  type FilterNotice,
  type FilterValuesState,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";
import { MAX_FUNNEL_FILTERS } from "@/utils/rum/productAnalyticsModel";
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

const open = ref(false);
const unit = computed(() => props.unitNoun ?? t("rum.analytics.funnel.sessionNoun"));
const editing = ref<string | null>(null);

// One filter per field, so a field already filtered is edited from its chip, not picked again.
const pickable = computed(() =>
  props.fields.filter((f) => editing.value === f || !filterOn(props.def, f)),
);

const blocked = computed<I18nText | null>(() => {
  if ((props.def.f?.length ?? 0) >= MAX_FUNNEL_FILTERS)
    return t("rum.analytics.funnel.maxFilters", { max: MAX_FUNNEL_FILTERS });
  return null;
});

const chipLabel = (r: FunnelFilter): I18nText =>
  t("rum.analytics.funnel.filterChipCondition", {
    field: filterFieldLabel(t, r.field),
    condition: t(`rum.analytics.funnel.conditions.${conditionOf(r).id}`),
    values: raw(r.values.join(", ")),
  });

const setOpen = (v: boolean) => {
  open.value = v;
  if (!v) editing.value = null;
};

const edit = (field: string) => {
  editing.value = field;
  open.value = true;
};

// A refused edit keeps the picker open with its ticks, so the user can drop the value that broke it.
const apply = (rule: FunnelFilter) => {
  const next = setFilter(props.def, rule);
  if (!next) {
    toast({ variant: "error", message: t("rum.analytics.funnel.filterRejected") });
    return;
  }
  emit("update:def", next);
  setOpen(false);
};
</script>
