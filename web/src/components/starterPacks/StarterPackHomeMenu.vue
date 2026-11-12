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
import { computed, ref } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { HomePack, HomePacks } from "@/composables/starterPacks/useHomePacks";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { getImageURL } from "@/utils/zincutils";

const props = defineProps<{ home: HomePacks }>();

const { t } = useI18nTyped();
const open = ref(false);

const rows = computed(() => [...props.home.offered.value, ...props.home.setUp.value]);
const fits = computed(() => props.home.offered.value.length);
const label = computed(() =>
  fits.value
    ? t("starterPacks.home.menuFits", { count: fits.value }, fits.value)
    : t("starterPacks.home.menuIdle"),
);

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const setUpLine = (item: HomePack): I18nText => {
  const at = item.flow.record.value?.installedAt;
  const date = at ? new Date(at / 1000) : null;
  const time = date?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "";
  const when = !date
    ? t("starterPacks.home.setUpDone")
    : sameDay(date, new Date())
      ? t("starterPacks.home.setUpToday", { time: raw(time) })
      : t("starterPacks.home.setUpOn", { date: raw(date.toLocaleDateString()) });
  const silent = item.flow.alertsOff.value;
  return silent ? t("starterPacks.home.setUpSilent", { when, count: silent }, silent) : when;
};
const fitsLine = (item: HomePack): I18nText => {
  const dashboards = item.flow.dashboardCount.value;
  return t(
    "starterPacks.home.menuOfferLine",
    { count: dashboards, streams: raw(item.matcher.streams.value.join(", ")) },
    dashboards,
  );
};

const act = (work: () => unknown) => {
  open.value = false;
  void work();
};
</script>

<template>
  <OPopover
    v-model:open="open"
    align="end"
    flip-align
    :aria-label="t('starterPacks.home.menuHeader')"
  >
    <template #trigger>
      <OButton
        variant="outline"
        size="sm-toolbar"
        icon-left="inventory-2"
        :icon-right="open ? 'keyboard-arrow-up' : 'keyboard-arrow-down'"
        data-test="home-pack-menu-btn"
      >
        {{ label }}
      </OButton>
    </template>
    <div class="flex w-[min(30rem,calc(100vw-1.5rem))] flex-col text-sm" data-test="home-pack-menu">
      <OText variant="meta" class="border-border-default border-b px-3 py-2">{{
        t("starterPacks.home.menuHeader")
      }}</OText>
      <ul class="flex flex-col">
        <li
          v-for="item in rows"
          :key="item.pack.id"
          class="border-border-default flex items-center gap-3 border-b px-3 py-2.5"
          :data-test="`home-pack-menu-row-${item.pack.id}`"
        >
          <img
            v-if="item.pack.logo"
            :src="getImageURL(item.pack.logo)"
            class="h-5 w-5 shrink-0 object-contain"
            alt=""
          />
          <div class="flex min-w-0 flex-1 flex-col">
            <strong class="text-text-heading">{{ item.title }}</strong>
            <OText variant="meta">{{
              item.view.value === "installed" ? setUpLine(item) : fitsLine(item)
            }}</OText>
          </div>
          <template v-if="item.view.value === 'installed'">
            <OButton
              v-if="item.flow.canUndo.value"
              variant="ghost-primary"
              size="sm-action"
              :data-test="`home-pack-menu-undo-btn-${item.pack.id}`"
              @click="act(item.openUndo)"
            >
              {{ t("starterPacks.landing.undo") }}
            </OButton>
          </template>
          <OButton
            v-else-if="item.view.value === 'forbidden'"
            variant="outline"
            size="sm-action"
            icon-left="content-copy"
            :data-test="`home-pack-menu-copy-link-btn-${item.pack.id}`"
            @click="act(item.copyLink)"
          >
            {{ t("starterPacks.copyLink") }}
          </OButton>
          <OButton
            v-else
            variant="primary"
            size="sm-action"
            :loading="item.flow.running.value"
            :disabled="item.flow.running.value"
            :data-test="`home-pack-menu-setup-btn-${item.pack.id}`"
            @click="act(item.startSetup)"
          >
            {{ t("starterPacks.home.setUpShort") }}
          </OButton>
        </li>
      </ul>
      <div class="flex items-center justify-between gap-2 px-1.5 py-1.5">
        <OButton
          variant="ghost-primary"
          size="sm"
          icon-right="keyboard-double-arrow-right"
          data-test="home-pack-menu-library-link"
          @click="act(home.library)"
        >
          {{ t("starterPacks.home.openLibrary") }}
        </OButton>
        <OButton
          variant="ghost-muted"
          size="sm"
          data-test="home-pack-menu-hide-btn"
          @click="act(home.menu.dismiss)"
        >
          {{ t("starterPacks.home.dontShow") }}
        </OButton>
      </div>
    </div>
  </OPopover>
</template>
