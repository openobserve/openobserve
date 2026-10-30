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

<script setup lang="ts">
import { computed, useId } from "vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { isCompositionAction } from "@/constants/synthetics";
import { useI18nTyped } from "@/types/i18n";
import type { BrowserStep } from "@/types/synthetics";
import { expandJourney, type ChildJourney } from "@/utils/synthetics/expandJourney";

const props = defineProps<{
  steps: BrowserStep[];
  children: Map<string, ChildJourney>;
  limit: number;
}>();

const { t, locale } = useI18nTyped();
const descriptionId = useId();

const references = computed(() => props.steps.filter((s) => isCompositionAction(s.action)));

/** Steps the journey runs, or undefined while a referenced subtest's steps are unknown. */
const executed = computed<number | undefined>(() => {
  if (references.value.length === 0) return props.steps.length;
  try {
    return expandJourney(props.steps, props.children).steps.length;
  } catch {
    return undefined;
  }
});

const withSubtests = computed(() => references.value.length > 0 && executed.value !== undefined);

const caption = computed(() => {
  if (withSubtests.value) {
    const count = references.value.length;
    return t(
      "synthetics.journey.stepCount.captionWithSubtests",
      { steps: executed.value, count },
      count,
    );
  }
  const count = props.steps.length;
  return t("synthetics.journey.stepCount.caption", { count }, count);
});

const overLimit = computed(() => executed.value !== undefined && executed.value > props.limit);

const tooltip = computed(() => {
  if (!withSubtests.value) return undefined;
  const own = props.steps.length - references.value.length;
  const parts = [
    t("synthetics.journey.stepCount.tooltipOwn", { count: own }, own),
    ...references.value.map((row) => {
      const child = props.children.get(row.subtest?.id ?? "");
      return t("synthetics.journey.stepCount.tooltipSubtest", {
        count: child?.steps.length ?? 0,
        name: child?.name ?? "",
      });
    }),
  ];
  const breakdown = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(parts);
  return t("synthetics.journey.stepCount.tooltip", {
    breakdown,
    count: executed.value,
    limit: props.limit,
  });
});
</script>

<template>
  <span
    v-if="steps.length > 0"
    class="text-xs"
    :class="overLimit ? 'text-status-error-text font-semibold' : 'text-text-secondary'"
    :aria-describedby="tooltip ? descriptionId : undefined"
  >
    {{ caption }}
    <OTooltip v-if="tooltip" :content="tooltip" />
    <!-- Teleported so the caption's own text stays the count; OTooltip child mode opens on hover only. -->
    <Teleport v-if="tooltip" to="body">
      <span :id="descriptionId" class="sr-only">{{ tooltip }}</span>
    </Teleport>
  </span>
</template>
