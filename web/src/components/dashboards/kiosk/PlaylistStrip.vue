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
    class="bg-surface-panel border-border-default relative shrink-0 border-b"
    data-test="dashboard-playlist-strip"
  >
    <!-- Lower-value items give way first, measured against the real width; status chips are never dropped. -->
    <div
      ref="rowRef"
      class="px-page-edge flex h-14 min-w-0 items-center gap-4 overflow-hidden text-lg"
      :data-fit="step"
    >
      <span
        class="text-text-heading flex min-w-0 items-center gap-2 text-2xl font-semibold"
        :class="step >= STEP.titleShrinks ? 'min-w-16' : 'min-w-48'"
      >
        <OIcon name="dashboard" size="md" class="text-accent shrink-0" />
        <OTruncatedText
          :tooltip="shownTitle !== title ? false : undefined"
          data-test="dashboard-playlist-title"
          >{{ shownTitle }}</OTruncatedText
        >
        <OTooltip v-if="shownTitle !== title" :content="title" />
      </span>
      <OBadge
        variant="default-outline"
        size="lg"
        class="shrink-0 tabular-nums"
        data-test="dashboard-playlist-position"
        >{{ position }}</OBadge
      >
      <span
        v-if="timeRangeLabel && step < STEP.noRange"
        class="text-text-secondary flex shrink-0 items-center gap-1.5"
        data-test="dashboard-playlist-time-range"
      >
        <OIcon name="schedule" size="sm" />
        {{ timeRangeLabel }}
      </span>

      <span class="ms-auto flex shrink-0 items-center gap-3">
        <span
          v-if="step < STEP.noDots"
          class="flex shrink-0 items-center gap-1.5"
          role="list"
          :aria-label="t('dashboard.playlist.healthDots')"
          data-test="dashboard-playlist-dots"
        >
          <span
            v-for="(slide, i) in slides"
            :key="i"
            role="listitem"
            class="rounded-full"
            :class="dotClass(slide, i)"
            :data-level="dotLevel(slide)"
            :data-current="i === index ? 'true' : undefined"
            :data-test="`dashboard-playlist-dot-${i}`"
          >
            <OTooltip :content="dotLabel(slide, i)" />
          </span>
        </span>

        <OBadge
          v-for="chip in chips"
          :key="chip.id"
          :variant="chip.variant"
          size="lg"
          :dot="chip.dot"
          :icon="step >= STEP.miniChips ? (chip.miniIcon ?? chip.icon) : chip.icon"
          class="shrink-0 tabular-nums"
          :data-test="`dashboard-playlist-${chip.id}`"
          :data-form="chipForm"
          >{{ chipText(chip) }}
          <OTooltip
            v-if="chipForm !== 'full' || chip.tooltip"
            :content="chip.tooltip ?? chip.text"
          />
        </OBadge>

        <span
          class="text-text-heading flex shrink-0 items-center gap-1.5 font-medium tabular-nums"
          data-test="dashboard-playlist-updated"
        >
          <OIcon
            :name="lastSuccessAt && !held ? 'check-circle' : 'schedule'"
            size="sm"
            :class="lastSuccessAt && !held ? 'text-status-success-text' : undefined"
          />
          {{ updatedText }}
        </span>
      </span>
    </div>
    <OProgressBar
      :value="progress"
      size="xs"
      :variant="held ? 'danger' : paused || waiting ? 'neutral' : 'default'"
      data-test="dashboard-playlist-progress"
    />
    <!-- A bar below the strip, over the top of the dashboard, so showing it never covers or reflows the strip. -->
    <span
      class="bg-surface-panel border-border-default rounded-surface end-page-edge absolute top-full z-40 mt-2 flex items-center gap-1.5 border p-1.5 shadow-md transition-opacity duration-200"
      :class="controlsVisible ? 'opacity-100' : 'pointer-events-none invisible opacity-0'"
      data-test="dashboard-playlist-controls"
    >
      <OButton
        variant="outline"
        size="icon-toolbar"
        icon-left="navigate-before"
        :tabindex="controlsVisible ? 0 : -1"
        :aria-label="t('dashboard.playlist.previous')"
        data-test="dashboard-playlist-prev"
        @click="emit('prev')"
      >
        <OTooltip :content="t('dashboard.playlist.previous')" shortcut-id="dashboardPlaylistPrev" />
      </OButton>
      <OButton
        variant="outline"
        size="icon-toolbar"
        :icon-left="paused ? 'play-arrow' : 'pause'"
        :tabindex="controlsVisible ? 0 : -1"
        :aria-label="paused ? t('dashboard.playlist.resume') : t('dashboard.playlist.pause')"
        data-test="dashboard-playlist-pause"
        @click="emit('toggle-pause')"
      >
        <OTooltip
          :content="paused ? t('dashboard.playlist.resume') : t('dashboard.playlist.pause')"
          shortcut-id="dashboardPlaylistPause"
        />
      </OButton>
      <OButton
        variant="outline"
        size="icon-toolbar"
        icon-left="navigate-next"
        :tabindex="controlsVisible ? 0 : -1"
        :aria-label="t('dashboard.playlist.next')"
        data-test="dashboard-playlist-next"
        @click="emit('next')"
      >
        <OTooltip :content="t('dashboard.playlist.next')" shortcut-id="dashboardPlaylistNext" />
      </OButton>
      <OButton
        v-if="!tight"
        variant="outline"
        size="sm-toolbar"
        icon-left="edit"
        :tabindex="controlsVisible ? 0 : -1"
        data-test="dashboard-playlist-edit"
        @click="emit('edit')"
      >
        {{ t("dashboard.playlist.edit") }}
      </OButton>
      <OButton
        variant="outline"
        :size="tight ? 'icon-toolbar' : 'sm-toolbar'"
        icon-left="close"
        :tabindex="controlsVisible ? 0 : -1"
        :aria-label="t('dashboard.playlist.exit')"
        data-test="dashboard-playlist-exit"
        @click="emit('exit')"
      >
        <template v-if="!tight">
          {{ t("dashboard.playlist.exit") }}
          <OShortcut id="dashboardPlaylistExit" class="ms-1" />
        </template>
        <OTooltip
          v-else
          :content="t('dashboard.playlist.exit')"
          shortcut-id="dashboardPlaylistExit"
        />
      </OButton>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OShortcut from "@/lib/core/Shortcut/OShortcut.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OProgressBar from "@/lib/data/ProgressBar/OProgressBar.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { BadgeVariant } from "@/lib/core/Badge/OBadge.types";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import {
  slideDotLevel,
  type SlideDotLevel,
  type SlideRecord,
} from "@/composables/dashboard/usePlaylistPlayer";

const props = withDefaults(
  defineProps<{
    title: I18nText;
    /** "2 of 3", counting only dashboards that can be shown. */
    position: I18nText;
    /** Display name per slide. */
    names?: string[];
    /** One line per dashboard that is skipped (deleted or no access). */
    skipped?: I18nText[];
    index: number;
    slides: SlideRecord[];
    timeRangeLabel?: I18nText | null;
    worstOther?: { index: number; level: SlideDotLevel; failing: number } | null;
    held?: boolean;
    paused?: boolean;
    pausedAt?: number | null;
    waiting?: boolean;
    progress?: number;
    lastSuccessAt?: number | null;
    timezone?: string;
    controlsVisible?: boolean;
  }>(),
  {
    timeRangeLabel: null,
    worstOther: null,
    names: () => [],
    skipped: () => [],
    held: false,
    paused: false,
    pausedAt: null,
    waiting: false,
    progress: 0,
    lastSuccessAt: null,
    timezone: undefined,
    controlsVisible: false,
  },
);

const emit = defineEmits<{
  prev: [];
  next: [];
  "toggle-pause": [];
  edit: [];
  exit: [];
}>();

const { t } = useI18nTyped();

/** Layout steps, in the order things give way: decoration first, status text last. */
const STEP = {
  full: 0,
  noDots: 1,
  noRange: 2,
  shortChips: 3,
  shortUpdated: 4,
  titleShrinks: 5,
  miniChips: 6,
} as const;
const LAST_STEP = STEP.miniChips;
const MIN_PREFIX = 4;

const step = ref<number>(STEP.full);
const rowRef = ref<HTMLElement | null>(null);

/** Compact controls once the strip is short of room. */
const tight = computed(() => step.value >= STEP.titleShrinks);

const formatTime = (ms: number, seconds: boolean) => {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: props.timezone }).format(ms);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(ms);
  }
};

const slideName = (i: number) => raw(props.names[i] ?? props.slides[i]?.title ?? "");

/** Prefix every name shares ("pt-pl2-"), so a short title can show the part that tells them apart. */
const sharedPrefix = computed(() => {
  const names = props.names.filter(Boolean);
  if (names.length < 2) return "";
  let prefix = names[0];
  for (const name of names.slice(1)) {
    while (prefix && !name.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix.length >= MIN_PREFIX ? prefix : "";
});

const shortName = (name: string) => {
  const prefix = sharedPrefix.value;
  return prefix && name.startsWith(prefix) && name.length > prefix.length
    ? `…${name.slice(prefix.length)}`
    : name;
};

const shownTitle = computed(() =>
  step.value >= STEP.titleShrinks ? raw(shortName(String(props.title))) : props.title,
);

const skippedText = computed(() => raw(props.skipped.join(" · ")));

const currentFailing = computed(() => props.slides[props.index]?.health?.failing ?? 0);

const dotLevel = (slide: SlideRecord) => slideDotLevel(slide);

const DOT_COLOR: Record<SlideDotLevel, string> = {
  unknown: "bg-border-strong",
  ok: "bg-badge-success-solid-bg",
  warn: "bg-badge-warning-solid-bg",
  bad: "bg-badge-error-solid-bg",
  missing: "border border-border-strong",
};

const dotClass = (slide: SlideRecord, i: number) => [
  DOT_COLOR[slideDotLevel(slide)],
  i === props.index ? "ring-accent/50 size-4 ring-2" : "size-3",
];

const dotLabel = (slide: SlideRecord, i: number) => {
  const name = slideName(i);
  const failing = slide.health?.failing ?? 0;
  switch (slideDotLevel(slide)) {
    case "ok":
      return t("dashboard.playlist.dotOk", { name });
    case "warn":
      return t("dashboard.playlist.dotWarn", { name, count: failing }, failing);
    case "bad":
      return t("dashboard.playlist.dotBad", { name });
    case "missing":
      return t("dashboard.playlist.dotMissing", { name });
    default:
      return t("dashboard.playlist.dotUnknown", { name });
  }
};

const updatedText = computed(() => {
  if (!props.lastSuccessAt) return t("common.loading");
  const time = formatTime(props.lastSuccessAt, true);
  return step.value >= STEP.shortUpdated ? raw(time) : t("dashboard.kiosk.updatedAt", { time });
});

interface StripChip {
  id: string;
  variant: BadgeVariant;
  dot?: boolean;
  icon?: IconName;
  /** Icon that carries the meaning once the text is gone. */
  miniIcon?: IconName;
  text: I18nText;
  short: I18nText;
  mini: I18nText;
  /** Shown on hover even at full size, for text the chip itself never says. */
  tooltip?: I18nText;
}

type ChipForm = "full" | "short" | "mini";

const chipForm = computed<ChipForm>(() => {
  if (step.value >= STEP.miniChips) return "mini";
  if (step.value >= STEP.shortChips) return "short";
  return "full";
});

const chipText = (chip: StripChip) => chip[chipForm.value === "full" ? "text" : chipForm.value];

const chips = computed<StripChip[]>(() => {
  const list: StripChip[] = [];
  const skippedCount = props.skipped.length;
  if (skippedCount) {
    const text = t("dashboard.playlist.skippedCount", { count: skippedCount }, skippedCount);
    list.push({
      id: "skipped",
      variant: "default-outline",
      icon: "navigate-next",
      text,
      short: text,
      mini: raw(String(skippedCount)),
      tooltip: skippedText.value,
    });
  }
  const worst = props.worstOther;
  if (worst) {
    const name = slideName(worst.index);
    const short = raw(shortName(String(name)));
    const bad = worst.level === "bad";
    list.push({
      id: "worst-other",
      variant: bad ? "error-soft" : "warning-soft",
      dot: true,
      text: bad
        ? t("dashboard.playlist.dotBad", { name })
        : t("dashboard.playlist.otherFailing", { name, count: worst.failing }, worst.failing),
      short: bad
        ? t("dashboard.playlist.dotBad", { name: short })
        : t(
            "dashboard.playlist.otherFailingShort",
            { name: short, count: worst.failing },
            worst.failing,
          ),
      mini: raw(bad ? "!" : String(worst.failing)),
    });
  }
  if (props.held) {
    const time = props.lastSuccessAt ? formatTime(props.lastSuccessAt, false) : null;
    list.push({
      id: "held",
      variant: "error-soft",
      dot: true,
      miniIcon: "cloud-off",
      // The visible slide still shows its last render, so the chip says how old that render is.
      text: time
        ? t("dashboard.playlist.unreachableSince", { time })
        : t("dashboard.playlist.held"),
      short: time
        ? t("dashboard.playlist.unreachableShort", { time })
        : t("dashboard.playlist.unreachableWord"),
      mini: raw(""),
    });
  } else if (currentFailing.value > 0) {
    const count = currentFailing.value;
    list.push({
      id: "failing",
      variant: "warning-soft",
      dot: true,
      text: t("dashboard.kiosk.panelsFailing", { count }, count),
      short: t("dashboard.playlist.failingShort", { count }, count),
      mini: raw(String(count)),
    });
  }
  if (props.paused && props.pausedAt) {
    const time = formatTime(props.pausedAt, false);
    list.push({
      id: "paused",
      variant: "primary-soft",
      icon: "pause",
      text: t("dashboard.playlist.pausedSince", { time }),
      short: t("dashboard.playlist.pausedShort", { time }),
      mini: raw(""),
    });
  }
  return list;
});

const overflows = () => {
  const row = rowRef.value;
  return !!row && row.scrollWidth > row.clientWidth + 1;
};

let fitting = false;
let fitAgain = false;
// Starts from the roomiest layout each time, so a chip going away gives the text back.
const refit = async () => {
  if (fitting) {
    fitAgain = true;
    return;
  }
  fitting = true;
  try {
    do {
      fitAgain = false;
      for (let next = STEP.full; next <= LAST_STEP; next++) {
        step.value = next;
        await nextTick();
        if (!overflows()) break;
      }
    } while (fitAgain);
  } finally {
    fitting = false;
  }
};

let observer: ResizeObserver | null = null;
onMounted(() => {
  void refit();
  if (typeof ResizeObserver !== "undefined" && rowRef.value) {
    observer = new ResizeObserver(() => void refit());
    observer.observe(rowRef.value);
  }
  // Web fonts change text widths after the first measure.
  void document.fonts?.ready.then(() => refit());
});
onBeforeUnmount(() => observer?.disconnect());

watch(
  () => [
    chips.value.map((chip) => chip.text).join("|"),
    props.title,
    props.position,
    props.timeRangeLabel,
    props.slides.length,
  ],
  () => void refit(),
);
</script>
