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
      v-if="previewError"
      class="text-status-error-text text-xs"
      data-test="oncall-schedule-preview-error"
    >
      {{ previewError }}
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

    <!-- An empty preview is the most common state of a NEW rule, and saying
         why beats showing nothing. -->
    <OText
      v-else-if="!hasValidRule || preview.isSuccess.value"
      variant="meta"
      data-test="oncall-schedule-preview-empty"
    >
      {{ t("oncall.rotationPreviewEmpty") }}
    </OText>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useStore } from "vuex";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import { debounce } from "lodash-es";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OUserCell from "@/lib/core/Table/cells/OUserCell.vue";
import { resolvedSchedulePreviewQuery } from "@/services/oncall.queries";
import type { ResolvedSegment, Rotation } from "@/ts/interfaces/oncall";
import { formatInZone, isShiftRuleValid, zonedMidnight } from "@/utils/oncall";
import type { I18nText } from "@/types/i18n";
import { raw, useI18nTyped } from "@/types/i18n";

const PREVIEW_ROWS = 10;
const PREVIEW_DAYS = 14;
const PREVIEW_DEBOUNCE_MS = 400;

const props = defineProps<{
  /** The rotation being edited, saved or not. */
  rotation: Rotation;
  teamId: string;
  /** "Now", shared with the caller so every rule's list agrees on when "now" is. */
  nowMicros: number;
  /** The team's zone: the window starts at its midnight and times are shown in it. */
  timezone: string;
}>();

const { t } = useI18nTyped();
const store = useStore();
const orgId = computed<string>(() => store.state.selectedOrganization.identifier);

// A plain copy, so the query key is the draft as it stood rather than a live proxy.
const snapshot = (): Rotation => JSON.parse(JSON.stringify(props.rotation));
const draft = ref<Rotation>(snapshot());
const settle = debounce(() => {
  draft.value = snapshot();
}, PREVIEW_DEBOUNCE_MS);
watch(() => props.rotation, settle, { deep: true });
onBeforeUnmount(() => settle.cancel());

const windowFrom = computed(() => zonedMidnight(props.nowMicros, props.timezone));
const windowTo = computed(() => zonedMidnight(props.nowMicros, props.timezone, PREVIEW_DAYS));

// Nobody to put on call yet: the hint says what is missing, and there is nothing to ask the server.
const hasValidRule = computed(() => draft.value.shift_rules.some(isShiftRuleValid));

const preview = useQuery(() =>
  Object.assign(
    resolvedSchedulePreviewQuery(
      orgId.value,
      props.teamId,
      draft.value,
      windowFrom.value,
      windowTo.value,
    ),
    {
      enabled: !!orgId.value && !!props.teamId && hasValidRule.value,
      placeholderData: keepPreviousData,
    },
  ),
);

const multiRule = computed(() => props.rotation.shift_rules.length > 1);

const rows = computed<ResolvedSegment[]>(() =>
  hasValidRule.value
    ? (preview.data.value ?? [])
        .filter((segment) => segment.to > props.nowMicros)
        .slice(0, PREVIEW_ROWS)
    : [],
);

const previewError = computed<I18nText | null>(() => {
  const err: any = preview.error.value;
  if (!err || !hasValidRule.value) return null;
  const message = err?.response?.data?.message;
  return message ? raw(String(message)) : t("oncall.upcomingPreviewFailed");
});

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
  const openStart = segment.from <= windowFrom.value;
  const openEnd = segment.to >= windowTo.value;
  if (openStart && openEnd) return t("oncall.upcomingNoChange");
  if (openStart) return t("oncall.upcomingUntil", { end });
  if (openEnd) return t("oncall.upcomingFrom", { start });
  return raw(`${start} — ${end}`);
}
</script>
