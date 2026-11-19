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
    role="listitem"
    class="rounded-default flex cursor-pointer items-start gap-2 border px-2.5 py-2"
    :class="
      selected
        ? 'border-accent ring-accent/40 ring-2'
        : 'hover:bg-surface-subtle border-transparent'
    "
    :data-entry-id="entry.id"
    :data-test="`alert-starter-library-row-${entry.id}`"
    @click="activate"
  >
    <OCheckbox
      size="sm"
      class="mt-0.5 shrink-0"
      :model-value="selected"
      :aria-label="t('alert_library.selectAlert', { title: entry.title })"
      :data-test="`alert-starter-library-row-select-${entry.id}`"
      @click.stop
      @update:model-value="emit('update:selected', $event === true)"
    />
    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2">
        <button
          type="button"
          class="text-text-heading focus-visible:ring-accent/40 rounded-default min-w-0 flex-1 cursor-pointer text-left text-sm leading-snug font-medium outline-none focus-visible:ring-2"
          :data-test="`alert-starter-library-row-open-${entry.id}`"
          @click.stop="activate"
        >
          {{ entry.title }}
        </button>
        <OTag
          type="severity"
          :value="severityBadgeValue(entry.severity)"
          :label="severityLabel(t, entry.severity)"
          class="shrink-0"
        />
      </div>
      <div
        class="text-text-secondary mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs"
      >
        <OTag variant="default-soft" size="xs" :label="queryLabel" />
        <span class="text-text-body font-mono break-all">{{ entry.stream }}</span>
        <span v-if="streamTypeText">{{ streamTypeText }}</span>
        <template v-if="summary">
          <span v-if="summary.per.length">{{ perText }}</span>
          <span class="text-text-body">{{ summary.condition }}</span>
        </template>
        <OSkeleton
          v-else-if="summaryPending"
          animation="none"
          class="h-3 w-24"
          :aria-label="t('alertStarter.library.loading')"
        />
        <template v-if="own.length">
          <OTag
            variant="default-outline"
            size="xs"
            :label="t('alertStarter.library.youHave', { count: own.length }, own.length)"
            :data-test="`alert-starter-library-row-own-${entry.id}`"
          />
          <ODropdown>
            <template #trigger>
              <OButton
                variant="ghost-primary"
                size="xs"
                :data-test="`alert-starter-library-row-own-open-${entry.id}`"
                @click.stop
              >
                {{ t("alertStarter.library.openOwn") }}
              </OButton>
            </template>
            <ODropdownItem
              v-for="alert in own"
              :key="alert.alert_id"
              :data-test="`alert-starter-library-row-own-item-${alert.alert_id}`"
              @select="emit('open-existing', alert.alert_id)"
            >
              {{ alert.name }}
            </ODropdownItem>
          </ODropdown>
        </template>
        <OSkeleton
          v-else-if="verdict === 'pending'"
          animation="none"
          class="h-3 w-32"
          :aria-label="t('alertStarter.library.loading')"
        />
        <span
          v-else-if="verdictText"
          :data-test="`alert-starter-library-row-verdict-${entry.id}`"
          >{{ verdictText }}</span
        >
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import {
  queryTypeLabel,
  severityBadgeValue,
  severityLabel,
} from "@/components/alertLibrary/libraryFacets";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OCheckbox from "@/lib/forms/Checkbox/OCheckbox.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { AlertLibraryEntry } from "@/types/alertLibrary";
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import { joinList } from "@/utils/alerts/alertCopy";
import type { AlreadySetUp } from "@/utils/alerts/librarySuggest.types";

import type { DryRunVerdict } from "./libraryPaneData";

const props = defineProps<{
  entry: AlertLibraryEntry;
  selected: boolean;
  /** False for an alert the form cannot open prefilled: a click ticks it instead. */
  openable: boolean;
  summary: { per: string[]; condition: string } | null;
  summaryPending: boolean;
  /** `null`: no dry run for this row, so nothing is said. */
  verdict: DryRunVerdict | "pending" | null;
  own: AlreadySetUp[];
}>();

const emit = defineEmits<{
  (e: "open"): void;
  (e: "update:selected", value: boolean): void;
  (e: "open-existing", alertId: string): void;
}>();

const { t } = useI18nTyped();

const STREAM_TYPE_LABEL: Record<string, I18nKey> = {
  logs: "common.logs",
  metrics: "common.metrics",
  traces: "common.traces",
};

const activate = () => {
  if (props.openable) emit("open");
  else emit("update:selected", !props.selected);
};

const queryLabel = computed(() =>
  props.entry.query_type === "promql" || props.entry.query_type === "sql"
    ? queryTypeLabel(props.entry.query_type)
    : t("alertStarter.library.queryFilters"),
);

const streamTypeText = computed(() =>
  Object.hasOwn(STREAM_TYPE_LABEL, props.entry.stream_type)
    ? t(STREAM_TYPE_LABEL[props.entry.stream_type])
    : null,
);

const perText = computed(() =>
  t("alertStarter.library.per", { labels: joinList(props.summary?.per ?? []) }),
);

const verdictText = computed(() => {
  const verdict = props.verdict;
  if (!verdict || verdict === "pending" || verdict.state === "none") return null;
  if (verdict.state === "quiet") return t("alertStarter.library.quiet");
  if (verdict.groups > 1) {
    return t("alertStarter.library.firedGroups", { count: verdict.groups }, verdict.groups);
  }
  return t("alertStarter.library.firedTimes", { count: verdict.count }, verdict.count);
});
</script>
