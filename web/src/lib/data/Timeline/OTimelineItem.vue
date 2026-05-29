<script setup lang="ts">
import { computed } from "vue";
import type { TimelineItemProps, TimelineItemSlots, TimelineItemVariant } from "./OTimelineItem.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";

const props = withDefaults(defineProps<TimelineItemProps>(), {
  variant: "primary",
});

defineSlots<TimelineItemSlots>();

/**
 * Maps each variant to the CSS custom property holding the dot colour.
 * Tailwind JIT cannot generate `bg-[var(...)]` utilities from dynamic
 * strings, so we use tw:inline style instead of a class map.
 */
const dotColorMap: Record<TimelineItemVariant, string> = {
  primary: "var(--color-timeline-dot-primary)",
  success: "var(--color-timeline-dot-success)",
  destructive: "var(--color-timeline-dot-destructive)",
  info: "var(--color-timeline-dot-info)",
  muted: "var(--color-timeline-dot-muted)",
};

const dotStyle = computed(() => ({
  backgroundColor: dotColorMap[props.variant],
  color: "var(--color-timeline-dot-fg)",
}));

/** True when the icon name is registered in the OIcon SVG registry (kebab-case) */
const isOIcon = computed<boolean>(() =>
  Boolean(props.icon && (props.icon as keyof typeof iconRegistry) in iconRegistry),
);
</script>

<template>
  <li class="tw:relative tw:flex tw:gap-4 tw:pb-6 last:tw:pb-0">
    <!-- Left column: dot + vertical connector line -->
    <div class="tw:relative tw:flex tw:flex-col tw:items-center tw:shrink-0">
      <!-- Dot / icon circle -->
      <div
        class="tw:relative tw:z-10 tw:flex tw:size-7 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-full"
        :style="dotStyle"
        aria-hidden="true"
      >
        <OIcon
          v-if="icon && isOIcon"
          :name="(icon as any)"
          size="xs"
        />
        <span
          v-else-if="icon"
          class="material-icons tw:text-[14px] tw:leading-none tw:text-timeline-dot-fg tw:select-none"
        >{{ icon }}</span>
      </div>

      <!--
        Vertical connector line.
        OTimeline's scoped :deep rule hides this element when the
        parent <li> is :last-child.
      -->
      <div
        class="timeline-connector tw:w-px tw:flex-1 tw:bg-timeline-line tw:mt-1"
      />
    </div>

    <!-- Right column: title, subtitle, extra slot content -->
    <div class="tw:flex-1 tw:min-w-0 tw:pt-0.5 tw:pb-1">
      <p
        v-if="title"
        class="tw:m-0 tw:text-sm tw:font-medium tw:leading-snug tw:text-text-primary"
      >
        {{ title }}
      </p>
      <p
        v-if="subtitle"
        class="tw:m-0 tw:mt-0.5 tw:text-xs tw:leading-normal tw:text-text-secondary"
      >
        {{ subtitle }}
      </p>
      <slot />
    </div>
  </li>
</template>
