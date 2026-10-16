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
    class="bg-surface-panel rounded-default border-border-default relative border p-2"
    data-test="profiles-sandwich-view"
  >
    <div class="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <span class="text-text-secondary whitespace-nowrap">
        {{ formatValue(windowTotal) }} | {{ t("profiles.sandwichSamplesHint") }}
      </span>
      <OTag type="fieldTag" value="primarysm" class="max-w-md min-w-0">
        <OTruncatedText>{{ pivot?.name ?? "" }}</OTruncatedText>
      </OTag>
      <OButton
        size="xs"
        variant="ghost"
        icon-left="close"
        :aria-label="t('profiles.exitSandwich')"
        data-test="profiles-sandwich-close"
        @click="emit('close')"
      />
      <OButton class="ms-auto" size="sm" variant="ghost" @click="emit('close')">
        {{ t("profiles.viewFlame") }}
      </OButton>
    </div>

    <div class="bg-theme-body-bg-secondary rounded-default border-border-default border p-2">
      <div class="flex gap-2">
        <div
          class="text-text-secondary text-2xs flex w-8 shrink-0 items-center justify-center"
          :style="{ minHeight: `${callerSectionHeight}rem` }"
        >
          <span class="rotate-180 [writing-mode:vertical-rl]">{{
            t("profiles.sandwichCallers")
          }}</span>
        </div>
        <div class="min-w-0 flex-1">
          <div
            v-for="bar in callerBars"
            :key="bar.id"
            class="bg-accent/80 text-text-body rounded-default mb-0.5 flex h-6 min-w-0 items-center px-2 text-xs"
            :style="{ width: `${barWidth(bar)}%` }"
          >
            <OTruncatedText class="min-w-0 font-mono">{{ barLabel(bar) }}</OTruncatedText>
          </div>
        </div>
      </div>

      <div class="border-border-default my-2 border-t" />

      <div class="flex gap-2">
        <div
          class="text-text-secondary text-2xs flex w-8 shrink-0 items-center justify-center"
          :style="{ minHeight: `${calleeSectionHeight}rem` }"
        >
          <span class="rotate-180 [writing-mode:vertical-rl]">{{
            t("profiles.sandwichCallees")
          }}</span>
        </div>
        <div class="relative min-w-0 flex-1" :style="{ minHeight: `${calleeSectionHeight}rem` }">
          <button
            v-for="bar in calleeBars"
            :key="bar.id"
            type="button"
            class="bg-series-b/80 text-text-body rounded-default absolute flex h-6 min-w-0 items-center overflow-hidden px-1 text-left text-xs"
            :style="barStyle(bar)"
            @click="emit('selectPath', bar.id.endsWith('-pivot') ? path : bar.id)"
          >
            <OTruncatedText class="min-w-0 font-mono">{{ barLabel(bar) }}</OTruncatedText>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import type { ProfilesTreeNode } from "@/services/profiles";
import { useI18nTyped } from "@/types/i18n";
import {
  buildCalleeBars,
  buildCallerBars,
  findNodeByPath,
  type SandwichBarRow,
} from "./profilesSandwich";

const props = defineProps<{
  root: ProfilesTreeNode | null;
  path: string;
  formatValue: (value: number) => string;
}>();

const emit = defineEmits<{ close: []; selectPath: [path: string] }>();

const { t } = useI18nTyped();

const pivot = computed(() => findNodeByPath(props.root, props.path));

const windowTotal = computed(() => props.root?.total ?? 0);

const callerBars = computed(() => {
  if (!props.root || !pivot.value) return [];
  return buildCallerBars(props.root, props.path, windowTotal.value);
});

const calleeBars = computed(() => {
  if (!pivot.value) return [];
  return buildCalleeBars(pivot.value, props.path, windowTotal.value);
});

const rowRem = 1.625;

const callerSectionHeight = computed(() => Math.max(1, callerBars.value.length) * rowRem);

const calleeDepth = computed(() =>
  calleeBars.value.reduce((max, bar) => Math.max(max, bar.depth), 0),
);

const calleeSectionHeight = computed(() => Math.max(1, calleeDepth.value + 1) * rowRem);

const barLabel = (bar: SandwichBarRow) => {
  const name = bar.isTotal ? t("profiles.total") : bar.name;
  return `${name} (${props.formatValue(bar.total)})`;
};

const barWidth = (bar: SandwichBarRow) => (bar.width > 0 ? Math.max(bar.width, 0.5) : 0);

const barStyle = (bar: SandwichBarRow) => ({
  left: `${bar.x}%`,
  width: `${barWidth(bar)}%`,
  top: `${bar.depth * rowRem}rem`,
});
</script>
