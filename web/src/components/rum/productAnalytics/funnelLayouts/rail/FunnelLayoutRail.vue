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
    ref="frame"
    class="flex flex-col lg:-my-3 lg:min-h-0 lg:flex-1"
    data-test="rum-analytics-funnel-layout-rail"
  >
    <OSplitter
      :model-value="railWidth"
      unit="px"
      :limits="limits"
      class="max-lg:flex-col max-lg:gap-4 lg:min-h-0 lg:flex-1"
      :before-class="
        collapsed
          ? 'max-lg:h-auto max-lg:w-full! max-lg:overflow-visible lg:hidden'
          : 'max-lg:h-auto max-lg:w-full! max-lg:overflow-visible'
      "
      :separator-class="collapsed ? 'hidden' : 'max-lg:hidden'"
      after-class="max-lg:h-auto max-lg:overflow-visible"
      data-test="rum-analytics-funnel-rail-splitter"
      @update:model-value="setRailWidth"
    >
      <template #before>
        <aside
          class="flex h-full min-w-0 flex-col gap-4 lg:overflow-y-auto lg:py-3"
          data-test="rum-analytics-funnel-rail-sections"
        >
          <FunnelFilterBar
            :def="def"
            :fields="filterFields"
            :field-types="filterFieldTypes"
            :values="filterValues"
            stacked
            @update:def="(d) => emit('update:def', d)"
            @filter-values="(f) => emit('filter-values', f)"
          />
          <ExclusionSection
            :def="def"
            :removed="removed"
            :sampled="sampled"
            :events="events"
            :events-status="eventsStatus"
            :deleted-names="deletedNames"
            stacked
            @update:def="(d) => emit('update:def', d)"
          />
          <div data-test="rum-analytics-funnel-rail-app-filters">
            <AppFiltersSummary
              :counts="appFilters"
              :included="includeHidden"
              :app="app"
              always
              stacked
              @include="emit('include-hidden')"
              @hide="emit('hide-hidden')"
              @edit="emit('edit-app-filters')"
            />
          </div>
          <FunnelSectionRow
            :title="t('rum.analytics.funnel.railSettings')"
            stacked
            boxed
            test-id="rum-analytics-funnel-rail-settings"
          >
            <template v-for="(s, i) in settings" :key="s.id">
              <span v-if="i > 0" class="text-text-secondary" aria-hidden="true">{{
                separator
              }}</span>
              <span
                class="text-text-secondary"
                :title="s.label"
                :data-test="`rum-analytics-funnel-rail-setting-${s.id}`"
                >{{ s.value }}</span
              >
            </template>
          </FunnelSectionRow>
        </aside>
      </template>
      <template #separator>
        <div class="group flex h-full w-8 cursor-col-resize justify-center">
          <div
            class="bg-border-default group-hover:bg-splitter-hover h-full w-px transition-colors duration-300 group-hover:w-0.5"
          />
        </div>
      </template>
      <template #after>
        <div class="h-full min-w-0 lg:overflow-y-auto lg:py-3">
          <OCard
            variant="outlined"
            class="rounded-surface flex min-w-0 flex-col"
            data-test="rum-analytics-funnel-card"
          >
            <div
              class="border-border-default flex flex-col gap-2 border-b px-4 py-2.5"
              data-test="rum-analytics-funnel-toolbar"
            >
              <div class="flex items-center gap-2">
                <OButton
                  variant="outline"
                  size="icon-xs-sq"
                  class="max-lg:hidden"
                  :aria-label="collapseLabel"
                  :aria-expanded="!collapsed"
                  data-test="rum-analytics-funnel-rail-collapse-btn"
                  @click="toggleCollapsed"
                >
                  <OIcon
                    :name="collapsed ? 'keyboard-double-arrow-right' : 'keyboard-double-arrow-left'"
                    size="sm"
                  />
                  <OTooltip :content="collapseLabel" />
                </OButton>
                <slot name="header" />
                <OPopover
                  v-model:open="adding"
                  align="end"
                  content-class="p-3 w-96 max-w-[calc(100vw-1.5rem)]"
                  :aria-label="t('rum.analytics.funnel.addStep')"
                >
                  <template #trigger>
                    <OButton
                      variant="outline"
                      size="sm"
                      icon-left="add"
                      class="shrink-0"
                      data-test="rum-analytics-funnel-add-step-btn"
                      >{{ t("rum.analytics.funnel.addStep") }}</OButton
                    >
                  </template>
                  <div v-if="adding" data-test="rum-analytics-funnel-add-step">
                    <FunnelAddStep
                      :def="def"
                      :suggestions="suggestions"
                      :suggestions-state="suggestionsState"
                      :sampled="sampled"
                      :events="events"
                      @update:def="(d) => emit('update:def', d)"
                      @suggestions-retry="emit('suggestions-retry')"
                    />
                  </div>
                </OPopover>
              </div>
              <div
                class="flex flex-wrap items-center gap-3"
                data-test="rum-analytics-funnel-toolbar-controls"
              >
                <slot name="actions" />
              </div>
            </div>
            <div class="flex flex-col gap-2">
              <slot name="notices" />
              <div v-if="!failed" class="flex min-w-0 flex-col" data-test="rum-analytics-funnel">
                <FunnelStepsTable
                  :def="def"
                  :result="result"
                  :removed-at="removedAt"
                  :state="state"
                  :sampled="sampled"
                  :events="events"
                  :events-status="eventsStatus"
                  :deleted-names="deletedNames"
                  :unit-label="unitLabel"
                  :unit-noun="unitNoun"
                  :hide-time="hideTime"
                  @update:def="(d) => emit('update:def', d)"
                  @dropoff="(k) => emit('dropoff', k)"
                />
              </div>
              <slot name="footer" />
            </div>
          </OCard>
        </div>
      </template>
    </OSplitter>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import FunnelStepsTable from "@/components/rum/productAnalytics/funnelParts/FunnelStepsTable.vue";
import FunnelAddStep from "@/components/rum/productAnalytics/funnelParts/FunnelAddStep.vue";
import ExclusionSection from "@/components/rum/productAnalytics/funnelParts/ExclusionSection.vue";
import FunnelFilterBar from "@/components/rum/productAnalytics/funnelParts/FunnelFilterBar.vue";
import FunnelSectionRow from "@/components/rum/productAnalytics/funnelParts/FunnelSectionRow.vue";
import AppFiltersSummary from "@/components/rum/productAnalytics/funnelParts/AppFiltersSummary.vue";
import { removedByStep } from "@/components/rum/productAnalytics/funnelParts/funnelEdits";
import type {
  FunnelLayoutEmits,
  FunnelLayoutProps,
  FunnelLayoutSlots,
} from "@/components/rum/productAnalytics/funnelLayouts/types";
import { raw, useI18nTyped } from "@/types/i18n";

defineOptions({ name: "FunnelLayoutRail" });

const props = defineProps<FunnelLayoutProps>();
const emit = defineEmits<FunnelLayoutEmits>();
defineSlots<FunnelLayoutSlots>();
const { t } = useI18nTyped();
const separator = raw("·");
const COLLAPSED_KEY = "o2.rum.analytics.funnelRailCollapsed";
const WIDTH_KEY = "o2.rum.analytics.funnelRailWidth";
// Widths in rem, measured: below 17 the rail's switch label wraps; past 30 no chip gains anything.
const RAIL_MIN_REM = 17;
const RAIL_DEFAULT_REM = 22;
const RAIL_MAX_REM = 30;
// The table's fixed columns plus a Step column that keeps a typical step name on one or two lines.
const TABLE_MIN_REM = 55;
const TABLE_MIN_NO_TIME_REM = 46;
const SEPARATOR_REM = 2;

const adding = ref(false);
const collapsed = ref(false);
try {
  collapsed.value = localStorage.getItem(COLLAPSED_KEY) === "1";
} catch {
  // localStorage can be unavailable (private mode); default expanded.
}

const collapseLabel = computed(() =>
  collapsed.value ? t("rum.analytics.funnel.expandRail") : t("rum.analytics.funnel.collapseRail"),
);

const toggleCollapsed = () => {
  collapsed.value = !collapsed.value;
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed.value ? "1" : "0");
  } catch {
    // Non-fatal; the state just does not persist.
  }
};

const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const frame = ref<HTMLElement | null>(null);
const frameWidth = ref(0);
const storedWidth = ref<number | null>(null);
try {
  const v = Number(localStorage.getItem(WIDTH_KEY));
  storedWidth.value = Number.isFinite(v) && v > 0 ? v : null;
} catch {
  // localStorage can be unavailable (private mode); use the default width.
}

// The table keeps its floor, so on a narrow screen the rail's upper limit falls to its minimum.
const limits = computed<[number, number]>(() => {
  const r = rem();
  const min = RAIL_MIN_REM * r;
  const table = (props.hideTime ? TABLE_MIN_NO_TIME_REM : TABLE_MIN_REM) * r;
  const room = frameWidth.value ? frameWidth.value - SEPARATOR_REM * r - table : RAIL_MAX_REM * r;
  return [min, Math.max(min, Math.min(RAIL_MAX_REM * r, room))];
});

const railWidth = computed(() => {
  const [min, max] = limits.value;
  const want = storedWidth.value ?? RAIL_DEFAULT_REM * rem();
  return Math.min(max, Math.max(min, want));
});

const setRailWidth = (w: number) => {
  storedWidth.value = w;
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(w)));
  } catch {
    // Non-fatal; the width just does not persist.
  }
};

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (!frame.value || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(([entry]) => {
    frameWidth.value = entry.contentRect.width;
  });
  observer.observe(frame.value);
});
onBeforeUnmount(() => observer?.disconnect());

const removedAt = computed(() => removedByStep(props.def, props.removed));

watch(
  () => props.def.steps.length,
  (n, was) => {
    if (n > was) adding.value = false;
  },
);
</script>
