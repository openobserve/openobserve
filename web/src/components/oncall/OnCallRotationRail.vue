<!--
  One card per rotation, beside the chart rather than under it.

  The table below the chart answers "what are the rotations"; this answers "which
  one is carrying the pager right now, and what do I do about it". Those are
  different questions and the second one is the reason somebody opened the tab,
  so it gets the actions.

  Every figure is read off the schedule and the resolved segments the chart is
  already drawing, so a card cannot claim something the lane beside it denies.
-->
<template>
  <aside class="flex flex-col gap-2" data-test="oncall-rotation-rail">
    <span class="flex items-baseline gap-2">
      <OText variant="section">
        {{ t("oncall.railRotations", { count: rotations.length }) }}
      </OText>
    </span>

    <div
      v-for="(entry, index) in cards"
      :key="entry.rotation.name"
      class="rounded-surface border p-3"
      :class="
        entry.hasGap ? 'border-status-error-border bg-status-error-bg' : 'border-border-default'
      "
      :data-test="`oncall-rail-card-${entry.rotation.name}`"
    >
      <span class="flex flex-wrap items-center gap-2">
        <!-- The same tone the lane uses, so a card and its row on the chart are
             obviously the same thing. -->
        <span
          class="size-2 shrink-0 rounded-full"
          :class="toneClass(index)"
          aria-hidden="true"
        />
        <OText variant="section">{{ raw(entry.rotation.name) }}</OText>
        <OTag v-if="entry.slot" variant="default-soft" size="sm">{{ raw(entry.slot) }}</OTag>
        <OTag
          :variant="entry.hasGap ? 'error-soft' : 'success-soft'"
          size="sm"
          class="ms-auto"
          :data-test="`oncall-rail-status-${entry.rotation.name}`"
        >
          {{ entry.hasGap ? t("oncall.railHasGap") : t("oncall.railActive") }}
        </OTag>
      </span>

      <p class="text-text-secondary mt-1 text-xs">{{ entry.summary }}</p>

      <span v-if="entry.onNow" class="mt-2 flex flex-wrap items-center gap-2">
        <OUserCell :value="entry.onNow" />
        <span class="text-text-secondary text-xs">{{ entry.leftLabel }}</span>
      </span>
      <!-- A rotation the resolver never puts anybody on is the finding, not an
           empty row: it means this layer never wins. -->
      <p
        v-else
        class="text-text-secondary mt-2 text-xs"
        :data-test="`oncall-rail-nobody-${entry.rotation.name}`"
      >
        {{ t("oncall.railNobodyFromThis") }}
      </p>

      <span class="mt-3 flex flex-wrap gap-2">
        <OButton
          variant="outline"
          size="xs"
          :data-test="`oncall-rail-edit-${entry.rotation.name}`"
          @click="emit('edit', entry.rotation.name)"
        >
          {{ t("oncall.edit") }}
        </OButton>
        <OButton
          variant="outline"
          size="xs"
          :data-test="`oncall-rail-override-${entry.rotation.name}`"
          @click="emit('override', entry.rotation.name)"
        >
          {{ t("oncall.railOverride") }}
        </OButton>
        <OButton
          variant="ghost"
          size="xs"
          :data-test="`oncall-rail-duplicate-${entry.rotation.name}`"
          @click="emit('duplicate', entry.rotation.name)"
        >
          {{ t("oncall.railDuplicate") }}
        </OButton>
      </span>
    </div>

    <OButton
      variant="outline"
      size="sm-action"
      icon-left="add"
      data-test="oncall-rail-add"
      @click="emit('add')"
    >
      {{ t("oncall.addRotation") }}
    </OButton>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { SCHEDULE_BAND_TONE_COUNT } from "@/lib/data/ScheduleTimeline/OScheduleTimeline.types";
import type { ResolvedSegment, Rotation } from "@/ts/interfaces/oncall";
import { DEFAULT_SLOT, sameSlot } from "@/ts/interfaces/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatMicrosDuration } from "@/utils/formatters";
import { formatInZone } from "@/utils/oncall";

const props = withDefaults(
  defineProps<{
    rotations?: Rotation[];
    /** The window the chart is drawing, so a card cannot disagree with a lane. */
    segments?: ResolvedSegment[];
    timezone?: string;
    /** Micros. Defaults to now; injectable so the spec is not clock-dependent. */
    now?: number;
  }>(),
  { rotations: () => [], segments: () => [], timezone: "UTC", now: 0 },
);

const emit = defineEmits<{
  edit: [name: string];
  override: [name: string];
  duplicate: [name: string];
  add: [];
}>();

const { t } = useI18nTyped();

const nowMicros = computed(() => props.now || Date.now() * 1000);

/// The band palette is 1-based and wraps, exactly as the chart's lanes do.
function toneClass(index: number): string {
  return `bg-schedule-band-${(index % SCHEDULE_BAND_TONE_COUNT) + 1}-bg`;
}

interface RailCard {
  rotation: Rotation;
  /** Absent for the default slot — naming it would be noise on a one-pool team. */
  slot: string;
  summary: I18nText;
  onNow: string;
  leftLabel: I18nText;
  hasGap: boolean;
}

const cards = computed<RailCard[]>(() =>
  props.rotations.map((rotation) => {
    const mine = props.segments.filter((s) => s.rotation === rotation.name);
    const current = mine.find((s) => s.from <= nowMicros.value && s.to > nowMicros.value);

    return {
      rotation,
      slot: sameSlot(rotation.slot, DEFAULT_SLOT) ? "" : (rotation.slot ?? ""),
      summary: t("oncall.railSummary", {
        cadence: formatMicrosDuration(rotation.shift_micros),
        handover: raw(
          formatInZone(rotation.anchor_micros, props.timezone, {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          }),
        ),
        people: rotation.members.length,
      }),
      onNow: current?.user_email ?? "",
      leftLabel: current
        ? t("oncall.railLeft", { duration: formatMicrosDuration(current.to - nowMicros.value) })
        : raw(""),
      hasGap: mine.some((s) => !s.user_email && s.to > nowMicros.value),
    };
  }),
);
</script>
