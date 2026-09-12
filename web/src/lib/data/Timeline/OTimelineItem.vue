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
  <li class="o-timeline-item relative flex gap-4 pb-6 last:pb-0">
    <!-- Left column: dot + vertical connector line -->
    <div class="relative flex shrink-0 flex-col items-center">
      <!-- Node: a pill when it carries a label, otherwise the dot. Both are
           `h-7` so a rail mixing the two keeps its rhythm. -->
      <div
        class="relative z-10 flex h-7 shrink-0 items-center justify-center rounded-full"
        :class="label ? 'text-2xs px-2.5 font-medium' : 'size-7'"
        :style="dotStyle"
        :aria-hidden="label ? undefined : true"
      >
        <span v-if="label" class="whitespace-nowrap">{{ label }}</span>
        <OIcon v-else-if="icon && isOIcon" :name="icon as any" size="xs" />
        <span
          v-else-if="icon"
          class="material-icons text-timeline-dot-fg text-sm leading-none select-none"
          >{{ icon }}</span
        >
      </div>

      <!--
        Vertical connector line, hidden on the rail's last item the way OStep
        does it — from the item itself, so it does not depend on the parent's
        scoped styles reaching slot content. They do not: slotted markup carries
        the CONSUMER's scope id, so the rule that used to live on OTimeline
        matched nothing and the last rung's line overhung the card.

        That `-mb-6` cancels the li's `pb-6`: this column is a flex child, so it
        stretches only to the CONTENT box, and the line would otherwise stop
        short of the next node and break the rail into stubs.
      -->
      <div
        class="timeline-connector bg-timeline-line mt-1 -mb-6 w-px flex-1 [.o-timeline-item:last-child_&]:hidden"
      />
    </div>

    <!-- Right column: title, subtitle, extra slot content -->
    <div
      class="min-w-0 flex-1"
      :class="
        framed
          ? 'card-container rounded-default bg-surface-base border-border-default border px-3 py-2'
          : 'pt-0.5 pb-1'
      "
    >
      <p v-if="title" class="text-text-heading m-0 text-sm leading-snug font-medium">
        {{ title }}
      </p>
      <p
        v-if="subtitle || $slots.subtitle"
        class="text-text-secondary m-0 mt-0.5 text-xs leading-normal"
      >
        <slot name="subtitle">{{ subtitle }}</slot>
      </p>
      <slot />
    </div>
  </li>
</template>
