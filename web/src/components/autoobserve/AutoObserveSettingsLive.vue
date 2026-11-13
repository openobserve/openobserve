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
  <div class="flex flex-col gap-8 pb-8" data-test="autoobserve-settings-live">
    <DrawerSection
      :title="t('autoobserve2.settingsDrawer.reach')"
      data-test="autoobserve-settings-section-reach"
    >
      <AutoObserveSettingsReach />
    </DrawerSection>
    <DrawerSection
      :title="t('autoobserve.settingsLive.page.title')"
      data-test="autoobserve-settings-section-page"
    >
      <LiveSettingsPaging />
    </DrawerSection>
    <DrawerSection
      :title="t('autoobserve.settingsLive.own.title')"
      data-test="autoobserve-settings-section-own"
    >
      <AutoObserveSettingsOwn />
    </DrawerSection>
    <OButton
      variant="ghost-primary"
      size="xs"
      icon-right="arrow-forward"
      class="-ms-2 self-start"
      data-test="autoobserve-settings-how"
      @click="emit('how-it-works')"
    >
      {{ t("autoobserve.settingsLive.how") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import DrawerSection from "./v2/DrawerSection.vue";
import AutoObserveSettingsReach from "./AutoObserveSettingsReach.vue";
import AutoObserveSettingsOwn from "./AutoObserveSettingsOwn.vue";
import LiveSettingsPaging from "./AutoObserveSettingsPaging.vue";

const emit = defineEmits<{ "how-it-works": [] }>();

const { t } = useI18nTyped();
</script>
