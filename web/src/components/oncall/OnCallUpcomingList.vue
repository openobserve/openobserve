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

<!-- Who holds the draft rotation, as the server will resolve it once saved: covers and absences included. -->
<template>
  <div>
    <p
      v-if="error"
      class="text-status-error-text text-xs"
      data-test="oncall-schedule-preview-error"
    >
      {{ error }}
    </p>

    <div
      v-else-if="rows.length"
      class="border-border-default divide-border-default rounded-default flex flex-col divide-y border"
    >
      <div
        v-for="segment in rows"
        :key="segment.from"
        class="flex flex-wrap items-center gap-3 px-3 py-1.5"
        :class="isCurrent(segment) ? 'bg-status-success-bg' : ''"
        :data-from="segment.from"
        :data-to="segment.to"
        :data-user="segment.user_email ?? ''"
        data-test="oncall-schedule-preview-shift"
      >
        <OText v-if="multiRule && segment.rotation" variant="label" class="shrink-0">
          {{ raw(segment.rotation) }}
        </OText>
        <OUserCell v-if="segment.user_email" :value="segment.user_email" />
        <OText v-else variant="meta" data-test="oncall-schedule-preview-nobody">
          {{ t("oncall.upcomingNobody") }}
        </OText>
        <OText variant="meta" class="ms-auto">{{ segmentRange(segment) }}</OText>
        <OTag v-if="isCurrent(segment)" variant="success-soft" size="xs">
          {{ t("oncall.onCallNowTag") }}
        </OTag>
      </div>
    </div>

    <!-- A new rule usually previews nothing yet, and saying why beats a blank. -->
    <OText v-else-if="showEmpty" variant="meta" data-test="oncall-schedule-preview-empty">
      {{ t("oncall.rotationPreviewEmpty") }}
    </OText>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import type { ResolvedSegment } from "@/ts/interfaces/oncall";
import { formatInZone } from "@/utils/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const PREVIEW_ROWS = 10;

const props = defineProps<{
  segments: ResolvedSegment[];
  windowFrom: number;
  windowTo: number;
  nowMicros: number;
  /** The team's zone: times are shown in it. */
  timezone: string;
  multiRule: boolean;
  error: I18nText | null;
  showEmpty: boolean;
}>();

const { t } = useI18nTyped();

const rows = computed<ResolvedSegment[]>(() =>
  props.segments.filter((segment) => segment.to > props.nowMicros).slice(0, PREVIEW_ROWS),
);

function isCurrent(segment: ResolvedSegment): boolean {
  return segment.from <= props.nowMicros && props.nowMicros < segment.to;
}

// The window's edges are where the fetch stopped, not handovers, so a segment touching one is open there.
function segmentRange(segment: ResolvedSegment): I18nText {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  const start = raw(formatInZone(segment.from, props.timezone, opts));
  const end = raw(formatInZone(segment.to, props.timezone, opts));
  const openStart = segment.from <= props.windowFrom;
  const openEnd = segment.to >= props.windowTo;
  if (openStart && openEnd) return t("oncall.upcomingNoChange");
  if (openStart) return t("oncall.upcomingUntil", { end });
  if (openEnd) return t("oncall.upcomingFrom", { start });
  return raw(`${start} — ${end}`);
}
</script>
