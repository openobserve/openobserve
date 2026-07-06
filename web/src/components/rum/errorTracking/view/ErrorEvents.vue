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
  <section class="tw:mt-4">
    <h4 data-test="error-events-title" class="tw:mb-2 tw:ml-1">
      {{ t("rum.events") }}
    </h4>

    <div
      v-if="!timelineEvents.length"
      data-test="error-events-empty"
    >
      <NoData />
    </div>

    <ol
      v-else
      class="event-timeline tw:list-none tw:m-0 tw:p-0"
      data-test="error-events-timeline"
    >
      <li
        v-for="(event, index) in timelineEvents"
        :key="index"
        class="event-timeline__item tw:relative tw:flex tw:items-start tw:gap-2 tw:pl-5 tw:pb-3"
        :class="{ 'event-timeline__item--error': isErrorEvent(event) }"
        :data-test="`error-events-timeline-item-${index}`"
      >
        <span
          class="event-timeline__dot"
          :class="
            isErrorEvent(event)
              ? 'event-timeline__dot--error'
              : 'event-timeline__dot--default'
          "
          aria-hidden="true"
        />
        <ErrorTypeIcons :column="event" class="tw:shrink-0 tw:mt-0.5" />
        <div class="tw:flex-1 tw:min-w-0">
          <div class="tw:flex tw:items-baseline tw:gap-1.5 tw:flex-wrap">
            <span
              class="tw:font-medium"
              :data-test="`error-events-timeline-category-${index}`"
            >{{ getErrorCategory(event) }}</span>
            <OTag
              v-if="isErrorEvent(event)"
              :label="t('rum.error')"
              variant="error-soft"
              size="xs"
              :data-test="`error-events-timeline-level-${index}`"
            />
          </div>
          <ErrorEventDescription :column="event" />
        </div>
        <div class="tw:shrink-0 tw:text-right">
          <span
            class="tw:tabular-nums tw:text-[var(--o2-text-secondary)]"
            :data-test="`error-events-timeline-offset-${index}`"
            :title="getFormattedDate(event._timestamp / 1000)"
          >{{ offsetLabel(event) }}</span>
        </div>
      </li>
    </ol>
  </section>
</template>

<script setup lang="ts">
import NoData from "@/components/shared/grid/NoData.vue";
import { computed } from "vue";
import ErrorEventDescription from "@/components/rum/errorTracking/view/ErrorEventDescription.vue";
import { formatDate } from "@/utils/date";
import { formatTimeWithSuffix } from "@/utils/formatters";
import ErrorTypeIcons from "./ErrorTypeIcons.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18n } from "vue-i18n";

const props = defineProps({
  error: {
    type: Object,
    required: true,
  },
});

const { t } = useI18n();

const timelineEvents = computed<any[]>(() => props.error.events || []);

/** The failure itself gets the highlighted marker on the rail. */
const isErrorEvent = (event: any) =>
  event.type === "error" && event.error_id === props.error.error_id;

const getErrorCategory = (row: any) => {
  if (row["type"] === "error") return row["error_type"] || "Error";
  else if (row["type"] === "resource") return row["resource_type"];
  else if (row["type"] === "view")
    return row["view_loading_type"] === "route_change"
      ? "Navigation"
      : "Reload";
  else if (row["type"] === "action") return row["action_type"];
  else return row["type"];
};

/** Offset from the failure moment; the error row anchors the timeline. */
const offsetLabel = (event: any) => {
  const base = Number(props.error._timestamp) || 0;
  const delta = (Number(event._timestamp) || 0) - base;
  if (!base || Math.abs(delta) < 1000) return "0ms";
  const sign = delta > 0 ? "+" : "−";
  return `${sign}${formatTimeWithSuffix(Math.abs(delta))}`;
};

const getFormattedDate = (timestamp: number) =>
  formatDate(Math.floor(timestamp), "MMM DD, YYYY HH:mm:ss Z");
</script>

<style scoped lang="scss">
.event-timeline {
  position: relative;

  // Vertical rail connecting the dots.
  &::before {
    content: "";
    position: absolute;
    left: 0.4375rem;
    top: 0.25rem;
    bottom: 0.25rem;
    width: 1px;
    background: var(--o2-border-color);
  }
}

.event-timeline__dot {
  position: absolute;
  left: 0.1875rem;
  top: 0.3125rem;
  width: 0.5625rem;
  height: 0.5625rem;
  border-radius: 9999px;
  border: 1px solid var(--o2-border-color);

  &--default {
    background: var(--o2-card-bg, var(--o2-border-color));
  }

  &--error {
    background: var(--o2-severity-error-color);
    border-color: var(--o2-severity-error-color);
  }
}

.event-timeline__item--error {
  background: color-mix(
    in srgb,
    var(--o2-severity-error-color) 6%,
    transparent
  );
  border-radius: 0.375rem;
}
</style>
