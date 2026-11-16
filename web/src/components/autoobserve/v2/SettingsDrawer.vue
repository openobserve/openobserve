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
  <ODrawer
    :open="open"
    size="md"
    :title="t('autoobserve2.settingsDrawer.title')"
    data-test="autoobserve2-settings-drawer"
    @update:open="(v) => emit('update:open', v)"
  >
    <AutoObserveSettingsLive @how-it-works="emit('how-it-works')" />
  </ODrawer>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import ODrawer from "@/lib/overlay/Drawer/ODrawer.vue";
import AutoObserveSettingsLive from "../AutoObserveSettingsLive.vue";

defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [open: boolean]; "how-it-works": [] }>();

const { t } = useI18nTyped();
</script>
