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
    :aria-busy="live.pending.value"
    data-test="autoobserve2-activity-page"
  >
    <div
      v-if="live.skeleton.value"
      class="flex flex-col gap-3"
      aria-hidden="true"
      data-test="autoobserve2-activity-skeleton"
    >
      <OSkeleton animation="none" class="rounded-surface h-24 w-full" />
      <OSkeleton v-for="n in 3" :key="n" animation="none" class="rounded-surface h-28 w-full" />
    </div>
    <LiveNoticeState
      v-else-if="live.notice.value"
      :notice="live.notice.value"
      size="block"
      :busy="live.busy.value"
      data-test="autoobserve2-activity-error"
      retry-test="autoobserve2-activity-retry"
      @retry="live.retry()"
    />
    <template v-else-if="!live.pending.value && changes.length">
      <header
        class="bg-surface-base border-border-subtle rounded-surface flex flex-col gap-5 border px-4 py-5 shadow-xs sm:px-6"
      >
        <dl class="grid grid-cols-3 gap-x-4 gap-y-4" data-test="autoobserve2-activity-stats">
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
              class="text-text-heading text-3xl leading-none font-semibold tracking-tight tabular-nums"
            >
              {{ stat.value }}
            </dd>
          </div>
        </dl>
      </header>

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
          :disabled="f !== 'all' && !counts[f]"
          :data-test="`autoobserve2-activity-filter-${f}`"
        >
          {{ t(FILTER_LABEL[f]) }}
          <span class="font-semibold tabular-nums">{{ counts[f] }}</span>
        </OToggleGroupItem>
      </OToggleGroup>

      <div v-if="groups.length" class="relative flex flex-col gap-8">
        <span
          class="from-ai-accent/60 via-border-default to-border-subtle/0 absolute start-4.5 top-4 bottom-0 w-px bg-linear-to-b sm:start-5"
          aria-hidden="true"
        />
        <section
          v-for="group in groups"
          :key="group.day"
          class="relative flex flex-col gap-3"
          :data-test="`autoobserve2-activity-day-${group.day}`"
        >
          <h2
            class="bg-surface-base border-border-subtle text-text-secondary sticky top-2 z-20 self-start rounded-full border px-3 py-1 text-xs font-semibold shadow-xs"
          >
            {{ dayLabel(t, live.zone.value, group.changes[0].at, live.now.value) }}
          </h2>
          <ul class="flex flex-col gap-3">
            <li v-for="change in group.changes" :key="change.id">
              <ChangeRow
                :change="change"
                :open="!!opened[change.id]"
                :flash="flashId === change.id"
                :actors="live.actorsOf(change)"
                :alert-href="live.alertHref(change)"
                :undoing="live.isUndoing(change)"
                @update:open="(v) => (opened[change.id] = v)"
                @undo="void live.undo(change)"
              />
            </li>
          </ul>
        </section>
        <OButton
          v-if="capped.more"
          variant="ghost-primary"
          size="sm"
          icon-right="expand-more"
          class="ms-10 self-start sm:ms-12"
          data-test="autoobserve2-activity-more"
          @click="showAll = true"
        >
          {{ t("autoobserve.activityLive.showMore", { count: capped.more }, capped.more) }}
        </OButton>
      </div>
      <p
        v-else
        class="text-text-secondary py-6 text-center text-sm"
        data-test="autoobserve2-activity-filter-empty"
      >
        {{ t("autoobserve2.activityPage.empty.filter") }}
      </p>
    </template>
    <div
      v-else-if="!live.pending.value"
      class="bg-surface-base border-border-subtle rounded-surface border py-6 shadow-xs"
      data-test="autoobserve2-activity-empty"
    >
      <LiveSurfaceEmpty surface="changes" @action="emit('see-suggestions')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import LiveNoticeState from "../live/LiveNoticeState.vue";
import LiveSurfaceEmpty from "../live/LiveSurfaceEmpty.vue";
import ChangeRow from "./ChangeRow.vue";
import {
  CHANGE_FILTERS,
  FILTER_LABEL,
  capList,
  changeCounts,
  dayGroups,
  dayLabel,
  matches,
  type ChangeFilter,
} from "./changes";
import { useLiveChanges } from "./useLiveChanges";

const props = defineProps<{ highlightId?: string }>();
const emit = defineEmits<{ "see-suggestions": [] }>();

const { t } = useI18nTyped();
const live = useLiveChanges();

const filter = ref<ChangeFilter>("all");
const opened = reactive<Record<string, boolean>>({});
const flashId = ref<string | null>(null);

const changes = computed(() => live.changes.value);
const counts = computed(() => changeCounts(changes.value));
const showAll = ref(false);
const capped = computed(() =>
  capList(
    changes.value.filter((c) => matches(c, filter.value)),
    showAll.value,
  ),
);
const groups = computed(() => dayGroups(capped.value.shown, "all"));

const statFigures = computed(() => {
  const n = counts.value;
  const figures: { id: string; icon: IconName; value: number; label: I18nText }[] = [
    {
      id: "made",
      icon: "history",
      value: n.all,
      label: t("autoobserve2.activityPage.stats.made", { count: n.all }, n.all),
    },
    {
      id: "inForce",
      icon: "check-circle",
      value: n.inForce,
      label: t("autoobserve.activityLive.stats.inForce"),
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

let flashTimer: ReturnType<typeof setTimeout> | undefined;

// A change opened by link is expanded and scrolled to once the list has loaded.
const highlight = async () => {
  const id = props.highlightId;
  if (!id || !changes.value.some((c) => c.id === id)) return;
  opened[id] = true;
  await nextTick();
  document
    .querySelector(`[data-test="autoobserve2-change-${id}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
  flashId.value = id;
  flashTimer = setTimeout(() => (flashId.value = null), 2500);
};

const stopHighlight = watch(
  () => live.pending.value,
  (pending) => {
    if (pending) return;
    void highlight();
    queueMicrotask(() => stopHighlight());
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  clearTimeout(flashTimer);
});
</script>
