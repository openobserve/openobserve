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

<!-- Direct items, not a hover submenu, so a preset is two clicks on a touch screen too. -->
<template>
  <ODropdownGroup :label="t(LABELS[labels].menu)">
    <ODropdownItem
      v-if="untilClear"
      :icon-left="LABELS[labels].icon"
      :data-test="`${dataTestPrefix}-until-clear`"
      @select="emit('untilClear')"
    >
      {{ t("alerts.downtimes.mute.untilClear") }}
    </ODropdownItem>
    <ODropdownItem
      v-for="preset in QUICK_MUTE_PRESETS"
      :key="preset.key"
      :icon-left="LABELS[labels].icon"
      :data-test="`${dataTestPrefix}-${preset.key}`"
      @select="emit('preset', preset.secs)"
    >
      {{ t(preset.labelKey) }}
    </ODropdownItem>
    <ODropdownItem icon-left="event" :data-test="`${dataTestPrefix}-until`" @select="emit('until')">
      {{ t("alerts.downtimes.mute.until") }}
    </ODropdownItem>
  </ODropdownGroup>
</template>

<script setup lang="ts">
import { useI18nTyped, type I18nKey } from "@/types/i18n";
import type { IconName } from "@/lib/core/Icon/OIcon.icons";
import { QUICK_MUTE_PRESETS } from "@/utils/downtimes/quickMute";
import ODropdownGroup from "@/lib/overlay/Dropdown/ODropdownGroup.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

type LabelSet = "mute" | "group" | "extend";

const LABELS: Record<LabelSet, { menu: I18nKey; icon: IconName }> = {
  mute: { menu: "alerts.downtimes.mute.menu", icon: "notifications-paused" },
  group: { menu: "alerts.downtimes.mute.muteGroup", icon: "notifications-paused" },
  extend: { menu: "alerts.downtimes.extend.menu", icon: "hourglass-empty" },
};

withDefaults(
  defineProps<{
    dataTestPrefix?: string;
    labels?: LabelSet;
    /** Only where one alert is in scope: the mute then ends when that alert clears. */
    untilClear?: boolean;
  }>(),
  { dataTestPrefix: "mute", labels: "mute", untilClear: false },
);

const emit = defineEmits<{
  preset: [seconds: number];
  until: [];
  untilClear: [];
}>();

const { t } = useI18nTyped();
</script>
