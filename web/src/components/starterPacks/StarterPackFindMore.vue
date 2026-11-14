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

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useStore } from "vuex";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { toast } from "@/lib/feedback/Toast/useToast";
import OSwitch from "@/lib/forms/Switch/OSwitch.vue";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import type { FindMoreResult, FindMoreSource } from "@/composables/starterPacks/findMore";
import { STARTER_PACKS } from "@/composables/starterPacks/kubernetesPack";
import { useDailyCheck } from "@/composables/starterPacks/useDailyCheck";
import { useFindMore } from "@/composables/starterPacks/useFindMore";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

const NAMES_SHOWN = 5;
const MINUTE_US = 60 * 1_000_000;
const HOUR_US = 60 * MINUTE_US;

const props = withDefaults(
  defineProps<{ org: string; variant?: "button" | "row"; dailyToggle?: boolean }>(),
  { variant: "button", dailyToggle: false },
);

const emit = defineEmits<{ changed: [] }>();

const { t } = useI18nTyped();
const store = useStore();
const finder = useFindMore(props.org);
const daily = useDailyCheck(props.org);
const open = ref(false);
const savingDaily = ref(false);

const isAdmin = computed(() => {
  const role = String(
    store.state.userInfo?.role ?? store.state.currentuser?.role ?? "",
  ).toLowerCase();
  return store.state.zoConfig?.is_org_admin === true || role === "admin" || role === "root";
});

onMounted(() => void daily.load());

const suggested = computed(() =>
  daily.enabled.value
    ? (finder.result.value?.sources.length ?? daily.last.value?.sources.length ?? 0)
    : 0,
);
const sources = computed(() => finder.result.value?.sources ?? []);

const when = (result: FindMoreResult): I18nText => {
  const age = Date.now() * 1000 - result.checkedAt;
  if (age < MINUTE_US) return t("starterPacks.findMore.justNow");
  if (age < HOUR_US) {
    const minutes = Math.floor(age / MINUTE_US);
    return t("starterPacks.findMore.minutesAgo", { count: minutes }, minutes);
  }
  if (age < 24 * HOUR_US) {
    const hours = Math.floor(age / HOUR_US);
    return t("starterPacks.findMore.hoursAgo", { count: hours }, hours);
  }
  return raw(new Date(result.checkedAt / 1000).toLocaleString());
};

const titleOf = (source: FindMoreSource): I18nText => {
  const pack = STARTER_PACKS.find(({ id }) => id === source.packId);
  const name = pack ? t(pack.titleKey) : raw(source.label);
  return source.streams[0] ? raw(`${name} · ${source.streams[0]}`) : name;
};

const countsOf = (source: FindMoreSource): I18nText => {
  const dashboards = source.items.filter(({ kind }) => kind === "dashboard").length;
  const alerts = source.items.length - dashboards;
  const parts = [
    ...(dashboards
      ? [t("starterPacks.findMore.countDashboards", { count: dashboards }, dashboards)]
      : []),
    ...(alerts ? [t("starterPacks.countAlerts", { count: alerts }, alerts)] : []),
  ];
  return raw(parts.join(", "));
};

const shownItems = (source: FindMoreSource) => source.items.slice(0, NAMES_SHOWN);
const hiddenCount = (source: FindMoreSource) => Math.max(0, source.items.length - NAMES_SHOWN);

const openFinder = () => {
  open.value = true;
  void finder.check();
};

const add = async (source: FindMoreSource) => {
  const before = finder.added.value.length;
  const complete = await finder.add(source);
  if (finder.added.value.length > before) emit("changed");
  if (!complete) {
    toast({
      variant: "error",
      message: t("starterPacks.findMore.addFailed", { name: titleOf(source) }),
    });
  }
};

const undo = async (entry: (typeof finder.added.value)[number]) => {
  if (await finder.undo(entry)) emit("changed");
  else toast({ variant: "error", message: t("starterPacks.findMore.undoFailed") });
};

const guarded = async (work: () => Promise<unknown>) => {
  try {
    await work();
  } catch {
    toast({ variant: "error", message: t("starterPacks.findMore.dismissFailed") });
  }
};

const toggleDaily = async (on: unknown) => {
  savingDaily.value = true;
  try {
    await daily.setEnabled(on === true);
    await daily.load();
  } catch {
    toast({ variant: "error", message: t("starterPacks.findMore.dailyFailed") });
  } finally {
    savingDaily.value = false;
  }
};
</script>

<template>
  <div
    v-if="variant === 'row'"
    class="border-border-default rounded-surface mt-2.5 flex items-center justify-between gap-3 border px-3 py-2"
    data-test="starter-pack-find-more-row"
  >
    <OText class="text-text-secondary text-sm">
      {{
        suggested > 0
          ? t("starterPacks.findMore.homeRow", { count: suggested }, suggested)
          : t("starterPacks.findMore.homeRowIdle")
      }}
    </OText>
    <OButton
      variant="outline"
      size="sm"
      icon-left="search"
      data-test="starter-pack-find-more-btn"
      @click="openFinder"
    >
      {{ suggested > 0 ? t("starterPacks.findMore.review") : t("starterPacks.findMore.title") }}
    </OButton>
  </div>
  <OButton
    v-else
    variant="outline"
    size="sm"
    icon-left="search"
    data-test="starter-pack-find-more-btn"
    @click="openFinder"
  >
    {{ t("starterPacks.findMore.title") }}
    <OBadge v-if="suggested > 0" variant="primary-soft" data-test="starter-pack-find-more-count">
      {{ suggested }}
    </OBadge>
  </OButton>

  <ODrawer
    v-model:open="open"
    size="md"
    :title="t('starterPacks.findMore.title')"
    :sub-title="t('starterPacks.findMore.subtitle')"
    data-test="starter-pack-find-more-drawer"
  >
    <div class="flex flex-col gap-3 text-sm">
      <div
        v-if="dailyToggle && isAdmin"
        class="border-border-default flex flex-col gap-1 border-b pb-3"
        data-test="starter-pack-find-more-daily"
      >
        <OSwitch
          :model-value="daily.enabled.value"
          :label="t('starterPacks.findMore.daily')"
          :disabled="savingDaily"
          data-test="starter-pack-find-more-daily-toggle"
          @update:model-value="toggleDaily"
        />
        <OText variant="meta">{{ t("starterPacks.findMore.dailyHint") }}</OText>
      </div>

      <div
        v-for="entry in finder.added.value"
        :key="entry.installId + entry.source.id"
        class="bg-surface-subtle rounded-surface flex items-center justify-between gap-2 px-3 py-2"
        :data-test="`starter-pack-find-more-added-${entry.source.id}`"
      >
        <OText>{{ t("starterPacks.findMore.added", { name: titleOf(entry.source) }) }}</OText>
        <OButton
          variant="ghost"
          size="sm"
          :loading="finder.busy.value === entry.source.id"
          :data-test="`starter-pack-find-more-undo-${entry.source.id}`"
          @click="undo(entry)"
        >
          {{ t("starterPacks.findMore.undo") }}
        </OButton>
      </div>

      <div v-if="finder.state.value === 'checking'" class="flex flex-col gap-2">
        <OText variant="meta">{{ t("starterPacks.findMore.checking") }}</OText>
        <OSkeleton
          v-for="index in 3"
          :key="index"
          type="rect"
          class="rounded-surface h-16 w-full"
        />
      </div>
      <OEmptyState
        v-else-if="finder.state.value === 'error'"
        size="block"
        variant="error"
        illustration="broken-panel"
        :title="t('starterPacks.findMore.error')"
        :action-label="t('alert_library.retry')"
        action-icon="refresh"
        data-test="starter-pack-find-more-error"
        @action="finder.check"
      />
      <template v-else-if="finder.result.value">
        <OText
          v-if="sources.length === 0"
          class="text-text-secondary"
          data-test="starter-pack-find-more-empty"
        >
          {{ t("starterPacks.findMore.empty", { when: when(finder.result.value) }) }}
        </OText>
        <template v-else>
          <OText class="text-text-heading font-medium" data-test="starter-pack-find-more-summary">
            {{
              t(
                "starterPacks.findMore.summary",
                { count: sources.length, when: when(finder.result.value) },
                sources.length,
              )
            }}
          </OText>
          <div
            v-for="source in sources"
            :key="source.id"
            class="border-border-default rounded-surface flex flex-col gap-2 border p-3"
            :data-test="`starter-pack-find-more-source-${source.id}`"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex min-w-0 flex-col">
                <OText class="text-text-heading truncate font-medium">{{ titleOf(source) }}</OText>
                <OText variant="meta">{{ countsOf(source) }}</OText>
              </div>
              <div class="flex shrink-0 gap-1">
                <OButton
                  variant="ghost-muted"
                  size="sm"
                  :disabled="finder.busy.value !== null"
                  :data-test="`starter-pack-find-more-dismiss-${source.id}`"
                  @click="guarded(() => finder.dismissSource(source.id))"
                >
                  {{ t("starterPacks.findMore.dismiss") }}
                </OButton>
                <OButton
                  variant="primary"
                  size="sm"
                  :loading="finder.busy.value === source.id"
                  :disabled="finder.busy.value !== null && finder.busy.value !== source.id"
                  :data-test="`starter-pack-find-more-add-${source.id}`"
                  @click="add(source)"
                >
                  {{ t("starterPacks.findMore.add") }}
                </OButton>
              </div>
            </div>
            <ul
              class="flex flex-col gap-0.5"
              :data-test="`starter-pack-find-more-items-${source.id}`"
            >
              <li
                v-for="item in shownItems(source)"
                :key="item.id"
                class="flex items-center justify-between gap-2"
              >
                <OText class="truncate">{{ raw(item.name) }}</OText>
                <OButton
                  variant="ghost-muted"
                  size="xs"
                  icon-left="close"
                  :aria-label="t('starterPacks.findMore.dismissItem', { name: raw(item.name) })"
                  :disabled="finder.busy.value !== null"
                  :data-test="`starter-pack-find-more-dismiss-item-${item.id}`"
                  @click="guarded(() => finder.dismissItem(source.id, item.id))"
                />
              </li>
              <li v-if="hiddenCount(source) > 0">
                <OText variant="meta">
                  {{ t("starterPacks.findMore.andMore", { count: hiddenCount(source) }) }}
                </OText>
              </li>
            </ul>
            <OText v-if="source.queriesPerDay > 0" variant="meta">
              {{ t("starterPacks.findMore.queries", { count: source.queriesPerDay }) }}
              {{ t("starterPacks.findMore.alertsOff") }}
            </OText>
          </div>
        </template>
        <div
          v-if="finder.result.value.dismissed > 0"
          class="flex items-center justify-between gap-2"
          data-test="starter-pack-find-more-dismissed"
        >
          <OText variant="meta">
            {{
              t(
                "starterPacks.findMore.dismissed",
                { count: finder.result.value.dismissed },
                finder.result.value.dismissed,
              )
            }}
          </OText>
          <OButton
            variant="ghost"
            size="sm"
            data-test="starter-pack-find-more-show-dismissed"
            @click="guarded(finder.restoreDismissed)"
          >
            {{ t("starterPacks.findMore.showDismissed") }}
          </OButton>
        </div>
      </template>
    </div>
  </ODrawer>
</template>
