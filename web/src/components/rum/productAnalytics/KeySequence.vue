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
  <span class="flex min-w-0 flex-wrap items-center gap-1" data-test="rum-analytics-key-sequence">
    <template v-for="(item, i) in shown" :key="i">
      <OIcon v-if="i > 0" name="arrow-forward" size="xs" class="text-text-secondary shrink-0" />
      <span
        class="rounded-default max-w-60 truncate px-1 font-mono text-xs"
        :class="
          item.kind === 'c'
            ? 'bg-badge-teal-soft-bg text-badge-teal-soft-text'
            : item.kind === 'e'
              ? 'bg-badge-purple-soft-bg text-badge-purple-soft-text'
              : item.kind === 'p'
                ? 'bg-badge-blue-soft-bg text-badge-blue-soft-text'
                : 'text-text-secondary'
        "
        >{{ item.label }}<OTooltip :content="raw(item.label)"
      /></span>
    </template>
    <span v-if="hidden > 0" class="text-text-secondary text-xs">{{
      t("rum.analytics.moreKeys", { count: hidden })
    }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";
import type { StepKind } from "@/utils/rum/productAnalyticsQueries";

const props = withDefaults(
  defineProps<{
    keys: { kind: StepKind | "exit" | "start" | "other"; key: string }[];
    events?: NamedEvent[];
    /** A ready events list proves an unknown event id was deleted, so it is labelled as such. */
    eventsReady?: boolean;
    max?: number;
    more?: number;
  }>(),
  { events: () => [], eventsReady: false, max: 8, more: 0 },
);
const { t } = useI18nTyped();

const eventLabel = (id: string): string =>
  props.events.find((e) => e.id === id)?.name ??
  (props.eventsReady ? t("rum.analytics.funnel.deletedEvent") : id);

const shown = computed(() =>
  props.keys.slice(0, props.max).map((k) => ({
    kind: k.kind,
    label: k.kind === "e" ? eventLabel(k.key) : k.key,
  })),
);

const hidden = computed(() => Math.max(0, props.keys.length - props.max) + props.more);
</script>
