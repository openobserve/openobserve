<!-- Copyright 2026 OpenObserve Inc. -->
<template>
  <div
    class="rounded-default border-border-default max-h-120 overflow-auto border font-mono text-xs leading-relaxed"
    :class="mode === 'split' ? 'grid grid-cols-2 max-md:grid-cols-1' : ''"
    :data-test="dataTest"
  >
    <div
      v-for="(lines, columnIndex) in columns"
      :key="columnIndex"
      class="border-border-default min-w-0 not-first:border-s max-md:not-first:border-s-0 max-md:not-first:border-t"
      :data-test="`${dataTest}-column-${columnIndex}`"
    >
      <div
        v-for="line in lines"
        :key="line.key"
        class="grid min-h-5 grid-cols-[2.5rem_1rem_minmax(0,1fr)]"
        :class="line.tone"
      >
        <span class="text-text-secondary pe-2 text-right select-none">{{ line.number }}</span>
        <span class="text-text-secondary select-none">{{ line.sign }}</span>
        <span class="min-w-0 pe-3 break-words whitespace-pre-wrap"
          ><span
            v-for="(segment, index) in line.segments"
            :key="index"
            :class="segment.changed ? line.wordTone : ''"
            >{{ segment.text }}</span
          ></span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import { raw, type I18nText } from "@/types/i18n";
import { diffLines, diffStats, type DiffRow, type DiffSegment } from "./textDiff";

export interface DiffStats {
  added: number;
  removed: number;
}

interface DisplayLine {
  key: string;
  number: number | "";
  sign: I18nText | "";
  tone: string;
  wordTone: string;
  segments: DiffSegment[];
}

const props = withDefaults(
  defineProps<{
    original: string;
    modified: string;
    /** Side-by-side columns, or one column with removed lines above added ones. */
    mode?: "split" | "unified";
    dataTest?: string;
  }>(),
  { mode: "split", dataTest: "diff-viewer" },
);
const emit = defineEmits<{ stats: [stats: DiffStats] }>();

const TONES = {
  left: {
    sign: raw("−"),
    tone: "bg-status-error-bg",
    wordTone: "bg-status-error-text/20 rounded-default",
  },
  right: {
    sign: raw("+"),
    tone: "bg-status-success-bg",
    wordTone: "bg-status-success-text/20 rounded-default",
  },
} as const;

function toLine(row: DiffRow, rowIndex: number, side: "left" | "right"): DisplayLine {
  const line = row[side];
  const key = `${rowIndex}-${side}`;
  // A changed row with nothing on this side is padding that keeps both columns aligned.
  if (!line)
    return { key, number: "", sign: "", tone: "bg-surface-subtle", wordTone: "", segments: [] };
  const style = TONES[side];
  return {
    key,
    number: line.lineNumber,
    sign: row.changed ? style.sign : "",
    tone: row.changed ? style.tone : "",
    wordTone: style.wordTone,
    segments: line.segments,
  };
}

const rows = computed(() => diffLines(props.original, props.modified));

const columns = computed<DisplayLine[][]>(() => {
  if (props.mode === "split")
    return [
      rows.value.map((row, index) => toLine(row, index, "left")),
      rows.value.map((row, index) => toLine(row, index, "right")),
    ];
  return [
    rows.value.flatMap((row, index) =>
      row.changed
        ? (["left", "right"] as const)
            .filter((side) => row[side])
            .map((side) => toLine(row, index, side))
        : [toLine(row, index, "right")],
    ),
  ];
});

const stats = computed(() => diffStats(rows.value));
watch(stats, (value) => emit("stats", value), { immediate: true });
</script>
