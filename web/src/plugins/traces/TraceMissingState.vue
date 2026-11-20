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
  <OEmptyState
    v-if="kind === 'error'"
    kind="error"
    :title="t('traces.traceDetails.loadFailedTitle')"
    :text="t('traces.traceDetails.loadFailedText', { traceId: shortTraceId })"
    data-test="trace-details-load-error"
    @action="emit('retry')"
  />
  <OEmptyState
    v-else
    kind="filtered"
    icon="search-off"
    :title="t('traces.traceDetails.notFoundTitle', bounds)"
    :text="t('traces.traceDetails.notFoundText', { traceId: shortTraceId, stream: raw(stream) })"
    :action-label="canWiden ? t('traces.traceDetails.searchWiderRange') : undefined"
    :on-action="canWiden ? () => emit('widen') : undefined"
    :secondary-action-label="t('traces.traceDetails.searchSpansInRange')"
    data-test="trace-details-not-found"
    @secondary-action="emit('search-range')"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "vuex";
import { raw, useI18nTyped } from "@/types/i18n";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import { timestampToTimezoneDate } from "@/utils/timezone";

const props = defineProps<{
  kind: "not-found" | "error";
  traceId: string;
  stream: string;
  /** The searched window, in microseconds. */
  from: number;
  to: number;
  canWiden: boolean;
}>();

const emit = defineEmits<{ widen: []; "search-range": []; retry: [] }>();

const { t } = useI18nTyped();
const store = useStore();

const shortTraceId = computed(() =>
  raw(props.traceId.length > 16 ? `${props.traceId.slice(0, 16)}…` : props.traceId),
);

// Minute precision (W4); the end drops its date when both ends share one.
const bounds = computed(() => {
  const zone = store.state.timezone || "UTC";
  const day = (us: number) => timestampToTimezoneDate(us / 1000, zone, "yyyy-MM-dd");
  const time = (us: number) => timestampToTimezoneDate(us / 1000, zone, "HH:mm");
  const sameDay = day(props.from) === day(props.to);
  return {
    from: raw(`${day(props.from)} ${time(props.from)}`),
    to: raw(sameDay ? time(props.to) : `${day(props.to)} ${time(props.to)}`),
  };
});
</script>
