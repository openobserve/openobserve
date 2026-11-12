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
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { HomePack } from "@/composables/starterPacks/useHomePacks";
import { useI18nTyped } from "@/types/i18n";

defineProps<{ items: HomePack[]; incidents: boolean }>();

const { t } = useI18nTyped();
</script>

<template>
  <div
    class="border-border-default bg-surface-subtle rounded-surface flex flex-col overflow-hidden border"
  >
    <div
      v-for="item in items"
      :key="item.pack.id"
      class="border-border-default flex items-center gap-3 border-b px-4 py-3 last:border-b-0 max-md:flex-wrap"
      :data-test="item.testId('home-pack-reminder')"
    >
      <OIcon name="notifications-off" size="md" class="text-text-secondary shrink-0" />
      <div class="flex min-w-0 flex-1 flex-col">
        <strong class="text-text-heading">{{
          t(
            incidents ? "starterPacks.home.silentNoIncidents" : "starterPacks.home.silentTitle",
            { count: item.flow.alertsOff.value, title: item.title },
            item.flow.alertsOff.value,
          )
        }}</strong>
        <OText variant="meta">{{ t("starterPacks.home.silentSub") }}</OText>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <OButton
          v-if="item.flow.canManage.value"
          variant="ghost"
          size="sm-action"
          :data-test="item.testId('home-pack-reminder-keep-off-btn')"
          @click="item.keepOff"
        >
          {{ t("starterPacks.home.keepOff") }}
        </OButton>
        <OButton
          variant="primary"
          size="sm-action"
          :data-test="item.testId('home-pack-reminder-turn-on-btn')"
          @click="item.openTurnOn"
        >
          {{ t("starterPacks.home.turnOn") }}
        </OButton>
      </div>
    </div>
  </div>
</template>
