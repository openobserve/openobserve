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
    class="mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 pt-6 pb-16 @min-[60rem]:px-6"
    data-test="autoobserve2-activity-page"
  >
    <header
      class="border-border-subtle rounded-surface from-ai-accent/15 via-surface-base to-ingest-accent-teal/15 dark:from-ai-accent/25 dark:via-surface-base dark:to-ingest-accent-teal/20 flex flex-col gap-5 border bg-linear-to-br px-4 pt-3 pb-5 shadow-xs sm:px-6 sm:pb-6"
    >
      <OButton
        variant="ghost"
        size="xs"
        icon-left="arrow-back"
        class="-ms-2 self-start"
        data-test="autoobserve2-activity-back"
        @click="emit('back')"
      >
        {{ t("autoobserve2.coveragePage.back") }}
      </OButton>
      <div class="flex flex-col gap-1.5">
        <h1
          class="text-text-heading text-2xl leading-tight font-semibold tracking-tight sm:text-3xl"
          data-test="autoobserve2-activity-title"
        >
          {{ t("autoobserve2.activityPage.title") }}
        </h1>
        <p class="text-text-body flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {{ t("autoobserve2.activityPage.stats.window") }}
        </p>
      </div>
      <dl
        v-if="changes.length"
        class="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4"
        data-test="autoobserve2-activity-stats"
      >
        <div
          v-for="stat in statFigures"
          :key="stat.id"
          class="flex flex-col-reverse gap-1"
          :data-test="`autoobserve2-activity-stat-${stat.id}`"
        >
          <dt class="text-text-body flex items-center gap-1.5 text-xs font-medium">
            <OIcon :name="stat.icon" size="xs" aria-hidden="true" />
            {{ stat.label }}
          </dt>
          <dd
            class="text-3xl leading-none font-semibold tracking-tight tabular-nums"
            :class="
              stat.id === 'worked' && stat.value
                ? 'from-badge-success-soft-text to-badge-teal-soft-text bg-linear-to-br bg-clip-text text-transparent'
                : 'text-text-heading'
            "
          >
            {{ stat.value }}
          </dd>
        </div>
      </dl>
    </header>

    <p
      v-if="!changes.length"
      class="text-text-secondary bg-surface-base border-border-subtle rounded-surface border px-5 py-6 text-sm shadow-xs"
      data-test="autoobserve2-activity-empty"
    >
      {{ t("autoobserve2.activityPage.empty.scenario") }}
    </p>
    <template v-else>
      <OToggleGroup
        :model-value="filter"
        mobile-dropdown
        class="rounded-full!"
        data-test="autoobserve2-activity-filter"
        @update:model-value="(v) => v && (filter = v as ChangeFilter)"
      >
        <OToggleGroupItem
          v-for="f in CHANGE_FILTERS"
          :key="f"
          :value="f"
          size="sm"
          class="rounded-full! px-3!"
          :data-test="`autoobserve2-activity-filter-${f}`"
        >
          <span
            v-if="FILTER_DOT[f]"
            class="size-1.5 shrink-0 rounded-full"
            :class="FILTER_DOT[f]"
            aria-hidden="true"
          />
          {{ t(FILTER_LABEL[f]) }}
          <span class="font-semibold tabular-nums">{{ counts[f] }}</span>
        </OToggleGroupItem>
      </OToggleGroup>

      <div v-if="dayGroups.length" class="relative flex flex-col gap-8">
        <span
          class="from-ai-accent/60 via-border-default to-border-subtle/0 absolute start-4.5 top-4 bottom-0 w-px bg-linear-to-b sm:start-5"
          aria-hidden="true"
        />
        <section
          v-for="group in dayGroups"
          :key="group.day"
          class="relative flex flex-col gap-3"
          :data-test="`autoobserve2-activity-day-${group.day}`"
        >
          <h2
            class="bg-surface-base border-border-subtle text-text-secondary sticky top-2 z-20 self-start rounded-full border px-3 py-1 text-xs font-semibold tracking-wider uppercase shadow-xs"
          >
            {{ t(DAY_LABEL[group.day]) }}
          </h2>
          <ul class="flex flex-col gap-3">
            <li v-for="change in group.changes" :key="change.entry.id">
              <ChangeRow
                v-bind="rowProps(change)"
                :when="change.time ? raw(change.time) : undefined"
                @update:open="(v) => setOpen(change.entry.id, v)"
                @undo="undo(change)"
              />
            </li>
          </ul>
        </section>
      </div>

      <p
        v-if="!dayGroups.length"
        class="text-text-secondary py-6 text-center text-sm"
        data-test="autoobserve2-activity-filter-empty"
      >
        {{ t("autoobserve2.activityPage.empty.filter") }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import type { DayKey } from "../data/facts";
import type { LedgerEntry } from "../fixtures";
import ChangeRow from "./ChangeRow.vue";
import { useDecisions } from "./useDecisions";
import { DAY_LABEL, type Scenario } from "./fixtures";
import {
  CHANGE_FILTERS,
  FILTER_DOT,
  FILTER_LABEL,
  byNewest,
  filterOf,
  toChanges,
  trustCounts,
  type Change,
  type ChangeFilter,
} from "./changes";

const props = defineProps<{ ledger: LedgerEntry[]; scenario: Scenario; highlightId?: string }>();

const emit = defineEmits<{
  back: [];
  "update-entry": [id: string, patch: Partial<LedgerEntry>];
}>();

const { t } = useI18nTyped();
const store = useDecisions();

const filter = ref<ChangeFilter>("all");
const opened = reactive<Record<string, boolean>>({});
const flashId = ref<string | null>(null);

const changes = computed(() => toChanges(props.ledger, store.phases).sort(byNewest));
const matches = (change: Change, f: ChangeFilter) => f === "all" || filterOf(change.kind) === f;

const dayGroups = computed(() => {
  const groups: { day: DayKey; changes: Change[] }[] = [];
  changes.value
    .filter((c) => matches(c, filter.value))
    .forEach((c) => {
      const last = groups[groups.length - 1];
      if (last?.day === c.day) last.changes.push(c);
      else groups.push({ day: c.day, changes: [c] });
    });
  return groups;
});

const counts = computed(() =>
  Object.fromEntries(
    CHANGE_FILTERS.map((f) => [f, changes.value.filter((c) => matches(c, f)).length]),
  ),
);

// Applying is a fix seconds from being judged, so it counts with the changes still in review.
const stats = computed(() => trustCounts(changes.value));

const statFigures = computed(() => {
  const n = stats.value;
  const figures: { id: string; icon: IconName; value: number; label: I18nText }[] = [
    {
      id: "made",
      icon: "history",
      value: n.made,
      label: t("autoobserve2.activityPage.stats.made", { count: n.made }, n.made),
    },
    {
      id: "worked",
      icon: "check-circle",
      value: n.worked,
      label: t("autoobserve2.activityPage.stats.worked"),
    },
    {
      id: "review",
      icon: "schedule",
      value: n.review + n.applying,
      label: t("autoobserve2.activityPage.stats.review"),
    },
    {
      id: "undone",
      icon: "undo",
      value: n.undone,
      label: t("autoobserve2.activityPage.stats.undone"),
    },
  ];
  return figures;
});

const rowProps = (change: Change) => ({
  change,
  open: !!opened[change.entry.id],
  flash: flashId.value === change.entry.id,
});

const setOpen = (id: string, open: boolean) => {
  opened[id] = open;
};

const undo = (change: Change) => {
  const decided = !!change.entry.decided;
  emit(
    "update-entry",
    change.entry.id,
    decided
      ? { status: "awaiting" }
      : { status: "rolled_back", note: t("autoobserve.activity.undoneNote") },
  );
  toast({
    variant: "success",
    message: decided
      ? t("autoobserve2.activityPage.toast.undoDecided")
      : t("autoobserve2.activityPage.toast.undone"),
  });
};

let flashTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(async () => {
  const id = props.highlightId;
  if (!id || !changes.value.some((c) => c.entry.id === id)) return;
  opened[id] = true;
  await nextTick();
  document
    .querySelector(`[data-test="autoobserve2-change-${id}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
  flashId.value = id;
  flashTimer = setTimeout(() => (flashId.value = null), 2500);
});

onBeforeUnmount(() => {
  clearTimeout(flashTimer);
});
</script>
