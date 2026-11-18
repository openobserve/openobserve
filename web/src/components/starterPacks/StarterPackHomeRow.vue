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
import { computed } from "vue";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { packCardText, type PackCardKind } from "@/composables/starterPacks/packCardText";
import type { HomePackRowItem } from "@/composables/starterPacks/useHomePacks";
import type { PackItemKind } from "@/composables/starterPacks/types";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

const props = defineProps<{ item: HomePackRowItem; first?: boolean }>();

const { t, te } = useI18nTyped();
const flow = props.item.flow;
const pack = props.item.pack;
const id = props.item.testId;

type ResourceKind = Extract<PackItemKind, "dashboard" | "alert" | "savedView">;

const SHOWN_STREAMS = 2;
const GRID_COLS = ["grid-cols-1", "grid-cols-1", "grid-cols-2", "grid-cols-3"];
const KIND_TINTS: Record<ResourceKind, { card: string; chip: string }> = {
  dashboard: {
    card: "bg-ingest-tint-blue border-ingest-accent-blue/25",
    chip: "bg-ingest-accent-blue",
  },
  alert: {
    card: "bg-ingest-tint-orange border-ingest-accent-orange/25",
    chip: "bg-ingest-accent-orange",
  },
  savedView: {
    card: "bg-ingest-tint-purple border-ingest-accent-purple/25",
    chip: "bg-ingest-accent-purple",
  },
};

const streams = computed(() => props.item.matcher.streams.value);
const shownStreams = computed(() => streams.value.slice(0, SHOWN_STREAMS));
const moreStreams = computed(() => streams.value.slice(SHOWN_STREAMS));
const clusters = computed(() => props.item.matcher.clusters.value);
const forbidden = computed(() => props.item.view.value === "forbidden");
const busy = computed(() => flow.running.value || props.item.view.value === "loading");

const plannedIds = (kind: PackItemKind) =>
  (flow.preview.value?.items ?? [])
    .filter((entry) => entry.kind === kind && entry.status !== "existing")
    .map(({ itemId }) => itemId);
// An unnamed alert reads back as its id, which is not a name a user knows.
const alertNames = computed(() =>
  plannedIds("alert")
    .map((itemId) => ({ itemId, name: flow.nameOf(itemId) }))
    .filter(({ itemId, name }) => name && name !== itemId)
    .map(({ name }) => name),
);
const dashboardTitle = computed(() => {
  const [itemId] = plannedIds("dashboard");
  return (itemId && flow.nameOf(itemId)) || pack.dashboards[0]?.title;
});
// The saved view opens its own stream, so only that stream is named, and only once seen.
const viewStream = computed(() => {
  const stream = pack.savedViews[0]?.search?.data?.stream?.selectedStream?.[0];
  return stream && streams.value.includes(stream) ? stream : undefined;
});
const facts = computed(() => ({
  clusters: clusters.value,
  stream: viewStream.value,
  alertNames: alertNames.value,
  title: dashboardTitle.value,
  panels: flow.preview.value?.panels.kept ?? null,
}));

interface ResourceCard {
  kind: ResourceKind;
  textKind: PackCardKind;
  icon: IconName;
  label: I18nText;
}

const cards = computed(() => {
  const list: ResourceCard[] = [];
  const dashboards = flow.dashboardCount.value;
  const alerts = flow.alertCount.value;
  const views = flow.viewCount.value;
  if (dashboards) {
    list.push({
      kind: "dashboard",
      textKind: "dashboards",
      icon: "dashboard",
      label: t("starterPacks.card.dashboards", { count: dashboards }, dashboards),
    });
  }
  if (alerts) {
    list.push({
      kind: "alert",
      textKind: "alerts",
      icon: "notifications",
      label: t("starterPacks.countAlerts", { count: alerts }, alerts),
    });
  }
  if (views) {
    list.push({
      kind: "savedView",
      textKind: "savedViews",
      icon: "bookmark",
      label: t("starterPacks.guide.rowSavedViews", { count: views }, views),
    });
  }
  return list.map((card) => ({
    ...card,
    summary: packCardText(t, te, pack.id, card.textKind, facts.value),
  }));
});
const gridCols = computed(() => GRID_COLS[cards.value.length] ?? "grid-cols-3");
const previewPending = computed(
  () => !cards.value.length && ["idle", "loading"].includes(flow.previewState.value),
);
const previewFailed = computed(() => !cards.value.length && flow.previewState.value === "error");
const nothingFits = computed(() => !cards.value.length && flow.previewState.value === "ready");
</script>

<template>
  <div class="min-w-0" :data-test="first ? id('home-pack-row-highlight') : undefined">
    <div
      class="bg-surface-base rounded-surface flex min-w-0 overflow-hidden border max-md:flex-col"
      :class="first ? 'border-accent' : 'border-border-default'"
      :data-test="id('home-pack-card')"
      :data-status="flow.running.value ? 'running' : item.view.value"
    >
      <div
        class="border-border-subtle flex w-85 shrink-0 flex-col gap-3 border-e p-4 max-md:w-full max-md:border-e-0 max-md:border-b"
        :class="first ? 'from-accent/8 to-ingest-accent-purple/8 bg-linear-to-br' : undefined"
      >
        <div class="flex min-w-0 items-start gap-3">
          <span
            class="border-border-default bg-surface-base rounded-default flex size-9 shrink-0 items-center justify-center border"
          >
            <img
              v-if="pack.logo"
              :src="getImageURL(pack.logo)"
              class="size-5 object-contain"
              alt=""
            />
            <OIcon v-else name="inventory-2" size="sm" class="text-text-secondary" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <OText
                variant="body-strong"
                class="text-text-heading"
                :data-test="id('home-pack-card-title')"
                >{{ item.title }}</OText
              >
              <OBadge
                v-if="first"
                variant="primary-soft"
                size="sm"
                :data-test="id('home-pack-best-start')"
                >{{ t("starterPacks.home.bestStart") }}</OBadge
              >
            </div>
            <OText v-if="clusters.length" variant="meta" :data-test="id('home-pack-card-from')">{{
              t("starterPacks.home.fromClusters", { clusters: raw(clusters.join(", ")) })
            }}</OText>
          </div>
        </div>

        <div
          v-if="streams.length"
          class="flex min-w-0 items-center gap-2"
          :data-test="id('home-pack-row-streams')"
        >
          <span class="bg-status-success-text size-1.5 shrink-0 rounded-full" />
          <OTruncatedText class="text-text-heading text-compact min-w-0 font-mono">{{
            raw(shownStreams.join(", "))
          }}</OTruncatedText>
          <span
            v-if="moreStreams.length"
            class="text-accent text-compact shrink-0 font-semibold whitespace-nowrap"
            tabindex="0"
            :aria-label="t('starterPacks.home.moreStreamsLabel')"
            :data-test="id('home-pack-streams-more')"
          >
            <OTooltip side="bottom" align="start" hoverable>
              <template #content>
                <ul
                  class="flex max-h-60 flex-col gap-1 overflow-y-auto"
                  :data-test="id('home-pack-streams-more-list')"
                >
                  <li v-for="stream in moreStreams" :key="stream" class="font-mono">
                    {{ raw(stream) }}
                  </li>
                </ul>
              </template>
            </OTooltip>
            {{
              t("starterPacks.home.moreStreams", { count: moreStreams.length }, moreStreams.length)
            }}
          </span>
        </div>

        <div class="mt-auto flex flex-wrap items-center gap-2">
          <template v-if="forbidden">
            <OButton
              variant="outline"
              size="sm"
              icon-left="lock"
              :data-test="id('home-pack-card-ask-admin-btn')"
              @click="item.copyLink"
            >
              {{ t("starterPacks.home.askAdmin") }}
            </OButton>
            <OButton
              variant="ghost-primary"
              size="xs"
              icon-left="content-copy"
              :data-test="id('home-pack-card-copy-link-btn')"
              @click="item.copyLink"
            >
              {{ t("starterPacks.home.copyLink") }}
            </OButton>
          </template>
          <OButton
            v-else
            :variant="first ? 'primary' : 'outline'"
            block
            icon-right="arrow-forward"
            :disabled="busy"
            :loading="busy"
            :aria-label="t('starterPacks.home.reviewSetUpLabel', { title: item.title })"
            :data-test="id('home-pack-card-setup-btn')"
            @click="item.startSetup"
          >
            {{ t("starterPacks.home.reviewSetUp") }}
          </OButton>
        </div>
      </div>

      <div class="min-w-0 flex-1 p-4" :data-test="id('home-pack-card-counts')">
        <div
          v-if="previewPending"
          class="grid grid-cols-3 gap-3 max-sm:grid-cols-1"
          :data-test="id('home-pack-resource-skeleton')"
        >
          <OSkeleton v-for="n in 3" :key="n" class="h-16 w-full" />
        </div>
        <OText
          v-else-if="previewFailed"
          variant="meta"
          wrap
          :data-test="id('home-pack-resource-error')"
          >{{ t("starterPacks.home.previewFailed") }}</OText
        >
        <OText
          v-else-if="nothingFits"
          variant="meta"
          wrap
          :data-test="id('home-pack-resource-empty')"
          >{{ t("starterPacks.home.nothingFitsYet") }}</OText
        >
        <div v-else class="grid h-full items-stretch gap-3 max-sm:grid-cols-1" :class="gridCols">
          <div
            v-for="card in cards"
            :key="card.kind"
            class="rounded-default flex min-w-0 flex-col gap-2 border px-3 py-3"
            :class="KIND_TINTS[card.kind].card"
            :data-test="id(`home-pack-resource-card-${card.kind}`)"
          >
            <span
              class="text-text-heading text-compact inline-flex items-center gap-2 font-semibold"
              :data-test="id(`home-pack-card-row-${card.kind}`)"
            >
              <span
                class="rounded-default flex size-6 shrink-0 items-center justify-center text-white"
                :class="KIND_TINTS[card.kind].chip"
              >
                <OIcon
                  :name="card.icon"
                  size="xs"
                  :data-test="id(`home-pack-card-icon-${card.kind}`)"
                />
              </span>
              {{ card.label }}
            </span>
            <OText
              v-if="card.summary"
              variant="meta"
              wrap
              class="line-clamp-4"
              :title="card.summary"
              :data-test="id(`home-pack-resource-summary-${card.kind}`)"
              >{{ card.summary }}</OText
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
