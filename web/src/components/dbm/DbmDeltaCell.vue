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
  DbmDeltaCell — window-over-window change, as a first-class column.

  At 2am the absolute p95 of a query you have never seen before means nothing;
  only its delta means anything. So this is a column, not a detail-page chart.

  The cell renders THREE states, and keeping them apart is the entire job:

    • changed — a real comparison, signed percentage + both numbers on hover.
    • new     — absent from the previous window. There is NO percentage,
                because there is nothing to divide by. Rendering this as -100%
                (the obvious bug) turns "this query just appeared" into "this
                query collapsed" — the opposite reading, at the worst moment.
    • gone    — present before, absent now. Shown rather than dropped, so a
                query that stopped running is visible.

  Colour follows the calm-signal rule: only a RISE in a cost metric is tinted,
  because that is the actionable direction. An improvement stays quiet.
-->
<template>
  <span
    class="text-3xs flex items-center justify-end gap-1 font-mono tabular-nums"
    :data-test="dataTest"
    :title="hoverTitle"
  >
    <!-- `words` and `was` say the change the way a person would — "5× more",
         "was 98ms", "no change" — because a signed percentage makes the reader
         do the arithmetic to know whether +567% matters. `percent` keeps the
         signed form for a column where the exact magnitude is the point. -->
    <template v-if="variant !== 'percent'">
      <span :class="toneClass">{{ wordedChange }}</span>
    </template>

    <template v-else-if="delta.state === 'changed' && delta.ratio !== undefined">
      <OIcon v-if="direction" :name="direction" size="xs" :class="toneClass" />
      <span :class="toneClass">{{ formatSignedPercent(delta.ratio) }}</span>
    </template>

    <!-- Not a number: a state. Chips, so they never read as a measurement. -->
    <OTag
      v-else-if="delta.state === 'new'"
      type="dbmDelta"
      value="new"
      :label="t('dbm.delta.new')"
    />
    <OTag
      v-else-if="delta.state === 'gone'"
      type="dbmDelta"
      value="gone"
      :label="t('dbm.delta.gone')"
    />
    <!-- A `changed` delta with no ratio: the previous window was zero, so a
         percentage would be a division by zero rather than an infinite rise. -->
    <span v-else class="text-text-muted">{{ raw("—") }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import OTag from "@/lib/core/Badge/OTag.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import type { DbmDelta } from "@/utils/dbm/insights";
import { formatSignedPercent } from "@/utils/dbm/format";

const props = withDefaults(
  defineProps<{
    delta: DbmDelta;
    /**
     * How to colour a rise. `cost` (default) tints an increase as bad — it is
     * more latency, more time, more errors. `neutral` never tints, for a
     * metric where up is not worse.
     */
    semantics?: "cost" | "neutral";
    /**
     * How to SAY the change.
     *   `percent` — signed percentage (+42%), for a dedicated change column.
     *   `words`   — "5× more" / "no change", under a count.
     *   `was`     — "was 98ms", under a duration: the previous VALUE is more
     *               use than the ratio when the reader is judging a speed.
     */
    variant?: "percent" | "words" | "was";
    /** Pre-formatted current/previous values for the hover title. */
    currentLabel?: string;
    previousLabel?: string;
    dataTest?: string;
  }>(),
  { semantics: "cost", variant: "percent" },
);

const { t } = useI18nTyped();

/** Below this a change is noise dressed as signal, so it stays grey. */
const MEANINGFUL_CHANGE = 0.05;

const direction = computed<IconName | undefined>(() => {
  const ratio = props.delta.ratio;
  if (ratio === undefined || Math.abs(ratio) < MEANINGFUL_CHANGE) return undefined;
  return ratio > 0 ? "arrow-upward" : "arrow-downward";
});

const toneClass = computed(() => {
  const ratio = props.delta.ratio;
  if (ratio === undefined || Math.abs(ratio) < MEANINGFUL_CHANGE) return "text-text-muted";
  if (props.semantics === "neutral") return "text-text-body";
  // Only the actionable direction is coloured. An improvement is good news and
  // good news does not need to shout on a monitoring screen.
  return ratio > 0 ? "text-status-error-text" : "text-status-success-text";
});

/**
 * The change as a phrase.
 *
 * A ratio below the noise floor says "no change" EXPLICITLY rather than
 * rendering blank: a blank cell reads as missing data, and on this table the
 * difference between "this query is steady" and "we don't know" is the whole
 * question. `was {value}` is used under durations, where the previous speed is
 * what the reader wants; multiples are used under counts, where "5× more"
 * lands faster than "+400%".
 */
const wordedChange = computed<I18nText>(() => {
  const { state, ratio, previous } = props.delta;

  // `new`/`gone` are facts about the ROW, not about this metric, and the row
  // already carries them as a chip. Repeating "new to this list" under every
  // number on a new row states it three times and reads as if the CALL COUNT
  // were new. So the sub-line goes quiet and lets the chip speak once.
  if (state === "new" || state === "gone") return raw("");
  if (ratio === undefined || Math.abs(ratio) < MEANINGFUL_CHANGE) return t("dbm.delta.noChange");

  if (props.variant === "was") {
    return t("dbm.delta.wasValue", {
      value: props.previousLabel ?? String(previous ?? ""),
    });
  }

  // A multiple reads better than a percentage once the change is large; below
  // a doubling, the percentage is the more precise phrasing.
  const factor = 1 + ratio;
  if (factor >= 2) return t("dbm.delta.timesMore", { ratio: trimFactor(factor) });
  if (factor > 0 && factor <= 0.5)
    return t("dbm.delta.timesFewer", { ratio: trimFactor(1 / factor) });
  return raw(formatSignedPercent(ratio));
});

/**
 * `5` rather than `5.0`, `1.5` rather than `1.53`.
 *
 * The integer test is on the ROUNDED-to-1dp value, not the raw one: these
 * factors are reciprocals of a ratio, so a clean 5× arrives as 4.999999999 and
 * `Number.isInteger` rejects it — printing "5.0× fewer", which reads as a
 * measurement precise to a tenth when it is exactly five.
 */
const trimFactor = (value: number): string => {
  const oneDp = Math.round(value * 10) / 10;
  return value >= 10 || Number.isInteger(oneDp) ? String(Math.round(value)) : oneDp.toFixed(1);
};

const hoverTitle = computed(() => {
  if (props.delta.state === "new") return t("dbm.delta.newHint");
  if (props.delta.state === "gone") return t("dbm.delta.goneHint");
  if (props.currentLabel && props.previousLabel) {
    return t("dbm.delta.comparison", {
      previous: props.previousLabel,
      current: props.currentLabel,
    });
  }
  return undefined;
});
</script>
