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
  <section
    :aria-labelledby="headingId"
    class="flex min-w-0 flex-col gap-2"
    data-test="agent-home-since"
  >
    <div class="flex min-h-8 items-baseline justify-between gap-2 ps-1">
      <h2 :id="headingId" class="text-text-heading text-base font-semibold">
        {{ t("home.agent.since.title") }}
      </h2>
      <OText variant="meta" :title="sinceTitle" data-test="agent-home-since-at">{{
        sinceLabel
      }}</OText>
    </div>
    <ul
      class="border-border-default rounded-surface bg-surface-panel flex flex-col overflow-hidden border border-[0.0625em]"
    >
      <li
        v-for="item in items"
        :key="item.key"
        class="border-b-border-default border-b-[0.0625em] last:border-b-0"
      >
        <OButton
          variant="ghost"
          size="sm"
          block
          class="h-auto! min-h-10 justify-start! gap-2 px-3! py-2! text-start font-normal"
          :data-test="`agent-home-since-${item.kind}`"
          @click="emit('open', item)"
        >
          <OIcon :name="ICONS[item.kind]" size="sm" class="text-text-secondary shrink-0" />
          <span class="text-text-body min-w-0 flex-1 text-sm whitespace-normal">{{
            t(`home.agent.since.${item.kind}`, { title: raw(item.title) })
          }}</span>
          <OText variant="meta" class="shrink-0">{{ timeOf(item.at) }}</OText>
        </OButton>
      </li>
      <li
        v-if="since === null"
        class="text-text-secondary px-3 py-3 text-sm"
        data-test="agent-home-since-first-visit"
      >
        {{ t("home.agent.since.firstVisit") }}
      </li>
      <li
        v-else-if="items.length === 0"
        class="text-text-secondary px-3 py-3 text-sm"
        data-test="agent-home-since-none"
      >
        {{ t("home.agent.since.none") }}
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatTimestampInTimezone } from "@/utils/date";
import { formatRelativeCompact } from "@/utils/formatters";

import type { SinceItem, SinceKind } from "./sinceLastVisit";

const ICONS: Record<SinceKind, string> = {
  incident_opened: "warning",
  incident_resolved: "check-circle-outline",
  alert_fired: "notifications",
  thread_finished: assistantGlyph.assistant,
  thread_stopped: assistantGlyph.stopped,
  thread_failed: assistantGlyph.failed,
  thread_updated: assistantGlyph.assistant,
  approval_waiting: "lock",
};

const props = defineProps<{
  /** Milliseconds; null on the first visit, which shows the first-visit line. */
  since: number | null;
  items: SinceItem[];
  timezone: string;
}>();

const emit = defineEmits<{ open: [item: SinceItem] }>();

const { t } = useI18nTyped();
const headingId = `agent-home-since-${useId()}`;

const sinceLabel = computed(() =>
  props.since
    ? t("home.agent.since.ago", { time: raw(formatRelativeCompact(props.since)) })
    : t("home.agent.since.firstVisitAt"),
);
const sinceTitle = computed(() =>
  props.since
    ? formatTimestampInTimezone(props.since * 1000, "YYYY-MM-DD HH:mm", props.timezone)
    : undefined,
);

function timeOf(at: number) {
  return raw(formatTimestampInTimezone(at * 1000, "HH:mm", props.timezone));
}
</script>
