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
  <section class="flex flex-col gap-1" data-test="rum-analytics-funnel-filter-all">
    <div class="flex flex-wrap items-center gap-2" :class="stacked ? '' : 'px-2'">
      <span class="flex min-w-0 flex-1 flex-col">
        <span class="text-text-heading text-sm font-semibold">{{
          t("rum.analytics.funnel.filterAllTitle")
        }}</span>
        <span class="text-text-secondary text-xs">{{
          t("rum.analytics.funnel.filterAllCaption")
        }}</span>
      </span>
      <OPopover
        :open="open"
        side="bottom"
        align="end"
        content-class="p-3 w-80 max-w-[calc(100vw-1.5rem)]"
        @update:open="setOpen"
      >
        <template #trigger>
          <span>
            <OButton
              variant="outline"
              size="sm"
              icon-left="add"
              :disabled="!!blocked"
              data-test="rum-analytics-funnel-add-filter-btn"
              @click="editing = null"
              >{{ t("rum.analytics.funnel.addFilter") }}</OButton
            >
            <OTooltip v-if="blocked" :content="blocked" />
          </span>
        </template>
        <SessionFieldPicker
          v-if="open"
          :key="editing ?? '+'"
          :fields="pickable"
          :values="values"
          :initial-field="editing ?? undefined"
          :initial-values="editing ? (filterOn(def, editing)?.values ?? []) : []"
          :lock-field="!!editing"
          @load="(f) => emit('filter-values', f)"
          @apply="apply"
          @cancel="open = false"
        />
      </OPopover>
    </div>
    <div
      v-if="def.f?.length"
      class="flex flex-wrap items-center gap-1.5"
      :class="stacked ? '' : 'px-2'"
    >
      <OTag
        v-for="r in def.f"
        :key="r.field"
        :label="chipLabel(r)"
        variant="default-outline"
        size="sm"
        clickable
        removable
        :remove-label="t('rum.analytics.funnel.removeFilter')"
        :data-test="`rum-analytics-funnel-filter-${r.field}`"
        @click="edit(r.field)"
        @remove="emit('update:def', removeFilter(def, r.field))"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import SessionFieldPicker from "@/components/rum/productAnalytics/funnelParts/SessionFieldPicker.vue";
import {
  filterOn,
  removeFilter,
  setFilter,
  type FilterValuesState,
} from "@/components/rum/productAnalytics/funnelParts/funnelFilters";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { MAX_FUNNEL_FILTERS, type SessionField } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef, FunnelFilter } from "@/utils/rum/productAnalyticsQueries";

defineOptions({ name: "FunnelFilterBar" });

const props = defineProps<{
  def: FunnelDef;
  fields: readonly SessionField[];
  values: FilterValuesState;
  stacked?: boolean;
}>();
const emit = defineEmits<{
  "update:def": [FunnelDef];
  "filter-values": [SessionField];
}>();
const { t } = useI18nTyped();

const open = ref(false);
const editing = ref<SessionField | null>(null);

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
  t("rum.analytics.funnel.filterChip", {
    field: t(`rum.analytics.exclusions.fields.${r.field}`),
    values: raw(r.values.join(", ")),
  });

const setOpen = (v: boolean) => {
  open.value = v;
  if (!v) editing.value = null;
};

const edit = (field: SessionField) => {
  editing.value = field;
  open.value = true;
};

// A refused edit keeps the picker open with its ticks, so the user can drop the value that broke it.
const apply = (field: SessionField, values: string[]) => {
  const next = setFilter(props.def, field, values);
  if (!next) {
    toast({ variant: "error", message: t("rum.analytics.funnel.filterRejected") });
    return;
  }
  emit("update:def", next);
  setOpen(false);
};
</script>
