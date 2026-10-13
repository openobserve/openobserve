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
  <ODrawer
    :open="open"
    size="md"
    :title="t('autoobserve2.historyDrawer.title')"
    data-test="autoobserve2-history-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-4 pb-8">
      <OToggleGroup
        :model-value="filter"
        mobile-dropdown
        data-test="autoobserve2-history-filter"
        @update:model-value="(v) => v && (filter = v as Filter)"
      >
        <OToggleGroupItem
          v-for="f in FILTERS"
          :key="f.value"
          :value="f.value"
          size="xs"
          :data-test="`autoobserve2-history-filter-${f.value}`"
        >
          {{ t(f.label) }}
        </OToggleGroupItem>
      </OToggleGroup>

      <p v-if="!shown.length" class="text-text-secondary text-sm">
        {{ t("autoobserve2.historyDrawer.empty") }}
      </p>
      <ul v-else class="flex flex-col">
        <li
          v-for="entry in shown"
          :key="entry.id"
          class="border-border-subtle flex gap-3 border-b py-3 last:border-b-0"
          :data-test="`autoobserve2-history-${entry.id}`"
        >
          <span class="flex h-5 w-3 shrink-0 items-center justify-center">
            <OIcon
              v-if="entry.kind === 'decisions'"
              name="person"
              size="xs"
              class="text-text-secondary"
            />
            <span v-else class="size-2 rounded-full" :class="TONE_DOT[entry.tone]" />
          </span>
          <span class="flex min-w-0 flex-col gap-1">
            <span class="text-text-secondary text-xs tabular-nums">
              {{
                entry.time
                  ? t("autoobserve2.when", { day: t(entry.day), time: raw(entry.time) })
                  : t(entry.day)
              }}
            </span>
            <p class="text-text-body text-sm leading-relaxed text-pretty">
              {{ say(t, entry.text) }}
              <OTag
                v-if="entry.worked !== undefined"
                :variant="entry.worked ? 'success-soft' : 'warning-soft'"
                size="xs"
                class="ms-1 align-middle"
                :label="
                  entry.worked
                    ? t('autoobserve2.drawer.worked')
                    : t('autoobserve2.drawer.didntHelp')
                "
              />
            </p>
            <OButton
              v-if="entry.ledgerId && changeIds.has(entry.ledgerId)"
              variant="ghost-primary"
              size="xs"
              icon-right="arrow-forward"
              class="-ms-2 self-start"
              :data-test="`autoobserve2-history-${entry.id}-change`"
              @click="emit('open-change', entry.ledgerId)"
            >
              {{ t("autoobserve2.historyDrawer.seeChange") }}
            </OButton>
          </span>
        </li>
      </ul>
    </div>
  </ODrawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { raw, useI18nTyped, type I18nKey } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { say, type HistoryEntry, type HistoryKind, type HistoryTone } from "./fixtures";
import OIcon from "@/lib/core/Icon/OIcon.vue";

type Filter = HistoryKind | "all";

const props = defineProps<{
  open: boolean;
  entries: HistoryEntry[];
  changeIds: Set<string>;
}>();

const emit = defineEmits<{ "update:open": [value: boolean]; "open-change": [ledgerId: string] }>();

const { t } = useI18nTyped();

const FILTERS: { value: Filter; label: I18nKey }[] = [
  { value: "all", label: "autoobserve2.historyDrawer.filters.all" },
  { value: "problems", label: "autoobserve2.historyDrawer.filters.problems" },
  { value: "changes", label: "autoobserve2.historyDrawer.filters.changes" },
  { value: "fixes", label: "autoobserve2.historyDrawer.filters.fixes" },
  { value: "decisions", label: "autoobserve2.historyDrawer.filters.decisions" },
];

const TONE_DOT: Record<HistoryTone, string> = {
  active: "bg-status-error-text",
  fixed: "bg-accent",
  resolved: "bg-status-positive",
  held: "bg-border-strong",
  predicted: "bg-status-warning-text",
  neutral: "bg-border-strong",
  fix: "bg-accent",
};

const filter = ref<Filter>("all");

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) filter.value = "all";
  },
);

const shown = computed(() =>
  filter.value === "all" ? props.entries : props.entries.filter((e) => e.kind === filter.value),
);
</script>
