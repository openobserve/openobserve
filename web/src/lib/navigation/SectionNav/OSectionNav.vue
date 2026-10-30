<!-- Copyright 2026 OpenObserve Inc. -->

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { OSectionNavEmits, OSectionNavProps, SectionNavItem } from "./OSectionNav.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.types";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";

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

const stateIcon = (item: SectionNavItem): IconName => {
  if (item.state === "done" || item.state === "saved") return "check-circle";
  if (item.state === "error") return "error-outline";
  if (item.state === "changed") return "radio-button-checked";
  return "radio-button-unchecked";
};

const stateIconClass = (item: SectionNavItem): string => {
  if (item.state === "done") return "text-status-positive";
  if (item.state === "error") return "text-status-error-text";
  if (item.state === "changed") return "text-accent";
  return "text-text-secondary";
};
</script>

<template>
  <nav :aria-label="label" data-test="o-section-nav">
    <ol
      ref="list"
      class="m-0 flex list-none flex-col gap-0.5 p-0 max-lg:flex-row max-lg:gap-2 max-lg:overflow-x-auto"
    >
      <li v-for="item in items" :key="item.id" class="min-w-0 max-lg:shrink-0">
        <button
          type="button"
          :aria-current="isActive(item) ? 'location' : undefined"
          :data-test="`o-section-nav-item-${item.id}`"
          :data-state="item.state ?? 'none'"
          :class="[
            'rounded-default flex w-full min-w-0 cursor-pointer items-start gap-2 border-s-2 px-3 py-2 text-start transition-colors',
            'hover:bg-surface-subtle-hover focus-visible:ring-accent/40 focus-visible:ring-2 focus-visible:outline-none',
            'max-lg:items-center max-lg:rounded-full max-lg:border max-lg:px-3 max-lg:py-1',
            isActive(item)
              ? 'border-accent bg-surface-subtle'
              : 'max-lg:border-border-default border-transparent bg-transparent',
          ]"
          @click="emit('select', item.id)"
        >
          <OIcon
            :name="stateIcon(item)"
            size="sm"
            :class="['mt-0.5 shrink-0 max-lg:mt-0', stateIconClass(item)]"
            :data-test="`o-section-nav-state-icon-${item.state ?? 'none'}`"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              :class="[
                'text-sm max-lg:whitespace-nowrap',
                isActive(item) ? 'text-accent font-medium' : 'text-text-heading font-medium',
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
            <OTruncatedText
              v-if="item.summary"
              class="text-text-secondary text-xs max-lg:hidden"
              :data-test="`o-section-nav-summary-${item.id}`"
            >
              {{ item.summary }}
            </OTruncatedText>
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>
