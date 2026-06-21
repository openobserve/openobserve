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

<!--
  OEmptyState — the single, app-wide empty-state primitive.

  Three SIZES for the three contexts an empty state lives in:
    • hero   full page / section (dashboards list, alerts page) — big
             illustration, rich copy, fills its container, dot-grid backdrop
    • block  inside a card or panel — medium illustration, tighter copy
    • inline  inside a table body / dropdown — tiny: just icon + one line

  Driven by a PRESET (the common path) or by props/slots (the escape hatch):
    <OEmptyState preset="no-search-results" @action="clearFilters" />
    <OEmptyState size="block" title="…" description="…" />
    <OEmptyState> <template #illustration>…</template> … </OEmptyState>

  Motion: animated illustrations honour prefers-reduced-motion automatically —
  the `animated` flag is computed here and passed down to the illustration.
-->
<template>
  <div
    :class="[
      'o2-empty-state',
      sizeClass.root,
      { 'o2-empty-state--hero': size === 'hero' },
    ]"
    data-test="o2-empty-state"
  >
    <!-- decorative dot-grid backdrop (hero/block only) -->
    <div
      v-if="showBackdrop"
      aria-hidden="true"
      class="tw:absolute tw:inset-0 tw:pointer-events-none"
      :style="dotGridStyle"
    />

    <div :class="['tw:relative tw:flex tw:flex-col tw:items-center tw:text-center', sizeClass.stack]">
      <!-- illustration (hero/block) — preset/illustration prop or slot -->
      <div v-if="hasIllustration" class="tw:shrink-0">
        <slot name="illustration">
          <component
            :is="illustrationComponent"
            v-if="illustrationComponent"
            :width="sizeClass.illustrationWidth"
            :animated="animated"
          />
        </slot>
      </div>

      <!-- inline size shows a compact icon instead of a full illustration -->
      <span
        v-else-if="inlineIcon"
        :class="['tw:inline-flex tw:items-center tw:justify-center tw:rounded-full', sizeClass.iconWrap]"
      >
        <OIcon :name="inlineIcon" :size="size === 'inline' ? 'lg' : 'xl'" />
      </span>

      <div :class="['tw:flex tw:flex-col tw:max-w-xl', sizeClass.copy]">
        <component
          :is="size === 'inline' ? 'p' : 'h2'"
          :class="['tw:font-medium tw:text-text-primary tw:tracking-[-0.01em]', sizeClass.title]"
        >
          <slot name="title">{{ resolvedTitle }}</slot>
        </component>
        <p
          v-if="resolvedDescription || $slots.description"
          :class="['tw:text-text-secondary tw:leading-relaxed', sizeClass.description]"
        >
          <slot name="description">{{ resolvedDescription }}</slot>
        </p>
      </div>

      <!-- actions: a custom #actions slot wins; otherwise the resolved primary
           (+ optional secondary) button(s) from preset/props -->
      <div
        v-if="$slots.actions || showCards || resolvedActionLabel || secondaryActionLabel"
        :class="['tw:flex tw:flex-wrap tw:items-center tw:justify-center', sizeClass.actions]"
      >
        <slot name="actions">
          <template v-if="showCards">
            <EmptyStateActionCard
              v-for="(a, i) in resolvedActions"
              :key="a.id || i"
              :icon="a.icon"
              :label="t(a.titleKey)"
              :sublabel="a.descriptionKey ? t(a.descriptionKey) : undefined"
              @click="emit('action', a.id)"
            />
          </template>
          <template v-else>
            <OButton
              v-if="resolvedActionLabel"
              :variant="actionVariant"
              :size="size === 'inline' ? 'sm' : 'md'"
              :icon-left="resolvedActionIcon"
              @click="emit('action')"
            >
              {{ resolvedActionLabel }}
            </OButton>
            <OButton
              v-if="secondaryActionLabel"
              variant="ghost"
              :size="size === 'inline' ? 'sm' : 'md'"
              @click="emit('secondaryAction')"
            >
              {{ secondaryActionLabel }}
            </OButton>
          </template>
        </slot>
      </div>

      <div v-if="$slots.extra" :class="sizeClass.extra">
        <slot name="extra" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useSlots } from "vue";
import { useI18n } from "vue-i18n";

import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";

import EmptyStateActionCard from "./EmptyStateActionCard.vue";
import { illustrations, type IllustrationName } from "./illustrations";
import {
  emptyStatePresets,
  presetNouns,
  type EmptyStateAction,
  type EmptyStatePresetName,
  type EmptyStateVariant,
} from "./presets";

type Size = "hero" | "block" | "inline";

const props = withDefaults(
  defineProps<{
    /** Named scenario from the catalog (fills illustration + copy + action). */
    preset?: EmptyStatePresetName;
    /** Visual scale for the context this empty state sits in. */
    size?: Size;
    /** Tone; defaults from the preset, else "neutral". */
    variant?: EmptyStateVariant;
    /** Illustration by name (ignored if a preset or #illustration slot is set). */
    illustration?: IllustrationName;
    /** Icon for the compact `inline` size (when no illustration). */
    icon?: IconName;
    /** Copy — overrides preset i18n when provided. */
    title?: string;
    description?: string;
    /** Rich action cards; overrides the preset's actions when provided. */
    actions?: EmptyStateAction[];
    /** Simple primary button (used instead of cards); emits `action` on click. */
    actionLabel?: string;
    actionIcon?: IconName;
    /** Secondary action; emits `secondaryAction` on click. */
    secondaryActionLabel?: string;
    /** Suppress the preset's actions (e.g. table empties with no CTA). */
    hideAction?: boolean;
    /**
     * The underlying list HAS items but the current filter/search matched none.
     * Switches to a "no results" treatment (magnifier + "No {noun} found" +
     * Clear filters) instead of the preset's first-run copy. The `clear-filters`
     * action id is emitted on `action`.
     */
    filtered?: boolean;
    /** Force the dot-grid backdrop on/off (default: on for hero/block). */
    backdrop?: boolean;
  }>(),
  { size: "block" },
);

const emit = defineEmits<{
  (e: "action", id?: string): void;
  (e: "secondaryAction"): void;
}>();

const slots = useSlots();
const { t } = useI18n();

const preset = computed(() =>
  props.preset ? emptyStatePresets[props.preset] : undefined,
);

const size = computed(() => props.size);

// --- filtered (search/filter matched nothing) vs first-run ------------------
const isFiltered = computed(() => !!props.filtered);
// The thing being listed, for "No {noun} found" copy (e.g. "pipelines").
const noun = computed(() => {
  const key = props.preset ? presetNouns[props.preset] : undefined;
  return key ? t(key) : t("emptyState.filtered.fallbackNoun");
});
const FILTERED_ACTION: EmptyStateAction = {
  id: "clear-filters",
  icon: "filter-list",
  titleKey: "emptyState.filtered.action",
  descriptionKey: "emptyState.filtered.actionDesc",
};

// --- copy resolution: filtered > explicit prop > preset i18n key ------------
const resolvedTitle = computed(() => {
  if (props.title) return props.title;
  if (isFiltered.value)
    return t("emptyState.filtered.title", { noun: noun.value });
  return preset.value ? t(preset.value.titleKey) : "";
});
const resolvedDescription = computed(() => {
  if (props.description) return props.description;
  if (isFiltered.value)
    return t("emptyState.filtered.description", { noun: noun.value });
  const key = preset.value?.descriptionKey;
  return key ? t(key) : "";
});
// Rich action cards. Suppressed by `hideAction` and on inline size. In the
// filtered state the only action is "Clear filters".
const resolvedActions = computed<EmptyStateAction[]>(() => {
  if (props.hideAction) return [];
  if (isFiltered.value) return [FILTERED_ACTION];
  return props.actions ?? preset.value?.actions ?? [];
});
const showCards = computed(
  () => size.value !== "inline" && resolvedActions.value.length > 0,
);

// Simple button fallback (only when a call site passes actionLabel directly and
// there are no cards).
const resolvedActionLabel = computed(() =>
  props.hideAction ? "" : (props.actionLabel ?? ""),
);
const resolvedActionIcon = computed<IconName | undefined>(
  () => props.actionIcon,
);

// --- variant / illustration -------------------------------------------------
const variant = computed<EmptyStateVariant>(() =>
  isFiltered.value
    ? "no-results"
    : (props.variant ?? preset.value?.variant ?? "neutral"),
);
const actionVariant = computed(() =>
  variant.value === "error" ? "outline" : "primary",
);

// Filtered always uses the magnifier so it reads as "search found nothing".
const illustrationName = computed<IllustrationName | undefined>(() =>
  isFiltered.value
    ? "no-results"
    : (props.illustration ?? preset.value?.illustration),
);
const illustrationComponent = computed(() =>
  illustrationName.value ? illustrations[illustrationName.value] : undefined,
);
// inline never shows the full illustration — it uses a compact icon instead.
const hasIllustration = computed(
  () =>
    size.value !== "inline" &&
    (!!slots.illustration || !!illustrationComponent.value),
);
const inlineIcon = computed<IconName | undefined>(() => {
  if (size.value !== "inline") return undefined;
  if (props.icon) return props.icon;
  // sensible default icon per tone
  return variant.value === "error" ? "error-outline" : "search-off";
});

// --- prefers-reduced-motion -------------------------------------------------
const animated = ref(true);
let mq: MediaQueryList | undefined;
const syncMotion = () => {
  animated.value = !(mq?.matches ?? false);
};
onMounted(() => {
  if (typeof window !== "undefined" && window.matchMedia) {
    mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    syncMotion();
    mq.addEventListener?.("change", syncMotion);
  }
});
onBeforeUnmount(() => mq?.removeEventListener?.("change", syncMotion));

// --- backdrop ---------------------------------------------------------------
const showBackdrop = computed(() =>
  props.backdrop ?? size.value !== "inline",
);
const dotGridStyle =
  "background-image: radial-gradient(var(--empty-dot) 1.25px, transparent 1.25px);" +
  "background-size: 30px 30px;" +
  "-webkit-mask-image: radial-gradient(ellipse 60% 62% at 50% 44%, #000 0%, transparent 70%);" +
  "mask-image: radial-gradient(ellipse 60% 62% at 50% 44%, #000 0%, transparent 70%);";

// --- per-size class map -----------------------------------------------------
// One place that defines how each size scales: container, gaps, illustration
// width, and the type ramp. Keeps the three sizes visually consistent.
const SIZE_MAP: Record<
  Size,
  {
    root: string;
    stack: string;
    copy: string;
    actions: string;
    extra: string;
    title: string;
    description: string;
    illustrationWidth: number;
    iconWrap: string;
  }
> = {
  hero: {
    root: "tw:w-full tw:h-full tw:min-h-[320px] tw:px-6 tw:py-12",
    stack: "tw:gap-7",
    copy: "tw:gap-2.5",
    actions: "tw:gap-3 tw:pt-1",
    extra: "tw:w-full tw:flex tw:flex-col tw:items-center tw:gap-3 tw:pt-2",
    title: "tw:text-2xl!",
    description: "tw:text-base",
    illustrationWidth: 300,
    iconWrap: "",
  },
  block: {
    root: "tw:w-full tw:min-h-[260px] tw:px-6 tw:py-10",
    stack: "tw:gap-5",
    copy: "tw:gap-2",
    actions: "tw:gap-2.5 tw:pt-0.5",
    extra: "tw:w-full tw:flex tw:flex-col tw:items-center tw:gap-2 tw:pt-1",
    title: "tw:text-lg!",
    description: "tw:text-sm",
    illustrationWidth: 150,
    iconWrap: "",
  },
  inline: {
    root: "tw:w-full tw:min-h-[160px] tw:px-4 tw:py-8",
    stack: "tw:gap-3",
    copy: "tw:gap-1",
    actions: "tw:gap-2 tw:pt-1",
    extra: "tw:w-full tw:flex tw:flex-col tw:items-center tw:gap-1.5 tw:pt-1",
    title: "tw:text-sm!",
    description: "tw:text-xs",
    illustrationWidth: 0,
    iconWrap:
      "tw:w-12 tw:h-12 tw:bg-surface-subtle tw:text-text-secondary tw:mb-0.5",
  },
};
const sizeClass = computed(() => SIZE_MAP[size.value]);
</script>

<style scoped>
.o2-empty-state {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  --empty-dot: var(--color-grey-300);
}
:global(.dark) .o2-empty-state {
  --empty-dot: var(--color-grey-800);
}
</style>
