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
import { Translation } from "vue-i18n";
import OBadge from "@/lib/core/Badge/OBadge.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import OText from "@/lib/core/Typography/OText.vue";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { HomePack } from "@/composables/starterPacks/useHomePacks";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

const props = defineProps<{ item: HomePack }>();

const { t } = useI18nTyped();
const flow = props.item.flow;
const id = props.item.testId;

const streams = computed(() => props.item.matcher.streams.value);
const moreStreams = computed(() => streams.value.slice(1));
const clusters = computed(() => props.item.matcher.clusters.value);
const forbidden = computed(() => props.item.view.value === "forbidden");
const busy = computed(() => flow.running.value);

const counts = computed(() => {
  const list: { kind: string; icon: IconName; label: I18nText }[] = [];
  const dashboards = flow.dashboardCount.value;
  const alerts = flow.alertCount.value;
  const views = flow.viewCount.value;
  if (dashboards) {
    list.push({
      kind: "dashboard",
      icon: "dashboard",
      label: t("starterPacks.card.dashboards", { count: dashboards }, dashboards),
    });
  }
  if (alerts) {
    list.push({
      kind: "alert",
      icon: "notifications",
      label: t("starterPacks.countAlerts", { count: alerts }, alerts),
    });
  }
  if (views) {
    list.push({
      kind: "savedView",
      icon: "bookmark",
      label: t("starterPacks.guide.rowSavedViews", { count: views }, views),
    });
  }
  return list;
});
</script>

<template>
  <div
    class="bg-surface-panel rounded-surface border-border-default flex min-w-0 flex-col gap-2.5 border p-3.5"
    :data-test="id('home-pack-card')"
    :data-status="busy ? 'running' : item.view.value"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <span
        class="border-border-default bg-surface-base rounded-default flex size-8 shrink-0 items-center justify-center border"
      >
        <img
          v-if="item.pack.logo"
          :src="getImageURL(item.pack.logo)"
          class="size-5 object-contain"
          alt=""
        />
        <OIcon v-else name="inventory-2" size="sm" class="text-text-secondary" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <OText
          variant="body-strong"
          class="text-text-heading"
          :data-test="id('home-pack-card-title')"
          >{{ item.title }}</OText
        >
        <OText v-if="clusters.length" variant="meta" :data-test="id('home-pack-card-from')">{{
          t("starterPacks.home.fromClusters", { clusters: raw(clusters.join(", ")) })
        }}</OText>
      </div>
    </div>

    <div
      v-if="streams.length"
      class="text-text-secondary flex min-w-0 items-center gap-1.5 text-xs"
      :data-test="id('home-pack-card-streams')"
    >
      <Translation
        keypath="starterPacks.home.fits"
        tag="span"
        class="flex min-w-0 items-center gap-1"
        scope="global"
      >
        <template #stream>
          <OTruncatedText class="text-text-heading text-compact font-mono">{{
            raw(streams[0])
          }}</OTruncatedText>
        </template>
      </Translation>
      <OBadge
        v-if="moreStreams.length"
        variant="default-outline"
        size="sm"
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
        {{ t("starterPacks.home.moreStreams", { count: moreStreams.length }, moreStreams.length) }}
      </OBadge>
    </div>

    <div
      class="text-text-body text-compact flex flex-wrap gap-x-3 gap-y-1"
      :data-test="id('home-pack-card-counts')"
    >
      <span
        v-for="count in counts"
        :key="count.kind"
        class="inline-flex items-center gap-1.5"
        :data-test="id(`home-pack-card-row-${count.kind}`)"
      >
        <OIcon
          :name="count.icon"
          size="sm"
          class="text-text-secondary shrink-0"
          :data-test="id(`home-pack-card-icon-${count.kind}`)"
        />
        {{ count.label }}
      </span>
    </div>

    <div class="flex flex-wrap items-center gap-2">
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
        variant="primary"
        size="sm"
        :disabled="busy"
        :loading="busy"
        :aria-label="t('starterPacks.home.setUp', { title: item.title })"
        :data-test="id('home-pack-card-setup-btn')"
        @click="item.startSetup"
      >
        {{ t("starterPacks.home.setUpShort") }}
      </OButton>
    </div>
  </div>
</template>
