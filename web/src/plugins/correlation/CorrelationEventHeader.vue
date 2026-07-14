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
  <!-- Source Event Banner -->
  <div
    v-if="sourceEvent && (sourceEvent.timestamp || sourceEvent.message)"
    class="source-event-banner flex items-start gap-3 px-4 py-2 border-b border-solid border-[var(--o2-border-color)]"
  >
    <OTag
      v-if="sourceEvent.severity"
      type="logLevel"
      :value="sourceEvent.severity"
      class="shrink-0"
    />
    <span class="text-xs font-mono text-typography-meta shrink-0">
      {{ formatEventTimestamp(sourceEvent.timestamp) }}
    </span>
    <OSeparator
      v-if="sourceEvent.message"
      vertical
      class="mx-0"
    />
    <span
      v-if="sourceEvent.message"
      class="text-xs flex-1 font-mono text-typography-meta source-event-message"
      :title="sourceEvent.message"
    >
      {{ sourceEvent.message }}
    </span>
  </div>

  <!-- Chips Row -->
  <div
    v-if="hasChips || $slots['chip-actions']"
    class="flex items-center gap-6 px-4 border-b border-solid border-[var(--o2-border-color)]"
  >
    <!-- Context chips (Correlated by) — flex-1 so it occupies exactly the space
         left after the shrink-0 subject section (toggles + dynamic badge). Its
         measured width drives the responsive overflow math. -->
    <div
      v-if="contextChips && contextChips.length > 0"
      ref="containerRef"
      class="flex items-center gap-3  py-2 flex-1 min-w-0"
    >
      <span class="text-2! m-0 text-typography-meta shrink-0">Correlated by:</span>
      <div class="flex items-center gap-2 min-w-0 overflow-hidden">
        <ODimensionChip
          v-for="chip in displayedChips"
          :key="chip.key"
          :dim-key="chip.key"
          :key-label="chip.label"
          :value="chip.value"
          :tooltip="false"
          class="min-w-0"
          :data-test="`correlation-event-header-chip-${chip.key}`"
        />

        <span v-if="hiddenChipCount > 0" class="contents">
          <OTag
            type="correlationChip"
            value="overflow"
            class="cursor-default"
            :data-test="`correlation-event-header-overflow-${hiddenChipCount}`"
          >
            <template v-if="hiddenChipCount !== contextChips.length">+</template>{{ hiddenChipCount }}<template v-if="hiddenChipCount === contextChips.length"> Fields</template>
          </OTag>
          <OTooltip side="top" :disabled="hiddenChipCount === 0">
            <template #content>
              <div class="flex flex-col items-start gap-1">
                <ODimensionChip
                  v-for="chip in hiddenChips"
                  :key="chip.key"
                  :dim-key="chip.key"
                  :key-label="chip.label"
                  :value="chip.value"
                  :tooltip="false"
                  :data-test="`correlation-event-header-hidden-chip-${chip.key}`"
                />
              </div>
            </template>
          </OTooltip>
        </span>
      </div>
    </div>

    <!-- Subject chips (View by) — shown when subjectChips are provided -->
    <div
      v-if="showSubjectSection"
      class="flex items-center gap-3 shrink-0"
    >
      <OSeparator vertical class="my-2" />
      <span class="text-2! m-0 text-typography-meta">View by:</span>
      <OToggleGroup
        :model-value="activeSubject ?? undefined"
        type="single"
        size="xs"
        class="h-7!"
        @update:model-value="(v: string | undefined) => emit('update:activeSubject', v ?? null)"
      >
        <OToggleGroupItem
          v-for="chip in subjectChips"
          :key="chip.key"
          :value="chip.key"
          size="sm"
          class="h-5.5!"
          :disabled="!!chip.disabled"
          :data-test="`correlation-event-header-subject-${chip.key}`"
        >
          {{ getSubjectButtonLabel ? getSubjectButtonLabel(chip.key) : chip.label }}
          <OTooltip :content="`${chip.label} = ${chip.value}`" side="top" />
          <template v-if="chip.disabled">
            <OTooltip
              :content="`No metric streams found for this ${chip.label.toLowerCase()}`"
              side="top"
            />
          </template>
        </OToggleGroupItem>
      </OToggleGroup>

      <!-- Selected subject as a "label = value" badge (when it carries a value) -->
      <OTag
        v-if="activeSubjectChip && activeSubjectChip.value"
        type="correlationChip"
        value="subject"
        :data-test="`correlation-event-header-active-subject-${activeSubjectChip.key}`"
      >
        {{ activeSubjectChip.label }} = {{ activeSubjectChip.value }}
      </OTag>
    </div>

    <!-- Slot for actions co-located with the chip row (e.g. wrap-text button) -->
    <div v-if="$slots['chip-actions']" class="ml-auto shrink-0">
      <slot name="chip-actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { useStore } from "vuex";
import OTag from "@/lib/core/Badge/OTag.vue";
import ODimensionChip from "@/lib/core/Badge/ODimensionChip.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import {
  convertTimeFromNsToMs,
  convertTimeFromMicroToMilli,
  timestampToTimezoneDate,
} from "@/utils/zincutils";

type ChipKind = "context" | "subject";

export type DimensionChip = {
  key: string;
  label: string;
  value: string;
  kind: ChipKind;
  active: boolean;
  disabled?: boolean;
};

const props = withDefaults(
  defineProps<{
    sourceEvent?: {
      timestamp?: number | string;
      severity?: string;
      message?: string;
    };
    contextChips?: DimensionChip[];
    subjectChips?: DimensionChip[];
    activeSubject?: string | null;
    overflowMode?: "responsive" | "threshold";
    overflowThreshold?: number;
    getSubjectButtonLabel?: (id: string) => string;
  }>(),
  {
    overflowMode: "threshold",
    overflowThreshold: 4,
  },
);

const emit = defineEmits<{
  "update:activeSubject": [value: string | null];
}>();


// ── Responsive overflow (ResizeObserver) ─────────────────────────────────────

const containerRef = ref<HTMLElement>();
const containerWidth = ref(0);

const CHIP_GAP = 8; // gap-2 = 0.5rem = 8px
const OVERFLOW_INDICATOR_WIDTH = 40;

function estimateChipWidth(chip: DimensionChip): number {
  const text = `${chip.label} = ${chip.value}`;
  const labelWidth = Math.min(Math.ceil(text.length * 7.5), 200);
  return labelWidth + 10; // padding + dot space
}

watch(
  containerRef,
  (el, _prev, onCleanup) => {
    if (!el || props.overflowMode !== "responsive") return;
    const updateWidth = () => {
      containerWidth.value = el.getBoundingClientRect().width;
    };
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  containerWidth.value = 0;
});

// ── Derived display state ─────────────────────────────────────────────────────

const showSubjectSection = computed(
  () => (props.subjectChips?.length ?? 0) > 0,
);

// The currently-selected subject chip, shown as a "label = value" badge after the
// View-by toggles. Only meaningful when it carries a concrete value (trace/log);
// incidents' valueless subjects leave this null so no empty badge renders.
const activeSubjectChip = computed<DimensionChip | undefined>(() =>
  props.subjectChips?.find((c) => c.key === props.activeSubject),
);

const hasChips = computed(
  () =>
    (props.contextChips?.length ?? 0) > 0 || showSubjectSection.value,
);

const displayedChips = computed<DimensionChip[]>(() => {
  const chips = props.contextChips ?? [];
  if (chips.length === 0) return [];

  if (props.overflowMode === "responsive") {
    // containerRef is the flex-1 context wrapper, so its measured width already
    // excludes the (dynamic) subject section + badge — no need to reserve for them.
    const fullWidth = containerWidth.value;
    const labelWidth = 90; // "Correlated by:" label
    const paddingAndGaps = 8;
    const available = fullWidth - labelWidth - paddingAndGaps;

    let usedWidth = 0;
    let visibleCount = 0;
    for (let i = 0; i < chips.length; i++) {
      const chipWidth = estimateChipWidth(chips[i]);
      const remaining = chips.length - i - 1;
      const overflowSpace =
        remaining > 0 ? OVERFLOW_INDICATOR_WIDTH + CHIP_GAP : 0;
      const neededWidth =
        chipWidth + (i > 0 ? CHIP_GAP : 0) + overflowSpace;
      if (usedWidth + neededWidth > available) break;
      usedWidth += chipWidth + (i > 0 ? CHIP_GAP : 0);
      visibleCount++;
    }
    return chips.slice(0, visibleCount);
  }

  return chips.slice(0, props.overflowThreshold);
});

const hiddenChips = computed<DimensionChip[]>(() => {
  const chips = props.contextChips ?? [];
  return chips.slice(displayedChips.value.length);
});

const hiddenChipCount = computed(() => hiddenChips.value.length);

// ── Source event banner helpers ───────────────────────────────────────────────

const store = useStore();

const TS_NS_MIN = 1e17;
const TS_US_MIN = 1e14;
const TS_MS_MIN = 1e11;
const TS_S_MIN = 1e9;

const formatEventTimestamp = (ts: number | string | undefined): string => {
  if (ts == null || ts === "") return "";
  if (typeof ts === "string" && !/^\d+$/.test(ts.trim())) return ts;
  const n = typeof ts === "number" ? ts : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return String(ts);
  let ms: number;
  if (n >= TS_NS_MIN) ms = convertTimeFromNsToMs(n);
  else if (n >= TS_US_MIN) ms = convertTimeFromMicroToMilli(n);
  else if (n >= TS_MS_MIN) ms = n;
  else if (n >= TS_S_MIN) ms = n * 1000;
  else ms = n;
  try {
    const timezone = store.state.timezone || "UTC";
    return `${timestampToTimezoneDate(ms, timezone, "yyyy-MM-dd HH:mm:ss.SSS")} ${timezone}`;
  } catch {
    return String(ts);
  }
};
</script>

<style scoped>
.source-event-banner {
  background: var(--o2-card-bg, var(--o2-bg-color));
}
.source-event-message {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
  word-break: break-word;
  line-height: 1.4;
}
</style>
