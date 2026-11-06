<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { OSectionNavEmits, OSectionNavProps, SectionNavItem } from "./OSectionNav.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import { raw } from "@/types/i18n";

const props = withDefaults(defineProps<OSectionNavProps>(), {
  active: undefined,
});

const emit = defineEmits<OSectionNavEmits>();

const isActive = (item: SectionNavItem): boolean => item.id === props.active;

const list = ref<HTMLOListElement | null>(null);

// As a chip row the list scrolls sideways, so keep the current chip in view.
watch(
  () => props.active,
  async (id) => {
    await nextTick();
    const row = list.value;
    if (!id || !row || row.scrollWidth <= row.clientWidth + 1) return;
    const chip = row.querySelector<HTMLElement>(`[data-test="o-section-nav-item-${id}"]`);
    if (!chip) return;
    const rowBox = row.getBoundingClientRect();
    const chipBox = chip.getBoundingClientRect();
    if (chipBox.left >= rowBox.left && chipBox.right <= rowBox.right) return;
    const left = row.scrollLeft + chipBox.left - rowBox.left - (rowBox.width - chipBox.width) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  },
);

const errorMark = raw("!");

// Only finished sections trade their number for an icon.
const stateIcon = (item: SectionNavItem): IconName | null =>
  item.state === "done" || item.state === "saved" ? "check" : null;

const markerClass = (item: SectionNavItem): string => {
  if (item.state === "error") return "border-status-error-text text-status-error-text";
  if (item.state === "done") return "border-status-positive text-status-positive";
  if (item.state === "changed") return "border-accent text-accent";
  if (item.state === "attention") return "border-status-warning-text text-status-warning-text";
  if (isActive(item)) return "border-accent text-accent";
  return "border-border-strong text-text-secondary";
};

// The label says what is wrong, so a summary beside it would say it twice.
const showsSummary = (item: SectionNavItem): boolean =>
  !!item.summary && !(item.stateLabel && (item.state === "attention" || item.state === "error"));
</script>

<template>
  <nav :aria-label="label" data-test="o-section-nav">
    <ol
      ref="list"
      class="m-0 flex list-none flex-col p-0 max-lg:flex-row max-lg:gap-2 max-lg:overflow-x-auto"
    >
      <li v-for="(item, index) in items" :key="item.id" class="relative min-w-0 max-lg:shrink-0">
        <span
          v-if="index < items.length - 1"
          aria-hidden="true"
          class="bg-border-default absolute start-5.25 top-9.5 bottom-0 w-px max-lg:hidden"
        />
        <button
          type="button"
          :aria-current="isActive(item) ? 'location' : undefined"
          :data-test="`o-section-nav-item-${item.id}`"
          :data-state="item.state ?? 'none'"
          :class="[
            'rounded-default relative flex w-full min-w-0 cursor-pointer items-start gap-3 px-2 py-2.5 text-start transition-colors',
            'hover:bg-surface-subtle-hover focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none',
            'max-lg:items-center max-lg:gap-2 max-lg:rounded-full max-lg:border max-lg:px-3 max-lg:py-1',
            isActive(item)
              ? 'max-lg:border-accent bg-surface-subtle'
              : 'max-lg:border-border-default bg-transparent',
          ]"
          @click="emit('select', item.id)"
        >
          <span
            :class="[
              'bg-surface-base flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold max-lg:size-5',
              markerClass(item),
            ]"
            :data-test="`o-section-nav-state-icon-${item.state ?? 'none'}`"
          >
            <OIcon v-if="stateIcon(item)" :name="stateIcon(item)!" size="xs" />
            <template v-else-if="item.state === 'error'">{{ errorMark }}</template>
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              :class="[
                'text-sm font-medium max-lg:whitespace-nowrap',
                isActive(item) ? 'text-accent' : 'text-text-heading',
              ]"
            >
              {{ item.title }}
            </span>
            <span
              v-if="
                (item.state === 'attention' ||
                  item.state === 'error' ||
                  item.state === 'changed') &&
                item.stateLabel
              "
              :class="[
                'text-xs max-lg:hidden',
                item.state === 'error'
                  ? 'text-status-error-text'
                  : item.state === 'changed'
                    ? 'text-accent'
                    : 'text-status-warning-text',
              ]"
              :data-test="`o-section-nav-state-${item.state}`"
            >
              {{ item.stateLabel }}
            </span>
            <span
              v-if="showsSummary(item) || item.tag"
              class="text-text-secondary flex min-w-0 gap-1.5 text-xs max-lg:hidden"
            >
              <span
                v-if="item.tag"
                class="text-text-label shrink-0 font-medium"
                :data-test="`o-section-nav-tag-${item.id}`"
                >{{ item.tag }}</span
              >
              <OTruncatedText
                v-if="showsSummary(item)"
                class="min-w-0"
                :data-test="`o-section-nav-summary-${item.id}`"
              >
                {{ item.summary }}
              </OTruncatedText>
            </span>
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>
