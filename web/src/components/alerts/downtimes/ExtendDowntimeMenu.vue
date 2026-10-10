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
  <ODropdown v-if="enabled" align="end">
    <template #trigger>
      <OButton
        v-if="compact"
        variant="ghost"
        size="icon-sm"
        icon-left="hourglass-empty"
        :aria-label="t('alerts.downtimes.actions.extend')"
        :data-test="dataTest"
        @click.stop
      >
        <OTooltip side="bottom" :content="t('alerts.downtimes.actions.extend')" />
      </OButton>
      <OButton v-else variant="outline" size="sm" icon-left="hourglass-empty" :data-test="dataTest">
        {{ t("alerts.downtimes.actions.extend") }}
      </OButton>
    </template>
    <MuteMenuItems
      labels="extend"
      :data-test-prefix="dataTest"
      @preset="(secs) => emit('preset', secs)"
      @until="emit('until')"
    />
  </ODropdown>
  <OButton
    v-else-if="compact"
    variant="ghost"
    size="icon-sm"
    icon-left="hourglass-empty"
    disabled
    :aria-label="t('alerts.downtimes.extend.notActive')"
    :data-test="dataTest"
    @click.stop
  />
</template>

<script setup lang="ts">
import { useI18nTyped } from "@/types/i18n";
import OButton from "@/lib/core/Button/OButton.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import MuteMenuItems from "./MuteMenuItems.vue";

withDefaults(
  defineProps<{
    enabled: boolean;
    /** An icon button for a table row; otherwise a labelled header button. */
    compact?: boolean;
    dataTest?: string;
  }>(),
  { compact: false, dataTest: "downtime-extend" },
);

const emit = defineEmits<{
  preset: [seconds: number];
  until: [];
}>();

const { t } = useI18nTyped();
</script>
