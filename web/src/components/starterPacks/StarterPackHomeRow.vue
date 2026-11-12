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
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { HomePack } from "@/composables/starterPacks/useHomePacks";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

const STREAMS_SHOWN = 2;

const props = defineProps<{ item: HomePack; first: boolean }>();

const { t } = useI18nTyped();
const flow = props.item.flow;
const id = props.item.testId;

const streams = computed(() => props.item.matcher.streams.value);
const shownStreams = computed(() => streams.value.slice(0, STREAMS_SHOWN));
const moreStreams = computed(() => streams.value.slice(STREAMS_SHOWN));
const clusters = computed(() => props.item.matcher.clusters.value);
const forbidden = computed(() => props.item.view.value === "forbidden");
const busy = computed(() => flow.running.value);

const tiles = computed(() => {
  const tileKeys = props.item.pack.tiles ?? {};
  const list: { kind: string; icon: IconName; title: I18nText; meta: I18nText }[] = [];
  const dashboards = flow.dashboardCount.value;
  const alerts = flow.alertCount.value;
  const views = flow.viewCount.value;
  if (dashboards) {
    list.push({
      kind: "dashboard",
      icon: "dashboard",
      title: t("starterPacks.card.dashboards", { count: dashboards }, dashboards),
      meta: tileKeys.dashboard
        ? t(tileKeys.dashboard)
        : t("starterPacks.guide.rowDashboardMeta", { folder: raw(flow.pack.folder.name) }),
    });
  }
  if (alerts) {
    list.push({
      kind: "alert",
      icon: "notifications-off",
      title: t("starterPacks.countAlerts", { count: alerts }, alerts),
      meta: tileKeys.alert
        ? t("starterPacks.home.tileAlertsSilent", { what: t(tileKeys.alert) })
        : t("starterPacks.guide.rowAlertsSilent"),
    });
  }
  if (views) {
    list.push({
      kind: "savedView",
      icon: "bookmark",
      title: t("starterPacks.guide.rowSavedViews", { count: views }, views),
      meta: tileKeys.savedView ? t(tileKeys.savedView) : t("starterPacks.guide.rowSavedViewsMeta"),
    });
  }
  return list;
});
</script>

<template>
  <div
    class="bg-surface-panel rounded-surface border-border-default grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] overflow-hidden border max-lg:grid-cols-1"
    :data-test="id('home-pack-card')"
    :data-status="busy ? 'running' : item.view.value"
  >
    <div class="bg-surface-subtle flex items-center gap-3 p-4">
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <img
            v-if="item.pack.logo"
            :src="getImageURL(item.pack.logo)"
            class="h-6 w-6 shrink-0 object-contain"
            alt=""
          />
          <OText
            variant="body-strong"
            class="text-text-heading"
            :data-test="id('home-pack-card-title')"
            >{{ item.title }}</OText
          >
          <OBadge
            v-if="first"
            variant="default-soft"
            size="sm"
            :data-test="id('home-pack-card-best')"
          >
            {{ t("starterPacks.home.bestPlace") }}
          </OBadge>
        </div>
        <OText v-if="clusters.length" variant="meta" :data-test="id('home-pack-card-from')">{{
          t("starterPacks.home.fromClusters", { clusters: raw(clusters.join(", ")) })
        }}</OText>
        <ul
          v-if="streams.length"
          class="flex flex-col gap-1"
          :data-test="id('home-pack-card-streams')"
        >
          <li v-for="stream in shownStreams" :key="stream" class="flex items-center gap-2">
            <span class="bg-status-positive h-1.5 w-1.5 shrink-0 rounded-full" />
            <OText variant="mono">{{ raw(stream) }}</OText>
          </li>
          <li v-if="moreStreams.length">
            <OPopover align="start" :aria-label="t('starterPacks.home.moreStreamsLabel')">
              <template #trigger>
                <OButton
                  variant="outline"
                  size="chip"
                  icon-right="arrow-drop-down"
                  :data-test="id('home-pack-streams-more')"
                >
                  {{
                    t(
                      "starterPacks.home.moreStreams",
                      { count: moreStreams.length },
                      moreStreams.length,
                    )
                  }}
                </OButton>
              </template>
              <ul
                class="flex max-h-60 flex-col gap-1 overflow-y-auto p-2"
                :data-test="id('home-pack-streams-more-list')"
              >
                <li v-for="stream in moreStreams" :key="stream">
                  <OText variant="mono">{{ raw(stream) }}</OText>
                </li>
              </ul>
            </OPopover>
          </li>
        </ul>
      </div>
      <OIcon name="arrow-forward" size="sm" class="text-text-secondary shrink-0 max-lg:hidden" />
    </div>

    <div
      class="flex items-stretch gap-3 p-4 max-md:flex-col"
      :data-test="id('home-pack-card-counts')"
    >
      <OText v-if="forbidden" variant="meta" class="self-center">{{
        t("starterPacks.guide.forbiddenSub", { title: item.title })
      }}</OText>
      <template v-else>
        <div
          v-for="tile in tiles"
          :key="tile.kind"
          class="border-border-default rounded-default flex w-52 min-w-0 flex-col gap-1 border p-3 max-md:w-auto"
          :data-test="id(`home-pack-card-row-${tile.kind}`)"
        >
          <div class="flex items-center gap-2">
            <OIcon :name="tile.icon" size="sm" class="text-text-secondary shrink-0" />
            <OText variant="body-strong" class="text-text-heading">{{ tile.title }}</OText>
          </div>
          <OText variant="meta">{{ tile.meta }}</OText>
        </div>
      </template>
    </div>

    <div class="flex w-56 flex-col justify-center gap-2 p-4 max-lg:w-auto">
      <template v-if="forbidden">
        <OButton
          variant="outline"
          size="sm-action"
          icon-left="content-copy"
          block
          :data-test="id('home-pack-card-copy-link-btn')"
          @click="item.copyLink"
        >
          {{ t("starterPacks.copyLink") }}
        </OButton>
      </template>
      <template v-else>
        <OButton
          :variant="first ? 'primary' : 'outline'"
          size="sm-action"
          block
          :disabled="busy"
          :loading="busy"
          :data-test="id('home-pack-card-setup-btn')"
          @click="item.startSetup"
        >
          {{ t("starterPacks.home.setUp", { title: item.title }) }}
        </OButton>
        <OButton
          variant="outline"
          size="sm-action"
          block
          :data-test="id('home-pack-card-details-btn')"
          @click="item.openDetails"
        >
          {{ t("starterPacks.guide.whatGetsCreated") }}
        </OButton>
      </template>
      <div class="flex flex-wrap justify-center gap-1">
        <OButton
          v-if="item.view.value === 'offer' && item.canHideForAll.value"
          variant="ghost"
          size="sm"
          :data-test="id('home-pack-card-hide-all-btn')"
          @click="item.setHidden(item.orgHide.hide)"
        >
          {{ t("starterPacks.home.hideForEveryone") }}
        </OButton>
      </div>
    </div>
  </div>
</template>
