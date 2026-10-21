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
  <OToggleGroup
    :model-value="view"
    :aria-label="t('autoobserve2.view.label')"
    data-test="autoobserve-view-switch"
    @update:model-value="(v) => v && setView(v as AutoObserveView)"
  >
    <OToggleGroupItem
      value="standard"
      size="xs"
      :tooltip="t('autoobserve2.view.standardTooltip')"
      data-test="autoobserve-view-standard"
    >
      {{ t("autoobserve2.view.standard") }}
    </OToggleGroupItem>
    <OToggleGroupItem
      value="nerd"
      size="xs"
      :tooltip="t('autoobserve2.view.nerdTooltip')"
      data-test="autoobserve-view-nerd"
    >
      {{ t("autoobserve2.view.nerd") }}
    </OToggleGroupItem>
  </OToggleGroup>
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import { useAutoObserveView, type AutoObserveView } from "./useAutoObserveView";

const { t } = useI18nTyped();
const { view, setView } = useAutoObserveView();
</script>
