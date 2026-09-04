<script setup lang="ts">
import { computed } from "vue";
import type {
  TimelineItemProps,
  TimelineItemSlots,
  TimelineItemVariant,
} from "./OTimelineItem.types";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { iconRegistry } from "@/lib/core/Icon/OIcon.icons";

const props = withDefaults(defineProps<TimelineItemProps>(), {
  variant: "primary",
});

defineSlots<TimelineItemSlots>();

/**
 * Maps each variant to the CSS custom property holding the dot colour.
 * Tailwind JIT cannot generate `bg-[var(...)]` utilities from dynamic
 * strings, so we use inline style instead of a class map.
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
  <li class="relative flex gap-4 pb-6 last:pb-0">
    <!-- Left column: dot + vertical connector line -->
    <div class="relative flex shrink-0 flex-col items-center">
      <!-- Dot / icon circle -->
      <div
        class="relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full"
        :style="dotStyle"
        aria-hidden="true"
      >
        <OIcon v-if="icon && isOIcon" :name="icon as any" size="xs" />
        <span
          v-else-if="icon"
          class="material-icons text-timeline-dot-fg text-sm leading-none select-none"
          >{{ icon }}</span
        >
      </div>

      <!--
        Vertical connector line.
        OTimeline's scoped :deep rule hides this element when the
        parent <li> is :last-child.
      -->
      <div class="timeline-connector bg-timeline-line mt-1 w-px flex-1" />
    </div>

    <!-- Right column: title, subtitle, extra slot content -->
    <div class="min-w-0 flex-1 pt-0.5 pb-1">
      <p v-if="title" class="text-text-heading m-0 text-sm leading-snug font-medium">
        {{ title }}
      </p>
      <p v-if="subtitle" class="text-text-secondary m-0 mt-0.5 text-xs leading-normal">
        {{ subtitle }}
      </p>
      <slot />
    </div>
  </li>
</template>
