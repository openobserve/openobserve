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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { StarterPack } from "@/composables/starterPacks/types";
import {
  matchSource,
  useHomePacks,
  type HomePack,
  type HomePacks,
} from "@/composables/starterPacks/useHomePacks";
import { usePackGate } from "@/composables/starterPacks/usePackGate";
import { useStarterPackPopup, type RailPack } from "@/composables/starterPacks/useStarterPackPopup";
import { packTitle } from "@/composables/starterPacks/usePackCatalog";
import { raw, useI18nTyped } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";
import { KIND_CHIPS } from "./packKindChips";
import StarterPackListPane from "./StarterPackListPane.vue";

const props = defineProps<{ org: string; packs?: StarterPack[] }>();
// Hands the pack state to Home, which hides Overview while the offer shows.
const emit = defineEmits<{ ready: [packs: HomePacks | null] }>();

const { t } = useI18nTyped();
const gate = usePackGate(props.org);
const home = useHomePacks(props.org, props.packs, () => gate.visible.value);
// An org past onboarding shows no packs, so Home keeps its Overview.
watch(
  () => gate.visible.value,
  (visible) => emit("ready", visible ? home : null),
  { immediate: true },
);
onBeforeUnmount(() => emit("ready", null));
// The badge belongs on a row the user can start, never on an Ask an admin row.
const bestStartId = computed(
  () => home.offered.value.find((item) => item.view.value === "offer")?.pack.id ?? null,
);
const rows = computed<RailPack[]>(() =>
  home.offered.value.map((item) => ({
    entry: { pack: item.pack, flow: item.flow, matcher: item.matcher },
    source: matchSource(item),
    setUp: false,
    stopped: false,
  })),
);
// Counted from each pack's preview, since the raw pack lists items the data may not support.
const heroCounts = computed(() => {
  if (!home.showSection.value) return null;
  const startable = home.offered.value.filter((item) => item.view.value === "offer");
  const pending = ({ flow }: HomePack) => ["idle", "loading"].includes(flow.previewState.value);
  if (startable.some(pending)) return null;
  // A pack whose preview failed or adds nothing is left out, so no total rests on guesses.
  const adding = startable.filter(
    (item) => item.flow.preview.value && matchSource(item).items.length,
  );
  const items = adding.flatMap((item) => matchSource(item).items);
  const count = (kind: string) => items.filter((item) => item.kind === kind).length;
  const [dashboards, alerts, views] = [count("dashboard"), count("alert"), count("savedView")];
  const kinds = [
    {
      kind: "dashboard",
      icon: "dashboard",
      count: dashboards,
      label: t("starterPacks.card.dashboards", { count: dashboards }, dashboards),
    },
    {
      kind: "alert",
      icon: "notifications",
      count: alerts,
      label: t("starterPacks.countAlerts", { count: alerts }, alerts),
    },
    {
      kind: "savedView",
      icon: "bookmark",
      count: views,
      label: t("starterPacks.guide.rowSavedViews", { count: views }, views),
    },
  ] as const;
  const shown = kinds.filter((entry) => entry.count > 0);
  if (!shown.length) return null;
  const packs = adding.length;
  return { lead: t("starterPacks.home.heroLead", { count: packs }, packs), kinds: shown };
});
const SHOWN_NAMES = 2;
// Only Kubernetes reads cluster names, so other packs name themselves and their stream count.
const connectedOf = ({ entry, source }: RailPack) => {
  const clusters = entry.matcher.clusters.value;
  const title = packTitle(entry.pack);
  const base = { id: entry.pack.id, logo: entry.pack.logo, title };
  if (!clusters.length) {
    const streams = source?.streams.length ?? 0;
    const extra = streams
      ? t("starterPacks.adapted.streamCount", { count: streams }, streams)
      : null;
    return { ...base, names: [title], hidden: [] as string[], extra };
  }
  const hidden = clusters.slice(SHOWN_NAMES);
  const extra = hidden.length
    ? t("starterPacks.home.moreClusters", { count: hidden.length }, hidden.length)
    : null;
  return { ...base, names: clusters.slice(0, SHOWN_NAMES), hidden, extra };
};
const connected = computed(() => (home.showSection.value ? rows.value.map(connectedOf) : []));
const selectedId = ref<string | null>(null);
// Opens on a pack the user can start, so an Ask an admin pack never hides the button.
const selected = computed(() => {
  const offered = home.offered.value;
  const id = selectedId.value ?? bestStartId.value;
  return offered.find((item) => item.pack.id === id) ?? offered[0] ?? null;
});
const opening = useStarterPackPopup(props.org).opening;
const busy = computed(
  () =>
    !!selected.value &&
    (selected.value.flow.running.value || opening.value === selected.value.pack.id),
);
const interruptedLine = ({ flow, title }: HomePack) => {
  const by = flow.interruptedBy.value;
  if (by === null) {
    const counts = { made: flow.made.value.length, total: flow.toCreate.value.length };
    return t("starterPacks.home.interrupted", { title, ...counts });
  }
  return by
    ? t("starterPacks.home.startedBy", { who: raw(by), title })
    : t("starterPacks.home.startedBySomeone", { title });
};
</script>

<template>
  <div
    v-if="gate.visible.value"
    class="mt-2.5 mb-3 flex shrink-0 flex-col gap-3 empty:hidden"
    data-test="home-pack-section"
  >
    <div
      v-if="home.offerShown.value"
      class="bg-surface-panel border-border-default rounded-surface flex flex-col gap-3 border p-4"
      data-test="home-pack-hero"
    >
      <div class="flex items-center gap-4">
        <span
          class="relative flex size-11 shrink-0 items-center justify-center"
          data-test="home-pack-hero-icon"
        >
          <span
            class="pack-hero-ring border-status-success-text pointer-events-none absolute inset-0 rounded-full border-2 opacity-0"
            aria-hidden="true"
          />
          <span
            class="pack-hero-ring pack-hero-ring-late border-status-success-text pointer-events-none absolute inset-0 rounded-full border-2 opacity-0"
            aria-hidden="true"
          />
          <span
            class="bg-icon-chip-success-bg text-icon-chip-success-text rounded-default relative flex size-11 items-center justify-center"
          >
            <OIcon name="sensors" size="md" />
          </span>
        </span>
        <div class="flex min-w-0 flex-col gap-1">
          <OText variant="section" as="div" data-test="home-pack-label">{{
            t("starterPacks.home.label")
          }}</OText>
          <h2 class="text-text-heading text-lg leading-tight font-bold tracking-tight">
            {{ t("starterPacks.home.heroTitle") }}
          </h2>
          <div
            v-if="connected.length || heroCounts"
            class="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2"
          >
            <template v-if="connected.length">
              <span class="text-text-secondary text-xs font-medium">{{
                t("starterPacks.home.connected")
              }}</span>
              <div class="flex flex-wrap items-center gap-2" data-test="home-pack-connected">
                <span
                  v-for="source in connected"
                  :key="source.id"
                  class="border-border-default bg-surface-base inline-flex h-7 max-w-full min-w-0 items-center gap-2 rounded-full border ps-1 pe-3 text-xs"
                  :data-test="`home-pack-connected-${source.id}`"
                >
                  <span class="flex size-5 shrink-0 items-center justify-center">
                    <img
                      v-if="source.logo"
                      :src="getImageURL(source.logo)"
                      class="size-4 object-contain"
                      :alt="source.title"
                    />
                    <OIcon v-else name="package-2" size="xs" class="text-text-secondary" />
                  </span>
                  <span
                    class="text-text-heading min-w-0 truncate font-medium"
                    :title="source.names.join(', ')"
                    >{{ raw(source.names.join(", ")) }}</span
                  >
                  <OTooltip v-if="source.hidden.length" side="bottom" align="start">
                    <span tabindex="0" class="text-text-secondary shrink-0">{{
                      source.extra
                    }}</span>
                    <template #content>
                      <ul class="m-0 flex max-h-60 list-none flex-col gap-1 overflow-y-auto p-0">
                        <li v-for="name in source.hidden" :key="name" class="font-mono">
                          {{ raw(name) }}
                        </li>
                      </ul>
                    </template>
                  </OTooltip>
                  <span v-else-if="source.extra" class="text-text-secondary shrink-0">{{
                    source.extra
                  }}</span>
                </span>
              </div>
            </template>
            <template v-if="heroCounts">
              <span class="text-text-secondary text-xs font-medium">{{
                t("starterPacks.home.readyToAdd")
              }}</span>
              <div class="flex flex-wrap items-center gap-2" data-test="home-pack-hero-counts">
                <span
                  v-for="entry in heroCounts.kinds"
                  :key="entry.kind"
                  class="border-border-default bg-surface-base text-text-heading inline-flex h-7 items-center gap-2 rounded-full border ps-1 pe-3 text-xs font-medium"
                  :data-test="`home-pack-hero-count-${entry.kind}`"
                >
                  <span
                    :class="[
                      'flex size-5 shrink-0 items-center justify-center rounded-full',
                      KIND_CHIPS[entry.kind],
                    ]"
                  >
                    <OIcon :name="entry.icon" size="xs" />
                  </span>
                  {{ entry.label }}
                </span>
                <span class="text-text-secondary text-xs">{{ heroCounts.lead }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
    <OText v-else-if="home.labelShown.value" variant="section" data-test="home-pack-label">{{
      t("starterPacks.home.label")
    }}</OText>
    <div
      v-if="home.loading.value"
      class="border-border-default rounded-surface grid h-105 grid-cols-[14.5rem_minmax(0,1fr)] overflow-hidden border"
      data-test="home-pack-card-skeleton"
    >
      <div class="bg-surface-panel border-border-default flex flex-col gap-2 border-e px-2 py-2.5">
        <OSkeleton v-for="n in 2" :key="n" class="h-12.5 w-full" />
      </div>
      <div class="flex flex-col gap-3 p-4">
        <div class="flex items-center gap-3">
          <OSkeleton class="size-9 shrink-0" />
          <div class="flex flex-1 flex-col gap-1.5">
            <OSkeleton class="h-4 w-1/4" />
            <OSkeleton class="h-3 w-1/6" />
          </div>
        </div>
        <div class="grid grid-cols-3 gap-2.5">
          <OSkeleton v-for="n in 3" :key="n" class="h-34 w-full" />
        </div>
      </div>
    </div>

    <template v-for="item in home.notices.value" :key="item.pack.id">
      <OBanner
        v-if="item.view.value === 'interrupted'"
        variant="warning"
        dense
        inline-actions
        :data-test="item.testId('home-pack-interrupted')"
      >
        {{ interruptedLine(item) }}
        <template v-if="item.flow.interruptedBy.value === null" #actions>
          <OButton
            variant="primary"
            size="sm-action"
            :data-test="item.testId('home-pack-interrupted-btn')"
            @click="item.openDetails"
          >
            {{ t("starterPacks.progress.finish") }}
          </OButton>
        </template>
      </OBanner>
      <OBanner
        v-else
        variant="default"
        dense
        inline-actions
        :data-test="item.testId('home-pack-error')"
      >
        {{ t("starterPacks.home.error") }}
        <template #actions>
          <OButton
            variant="outline"
            size="sm-action"
            :data-test="item.testId('home-pack-card-retry-btn')"
            @click="item.retry"
          >
            {{ t("common.retry") }}
          </OButton>
        </template>
      </OBanner>
    </template>

    <OBanner v-if="home.askAdmin.value" variant="default" dense data-test="home-pack-ask-admin">
      {{ t("starterPacks.home.askAdminLine") }}
    </OBanner>

    <section
      v-if="home.showSection.value"
      class="bg-surface-base border-border-default rounded-surface flex h-105 flex-col overflow-hidden border"
      data-test="home-pack-offer"
    >
      <StarterPackListPane
        class="min-h-0 flex-1"
        :rows="rows"
        :selected-id="selected?.pack.id"
        :best-start-id="bestStartId"
        test-prefix="home-pack-list"
        @select="selectedId = $event"
      >
        <template v-if="selected" #action>
          <span
            v-if="selected.view.value === 'forbidden'"
            class="text-text-secondary flex items-center gap-2 text-xs"
            data-test="home-pack-list-ask-admin"
          >
            <OIcon name="lock" size="sm" class="shrink-0" />
            {{ t("starterPacks.askAdmin") }}
          </span>
          <OButton
            v-else
            variant="primary"
            size="sm-action"
            class="min-w-35"
            :disabled="busy"
            :loading="busy"
            :aria-label="t('starterPacks.home.reviewSetUpLabel', { title: selected.title })"
            data-test="home-pack-list-primary-btn"
            @click="selected.startSetup"
          >
            {{ t("starterPacks.home.reviewSetUp") }}
          </OButton>
        </template>
      </StarterPackListPane>
    </section>
  </div>
</template>

<style scoped>
/* keep(keyframes): scoped rewrites the keyframe name, so the rings' animation and its keyframes stay together */
@media (prefers-reduced-motion: no-preference) {
  .pack-hero-ring {
    animation: pack-hero-ring 2.4s ease-out infinite;
  }

  .pack-hero-ring-late {
    animation-delay: 1.2s;
  }
}

@keyframes pack-hero-ring {
  from {
    opacity: 0.3;
    transform: scale(0.55);
  }
  to {
    opacity: 0;
    transform: scale(1.5);
  }
}
</style>
