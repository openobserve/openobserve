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
  <OPopover
    :open="open"
    side="bottom"
    align="start"
    content-class="p-3 w-96 max-w-[calc(100vw-1.5rem)]"
    @update:open="setOpen"
  >
    <template #trigger>
      <OButton variant="ghost-primary" size="xs" data-test="rum-analytics-funnel-why-btn">{{
        t("rum.analytics.funnel.whyLink", { count: addCommasToNumber(count) })
      }}</OButton>
    </template>
    <div class="flex flex-col gap-2" data-test="rum-analytics-funnel-why">
      <span class="text-text-heading text-sm font-semibold">{{
        t("rum.analytics.funnel.whyTitle", { count: addCommasToNumber(count) }, count)
      }}</span>
      <span
        v-if="state === 'loading' || state === 'idle' || (state === 'ok' && !lines)"
        class="text-text-secondary text-xs"
        data-test="rum-analytics-funnel-why-loading"
        >{{ t("rum.analytics.funnel.whyLoading") }}</span
      >
      <span
        v-else-if="state === 'error' || !lines"
        class="text-text-secondary flex items-center gap-1.5 text-xs"
        data-test="rum-analytics-funnel-why-error"
        >{{ t("rum.analytics.funnel.whyFailed") }}
        <OButton
          variant="ghost-primary"
          size="xs"
          data-test="rum-analytics-funnel-why-retry"
          @click="emit('retry')"
          >{{ t("common.retry") }}</OButton
        ></span
      >
      <template v-else>
        <div class="flex flex-col">
          <span
            v-for="line in lines.lines"
            :key="line.id"
            class="flex items-baseline justify-between gap-3 py-0.5 text-xs"
            :class="
              line.id === 'entered'
                ? 'border-border-default text-text-heading border-t font-semibold'
                : line.id === 'excluded'
                  ? 'text-text-secondary'
                  : 'text-text-body'
            "
            :data-test="`rum-analytics-funnel-why-${line.id}`"
          >
            <span>{{ labelOf(line.id) }}</span>
            <span class="tabular-nums">{{ countOf(line) }}</span>
          </span>
        </div>
        <span
          v-if="estimated || !lines.exact"
          class="text-text-secondary text-xs"
          data-test="rum-analytics-funnel-why-estimated"
          >{{ t("rum.analytics.funnel.whyEstimated") }}</span
        >
      </template>
      <span class="text-text-secondary text-xs">{{ t("rum.analytics.funnel.whyCaption") }}</span>
    </div>
  </OPopover>
</template>

<script setup lang="ts">
import { ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type {
  WhyLine,
  WhyLineId,
  WhyLines,
} from "@/components/rum/productAnalytics/funnelParts/whyEntered";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { addCommasToNumber } from "@/utils/formatters";

defineOptions({ name: "WhyEnteredPopover" });

const props = defineProps<{
  count: number;
  app: string;
  step1: string;
  state: "idle" | "loading" | "ok" | "error";
  lines: WhyLines | null;
  estimated: boolean;
}>();
const emit = defineEmits<{ open: [boolean]; retry: [] }>();
const { t } = useI18nTyped();

const open = ref(false);

const setOpen = (v: boolean) => {
  open.value = v;
  emit("open", v);
};

const labelOf = (id: WhyLineId): I18nText => {
  if (id === "app") return t("rum.analytics.funnel.whyApp", { app: raw(props.app) });
  if (id === "synthetic") return t("rum.analytics.funnel.whySynthetic");
  if (id === "bots") return t("rum.analytics.funnel.whyBots");
  if (id === "appFilters") return t("rum.analytics.funnel.whyAppFilters");
  if (id === "step1") return t("rum.analytics.funnel.whyStep1", { step: raw(props.step1) });
  if (id === "filters") return t("rum.analytics.funnel.whyFilters");
  if (id === "conditions") return t("rum.analytics.funnel.whyConditions");
  if (id === "excludedStep1") return t("rum.analytics.funnel.whyExcludedStep1");
  if (id === "entered") return t("rum.analytics.funnel.whyEntered");
  return t("rum.analytics.funnel.whyExcluded");
};

// Removal lines read as subtractions; the totals and the later exclusion count read as plain counts.
const countOf = (line: WhyLine): string => {
  const n = addCommasToNumber(Math.abs(line.count));
  const plain = line.id === "app" || line.id === "entered" || line.id === "excluded";
  return plain ? n : `−${n}`;
};
</script>
