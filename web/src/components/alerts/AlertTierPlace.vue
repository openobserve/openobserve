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
import { computed, inject } from "vue";
import OSettingRow from "@/lib/core/SettingRow/OSettingRow.vue";
import type { I18nText } from "@/types/i18n";
import { ALERT_SETTING_TIERS_KEY } from "@/composables/alerts/useAlertSettingTiers";
import type { AlertSettingId } from "./alertSettingTiers";

const props = defineProps<{
  id: AlertSettingId;
  /** For a control that is not a row at home (a header switch): below the line it gets this row label. */
  rowLabel?: I18nText;
}>();

const tiers = inject(ALERT_SETTING_TIERS_KEY, null);
const target = computed(() => (tiers?.placedBelow(props.id) ? tiers.slotFor(props.id) : null));
</script>

<template>
  <Teleport :to="target" :disabled="!target">
    <OSettingRow v-if="target && rowLabel" :label="rowLabel" fill>
      <slot :below="true" />
    </OSettingRow>
    <slot v-else :below="!!target" />
  </Teleport>
</template>
